import { z } from 'zod';
import {
  PAYMENT_METHODS,
  precisionOf,
  type BalanceSheet,
  type BudgetReport,
  type CalendarEvent,
  type CashForecast,
  type Cheque,
  type DayClose,
  type Loan,
  type LoanTxn,
} from '../../../packages/shared/src/index';
import { balanceOf, defaultAccount, ensureAccounts, ownedAccount } from './accounts';
import { now, today, uid, type Db, type Row } from './core';
import { assertDayOpen } from './daylock';
import { INVOICE_SELECT, ownedRow, recordPayment, setPaymentVerification } from './domain';
import { inBase } from './fx';
import { HttpError, can, type AuthContext } from './perm';
import { setInstallmentPaid } from './purchases';
import { stockSummary } from './stock';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const text = (max = 500) => z.string().trim().max(max).default('');
const money = z.number().int().min(1, 'Amount must be above zero').max(1e13);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const json = <T>(s: string, fallback: T): T => {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
};
const bizRow = (db: Db, tenantId: string, businessId?: string) => {
  const b = businessId ? ownedRow(db, 'business', tenantId, businessId) : db.get('select * from business where tenant_id = ? order by created_at limit 1', tenantId);
  if (!b) throw new HttpError(404, 'Add a business profile first.');
  return b;
};
function accountFor(db: Db, tenantId: string, businessId: string, accountId: string | null | undefined, method: (typeof PAYMENT_METHODS)[number] = 'bank_transfer'): Row {
  ensureAccounts(db, { businessId });
  const a = accountId ? ownedAccount(db, tenantId, accountId) : ownedAccount(db, tenantId, defaultAccount(db, businessId, method === 'cash' ? 'cash' : 'bank'));
  if (a.business_id !== businessId) throw new HttpError(422, 'That account belongs to another business.');
  return a;
}

// ================================================================ cheques

export const chequeSchema = z.object({
  businessId: z.string().min(1),
  direction: z.enum(['in', 'out']),
  number: z.string().trim().min(1, 'Enter the cheque number').max(40),
  bank: text(100),
  party: z.string().trim().max(200).default(''),
  clientId: z.string().nullable().default(null),
  supplierId: z.string().nullable().default(null),
  amount: money,
  chequeDate: isoDate,
  receivedDate: isoDate.optional(),
  accountId: z.string().nullable().default(null),
  paymentId: z.string().nullable().default(null),
  purchaseId: z.string().nullable().default(null),
  notes: text(1000),
});

const CHEQUE_SELECT = 'select q.*, b.currency, b.currency_precision from cheque q join business b on b.id = q.business_id';
function mapCheque(r: Row): Cheque {
  return {
    id: r.id,
    businessId: r.business_id,
    direction: r.direction,
    number: r.number,
    bank: r.bank,
    party: r.party,
    clientId: r.client_id,
    supplierId: r.supplier_id,
    amount: r.amount,
    chequeDate: r.cheque_date,
    receivedDate: r.received_date,
    status: r.status,
    statusDate: r.status_date,
    accountId: r.account_id,
    paymentId: r.payment_id,
    purchaseId: r.purchase_id,
    notes: r.notes,
    currency: r.currency,
    currencyPrecision: r.currency_precision,
    createdAt: r.created_at,
  };
}

export function listCheques(db: Db, tenantId: string, f: { direction?: string; status?: string } = {}): Cheque[] {
  const where = ['q.tenant_id = ?'];
  const args: any[] = [tenantId];
  if (f.direction) where.push('q.direction = ?'), args.push(f.direction);
  if (f.status === 'open') where.push("q.status in ('pending','deposited')");
  else if (f.status) where.push('q.status = ?'), args.push(f.status);
  return db.all(`${CHEQUE_SELECT} where ${where.join(' and ')} order by q.cheque_date, q.created_at limit 500`, ...args).map(mapCheque);
}

export function getCheque(db: Db, tenantId: string, id: string): Cheque {
  const r = db.get(`${CHEQUE_SELECT} where q.id = ? and q.tenant_id = ?`, id, tenantId);
  if (!r) throw new HttpError(404, 'Cheque not found.');
  return mapCheque(r);
}

export function saveCheque(db: Db, auth: AuthContext, body: z.infer<typeof chequeSchema>, id?: string): Cheque {
  return db.tx(() => {
    ownedRow(db, 'business', auth.tenantId, body.businessId);
    let party = body.party;
    if (body.clientId) party = ownedRow(db, 'client', auth.tenantId, body.clientId).name;
    if (body.supplierId) {
      const s = db.get('select name from supplier where id = ? and tenant_id = ?', body.supplierId, auth.tenantId);
      if (!s) throw new HttpError(422, 'That supplier no longer exists.');
      party = s.name;
    }
    if (!party) throw new HttpError(422, body.direction === 'in' ? 'Who gave you this cheque?' : 'Who is this cheque for?');
    if (body.accountId) accountFor(db, auth.tenantId, body.businessId, body.accountId);
    if (id) {
      const old = getCheque(db, auth.tenantId, id);
      if (old.status !== 'pending' && old.status !== 'deposited') throw new HttpError(409, `A ${old.status} cheque cannot be edited.`);
      db.run(
        'update cheque set number=?, bank=?, party=?, client_id=?, supplier_id=?, amount=?, cheque_date=?, received_date=?, account_id=?, purchase_id=?, notes=? where id=?',
        body.number, body.bank, party, body.clientId, body.supplierId, body.amount, body.chequeDate, body.receivedDate ?? old.receivedDate, body.accountId, body.purchaseId, body.notes, id,
      );
    } else {
      id = uid();
      db.run(
        "insert into cheque (id, tenant_id, business_id, direction, number, bank, party, client_id, supplier_id, amount, cheque_date, received_date, status, account_id, payment_id, purchase_id, notes, created_by, created_at) values (?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?,?,?,?)",
        id, auth.tenantId, body.businessId, body.direction, body.number, body.bank, party, body.clientId, body.supplierId, body.amount, body.chequeDate, body.receivedDate ?? today(), body.accountId, body.paymentId, body.purchaseId, body.notes, auth.userId, now(),
      );
    }
    db.audit(auth.tenantId, auth.userId, 'cheque.save', 'cheque', id, { amount: body.amount, direction: body.direction });
    return getCheque(db, auth.tenantId, id);
  });
}

const CHEQUE_MOVES: Record<string, string[]> = { pending: ['deposited', 'cleared', 'bounced', 'cancelled'], deposited: ['cleared', 'bounced'], bounced: ['deposited'] };

/**
 * Move a cheque along. A received cheque that clears becomes a client payment (unless it already
 * is one); one that bounces cancels the payment it paid. An issued cheque that clears pays the
 * matching unpaid installment of its bill.
 */
export function setChequeStatus(db: Db, auth: AuthContext, id: string, status: 'deposited' | 'cleared' | 'bounced' | 'cancelled', opts: { date?: string; accountId?: string | null } = {}): Cheque {
  return db.tx(() => {
    const c = getCheque(db, auth.tenantId, id);
    if (!(CHEQUE_MOVES[c.status] ?? []).includes(status)) throw new HttpError(409, `A ${c.status} cheque cannot be marked ${status}.`);
    const date = opts.date ?? today();
    const accountId = opts.accountId ?? c.accountId;
    if (c.direction === 'in' && status === 'cleared' && !c.paymentId && c.clientId) {
      if (!can({ auth }, 'payments.record')) throw new HttpError(403, 'You do not have permission to record payments.');
      const account = accountFor(db, auth.tenantId, c.businessId, accountId);
      const p = recordPayment(
        db,
        auth,
        { clientId: c.clientId, businessId: c.businessId, amount: c.amount, date, method: 'cheque', reference: `Cheque ${c.number}${c.bank ? ` · ${c.bank}` : ''}`, notes: c.notes, proof: '', autoAllocate: true, accountId: account.id },
        can({ auth }, 'payments.verify'),
      );
      db.run('update cheque set payment_id = ?, account_id = ? where id = ?', p.id, account.id, id);
    }
    if (c.direction === 'in' && status === 'bounced' && c.paymentId) {
      const p = db.get('select verification_status from payment where id = ?', c.paymentId);
      if (p && p.verification_status !== 'rejected') setPaymentVerification(db, auth, c.paymentId, 'rejected');
    }
    if (c.direction === 'out' && status === 'cleared' && c.purchaseId) {
      const pr = db.get('select installments from purchase where id = ? and tenant_id = ?', c.purchaseId, auth.tenantId);
      const plan = json<{ amount: number; paid: boolean }[]>(pr?.installments ?? '[]', []);
      const idx = plan.findIndex((x) => !x.paid && x.amount === c.amount);
      if (idx >= 0) setInstallmentPaid(db, auth, c.purchaseId, idx, true);
    }
    db.run('update cheque set status = ?, status_date = ?, account_id = coalesce(?, account_id) where id = ?', status, date, accountId, id);
    db.audit(auth.tenantId, auth.userId, `cheque.${status}`, 'cheque', id);
    return getCheque(db, auth.tenantId, id);
  });
}

export function deleteCheque(db: Db, auth: AuthContext, id: string) {
  const c = getCheque(db, auth.tenantId, id);
  if (c.status === 'cleared') throw new HttpError(409, 'A cleared cheque cannot be deleted.');
  db.run('delete from cheque where id = ?', id);
  db.audit(auth.tenantId, auth.userId, 'cheque.delete', 'cheque', id);
}

// ================================================================ loans

export const loanSchema = z.object({
  businessId: z.string().min(1),
  direction: z.enum(['borrowed', 'lent']),
  party: z.string().trim().min(1, 'Who is the loan with?').max(200),
  principal: money,
  rateBp: z.number().int().min(0).max(100_000).default(0),
  startDate: isoDate,
  endDate: z.union([isoDate, z.literal('')]).default(''),
  installmentAmount: z.number().int().min(0).max(1e13).default(0),
  accountId: z.string().nullable().default(null),
  notes: text(2000),
});
export const loanTxnSchema = z.object({
  kind: z.enum(['repayment', 'interest', 'disbursement']),
  amount: money,
  date: isoDate,
  accountId: z.string().nullable().default(null),
  notes: text(500),
});

function mapLoan(db: Db, r: Row): Loan {
  const txns = db.all('select kind, amount, date from loan_txn where loan_id = ?', r.id);
  const given = txns.filter((t) => t.kind === 'disbursement').reduce((a, t) => a + t.amount, 0);
  const repaid = txns.filter((t) => t.kind === 'repayment').reduce((a, t) => a + t.amount, 0);
  const interestPaid = txns.filter((t) => t.kind === 'interest').reduce((a, t) => a + t.amount, 0);
  const outstanding = given - repaid;
  // with a regular repayment, the next one is due a month after the last (or after the start)
  const last = txns.filter((t) => t.kind === 'repayment').map((t) => t.date).sort().pop() ?? r.start_date;
  const next = r.installment_amount > 0 && outstanding > 0 && r.status === 'active' ? nextMonth(last) : null;
  return {
    id: r.id,
    businessId: r.business_id,
    direction: r.direction,
    party: r.party,
    principal: r.principal,
    rateBp: r.rate_bp,
    startDate: r.start_date,
    endDate: r.end_date,
    installmentAmount: r.installment_amount,
    notes: r.notes,
    status: r.status,
    outstanding,
    repaid,
    interestPaid,
    nextDue: next,
    currency: r.currency,
    currencyPrecision: r.currency_precision,
    createdAt: r.created_at,
  };
}
function nextMonth(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m, 1));
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(d, last));
  return dt.toISOString().slice(0, 10);
}
const LOAN_SELECT = 'select l.*, b.currency, b.currency_precision from loan l join business b on b.id = l.business_id';

export function listLoans(db: Db, tenantId: string): Loan[] {
  return db.all(`${LOAN_SELECT} where l.tenant_id = ? order by l.status, l.start_date desc`, tenantId).map((r) => mapLoan(db, r));
}
export function getLoan(db: Db, tenantId: string, id: string): { loan: Loan; txns: LoanTxn[] } {
  const r = db.get(`${LOAN_SELECT} where l.id = ? and l.tenant_id = ?`, id, tenantId);
  if (!r) throw new HttpError(404, 'Loan not found.');
  const txns = db
    .all('select t.*, a.name as account_name from loan_txn t join money_account a on a.id = t.account_id where t.loan_id = ? order by t.date desc, t.created_at desc', id)
    .map((t) => ({ id: t.id, loanId: t.loan_id, kind: t.kind, amount: t.amount, date: t.date, accountId: t.account_id, accountName: t.account_name, notes: t.notes }));
  return { loan: mapLoan(db, r), txns };
}

/** A new loan: the money arrives in (borrowed) or leaves (lent) the chosen account. */
export function createLoan(db: Db, auth: AuthContext, body: z.infer<typeof loanSchema>): Loan {
  return db.tx(() => {
    ownedRow(db, 'business', auth.tenantId, body.businessId);
    assertDayOpen(db, auth.tenantId, body.businessId, body.startDate);
    const account = accountFor(db, auth.tenantId, body.businessId, body.accountId);
    const id = uid();
    db.run(
      "insert into loan (id, tenant_id, business_id, direction, party, principal, rate_bp, start_date, end_date, installment_amount, notes, status, created_by, created_at) values (?,?,?,?,?,?,?,?,?,?,?,'active',?,?)",
      id, auth.tenantId, body.businessId, body.direction, body.party, body.principal, body.rateBp, body.startDate, body.endDate, body.installmentAmount, body.notes, auth.userId, now(),
    );
    db.run(
      "insert into loan_txn (id, tenant_id, loan_id, kind, amount, date, account_id, notes, created_by, created_at) values (?,?,?,'disbursement',?,?,?,?,?,?)",
      uid(), auth.tenantId, id, body.principal, body.startDate, account.id, body.direction === 'borrowed' ? 'Loan received' : 'Loan given', auth.userId, now(),
    );
    db.audit(auth.tenantId, auth.userId, 'loan.create', 'loan', id, { principal: body.principal, direction: body.direction });
    return getLoan(db, auth.tenantId, id).loan;
  });
}

/** Repayment (principal), interest, or more money on the same loan. */
export function addLoanTxn(db: Db, auth: AuthContext, loanId: string, body: z.infer<typeof loanTxnSchema>): Loan {
  return db.tx(() => {
    const { loan } = getLoan(db, auth.tenantId, loanId);
    if (loan.status === 'closed') throw new HttpError(409, 'This loan is closed.');
    assertDayOpen(db, auth.tenantId, loan.businessId, body.date);
    if (body.kind === 'repayment' && body.amount > loan.outstanding) throw new HttpError(422, `Only ${loan.outstanding / 10 ** loan.currencyPrecision} is still outstanding on this loan.`);
    const account = accountFor(db, auth.tenantId, loan.businessId, body.accountId);
    db.run(
      'insert into loan_txn (id, tenant_id, loan_id, kind, amount, date, account_id, notes, created_by, created_at) values (?,?,?,?,?,?,?,?,?,?)',
      uid(), auth.tenantId, loanId, body.kind, body.amount, body.date, account.id, body.notes, auth.userId, now(),
    );
    const after = getLoan(db, auth.tenantId, loanId).loan;
    if (after.outstanding <= 0) db.run("update loan set status = 'closed' where id = ?", loanId);
    db.audit(auth.tenantId, auth.userId, `loan.${body.kind}`, 'loan', loanId, { amount: body.amount });
    return getLoan(db, auth.tenantId, loanId).loan;
  });
}

export function deleteLoanTxn(db: Db, auth: AuthContext, loanId: string, txnId: string) {
  db.tx(() => {
    const { loan, txns } = getLoan(db, auth.tenantId, loanId);
    const t = txns.find((x) => x.id === txnId);
    if (!t) throw new HttpError(404, 'Entry not found.');
    assertDayOpen(db, auth.tenantId, loan.businessId, t.date);
    if (t.kind === 'disbursement' && txns.filter((x) => x.kind === 'disbursement').length === 1) throw new HttpError(409, 'Delete the loan instead.');
    db.run('delete from loan_txn where id = ?', txnId);
    if (getLoan(db, auth.tenantId, loanId).loan.outstanding > 0) db.run("update loan set status = 'active' where id = ?", loanId);
    db.audit(auth.tenantId, auth.userId, 'loan.txn_delete', 'loan', loanId);
  });
}

export function deleteLoan(db: Db, auth: AuthContext, id: string) {
  db.tx(() => {
    const { loan, txns } = getLoan(db, auth.tenantId, id);
    assertDayOpen(db, auth.tenantId, loan.businessId, ...txns.map((t) => t.date));
    db.run('delete from loan_txn where loan_id = ?', id);
    db.run('delete from loan where id = ?', id);
    db.audit(auth.tenantId, auth.userId, 'loan.delete', 'loan', id);
  });
}

// ================================================================ budgets

export const budgetSchema = z.object({
  businessId: z.string().min(1),
  /** YYYY-MM for one month, or 'default' for every month without its own budget */
  month: z.union([z.string().regex(/^\d{4}-\d{2}$/), z.literal('default')]),
  lines: z.array(z.object({ category: z.string().trim().min(1).max(60), amount: z.number().int().min(0).max(1e13) })).max(100),
});

export function saveBudget(db: Db, auth: AuthContext, body: z.infer<typeof budgetSchema>) {
  db.tx(() => {
    ownedRow(db, 'business', auth.tenantId, body.businessId);
    db.run('delete from budget where tenant_id = ? and business_id = ? and month = ?', auth.tenantId, body.businessId, body.month);
    for (const l of body.lines.filter((x) => x.amount > 0)) {
      db.run('insert into budget (id, tenant_id, business_id, category, month, amount, created_at) values (?,?,?,?,?,?,?)', uid(), auth.tenantId, body.businessId, l.category, body.month, l.amount, now());
    }
    db.audit(auth.tenantId, auth.userId, 'budget.save', 'budget', null, { month: body.month, lines: body.lines.length });
  });
}

export function budgetReport(db: Db, tenantId: string, businessId: string | undefined, month: string): BudgetReport {
  const b = bizRow(db, tenantId, businessId);
  let rows = db.all('select category, amount from budget where tenant_id = ? and business_id = ? and month = ?', tenantId, b.id, month);
  if (!rows.length) rows = db.all("select category, amount from budget where tenant_id = ? and business_id = ? and month = 'default'", tenantId, b.id);
  const actual = new Map<string, number>();
  for (const e of db.all("select category, sum(amount) as s from finance_entry where tenant_id = ? and business_id = ? and type = 'expense' and substr(date, 1, 7) = ? group by category", tenantId, b.id, month)) {
    actual.set(e.category, e.s);
  }
  const lines = rows.map((r) => {
    const a = actual.get(r.category) ?? 0;
    return { category: r.category, budget: r.amount, actual: a, remaining: r.amount - a, usedBp: r.amount > 0 ? Math.round((a * 10_000) / r.amount) : 0 };
  });
  const budgeted = new Set(rows.map((r) => r.category));
  return {
    month,
    lines: lines.sort((x, y) => y.usedBp - x.usedBp),
    totalBudget: lines.reduce((s, l) => s + l.budget, 0),
    totalActual: lines.reduce((s, l) => s + l.actual, 0),
    unbudgeted: [...actual].filter(([c]) => !budgeted.has(c)).map(([category, a]) => ({ category, actual: a })),
    currency: b.currency,
    currencyPrecision: b.currency_precision,
  };
}

// ================================================================ bills calendar

/** Everything due between two dates: money to collect and money to pay. */
export function calendar(db: Db, tenantId: string, businessId: string | undefined, from: string, to: string): CalendarEvent[] {
  const b = bizRow(db, tenantId, businessId);
  const t = today();
  const out: CalendarEvent[] = [];
  const push = (e: Omit<CalendarEvent, 'overdue'>) => out.push({ ...e, overdue: e.date < t });

  // invoices: each unpaid installment, or the whole balance on the due date
  for (const r of db.all(`select * from (${INVOICE_SELECT} where i.tenant_id = ? and i.business_id = ? and i.status = 'final') where paid < total`, tenantId, b.id)) {
    const plan = db.all('select * from installment where invoice_id = ? order by seq', r.id);
    if (plan.length) {
      // money received pays the unscheduled part first, then installments in order
      let credit = Math.max(0, r.paid - Math.max(0, r.total - plan.reduce((a, x) => a + x.amount, 0)));
      for (const x of plan) {
        const left = x.amount - Math.min(credit, x.amount);
        credit = Math.max(0, credit - x.amount);
        if (left > 0 && x.due_date <= to) push({ date: x.due_date, kind: 'installment', direction: 'in', title: `${r.number} installment ${x.seq}`, party: r.client_name, amount: inBase(left, r.fx_factor), refType: 'invoice', refId: r.id });
      }
    } else if (r.due_date <= to) {
      push({ date: r.due_date, kind: 'invoice', direction: 'in', title: r.number, party: r.client_name, amount: inBase(r.total - r.paid, r.fx_factor), refType: 'invoice', refId: r.id });
    }
  }
  // purchase bills: unpaid installments
  for (const p of db.all('select * from purchase where tenant_id = ? and business_id = ?', tenantId, b.id)) {
    json<{ dueDate: string; amount: number; paid: boolean }[]>(p.installments || '[]', []).forEach((x, i) => {
      if (!x.paid && x.dueDate <= to) push({ date: x.dueDate, kind: 'bill', direction: 'out', title: `${p.number} part ${i + 1}`, party: p.supplier, amount: x.amount, refType: 'purchase', refId: p.id });
    });
  }
  // cheques still to clear
  for (const c of db.all("select * from cheque where tenant_id = ? and business_id = ? and status in ('pending','deposited') and cheque_date <= ?", tenantId, b.id, to)) {
    push({ date: c.cheque_date, kind: c.direction === 'in' ? 'cheque_in' : 'cheque_out', direction: c.direction, title: `Cheque ${c.number}${c.bank ? ` · ${c.bank}` : ''}`, party: c.party, amount: c.amount, refType: 'cheque', refId: c.id });
  }
  // loan repayments
  for (const l of listLoans(db, tenantId).filter((x) => x.businessId === b.id && x.nextDue)) {
    let due = l.nextDue!;
    let left = l.outstanding;
    while (due <= to && left > 0) {
      const amt = Math.min(l.installmentAmount, left);
      push({ date: due, kind: 'loan', direction: l.direction === 'borrowed' ? 'out' : 'in', title: `Loan ${l.direction === 'borrowed' ? 'repayment' : 'collection'}`, party: l.party, amount: amt, refType: 'loan', refId: l.id });
      left -= amt;
      due = nextMonth(due);
    }
  }
  return out.filter((e) => e.date >= from || e.overdue).sort((a, x) => a.date.localeCompare(x.date) || a.direction.localeCompare(x.direction));
}

// ================================================================ cash forecast

export function forecast(db: Db, tenantId: string, businessId: string | undefined, days: number): CashForecast {
  const b = bizRow(db, tenantId, businessId);
  const t = today();
  const end = addDays(t, days);
  const accounts = db.all("select id, currency from money_account where tenant_id = ? and business_id = ? and status = 'active' and currency = ?", tenantId, b.id, b.currency);
  const opening = accounts.reduce((s, a) => s + balanceOf(db, tenantId, a.id), 0);
  const events = calendar(db, tenantId, b.id, t, end);
  const overdueIn = events.filter((e) => e.overdue && e.direction === 'in').reduce((s, e) => s + e.amount, 0);
  const overdueOut = events.filter((e) => e.overdue && e.direction === 'out').reduce((s, e) => s + e.amount, 0);
  // running costs: average of the last three full months of manual money out (bills are counted above)
  const since = addDays(t, -90);
  const spent = db.get("select coalesce(sum(amount), 0) as s from finance_entry where tenant_id = ? and business_id = ? and type = 'expense' and purchase_id is null and date between ? and ?", tenantId, b.id, since, t)!.s;
  const perDay = spent / 90;
  const weeks: CashForecast['weeks'] = [];
  let balance = opening;
  let lowest = { date: t, balance: opening };
  for (let start = t; start < end; start = addDays(start, 7)) {
    const stop = addDays(start, 6) < end ? addDays(start, 6) : addDays(end, -1);
    const inWeek = events.filter((e) => !e.overdue && e.date >= start && e.date <= stop);
    const moneyIn = inWeek.filter((e) => e.direction === 'in').reduce((s, e) => s + e.amount, 0);
    const costDays = (Date.parse(stop) - Date.parse(start)) / 86_400_000 + 1;
    const moneyOut = inWeek.filter((e) => e.direction === 'out').reduce((s, e) => s + e.amount, 0) + Math.round(perDay * costDays);
    balance += moneyIn - moneyOut;
    weeks.push({ start, end: stop, moneyIn, moneyOut, closing: balance });
    if (balance < lowest.balance) lowest = { date: stop, balance };
  }
  return {
    today: t,
    days,
    opening,
    overdueIn,
    overdueOut,
    regularCosts: Math.round(perDay * 30),
    weeks,
    lowest,
    events,
    currency: b.currency,
    currencyPrecision: b.currency_precision,
  };
}

// ================================================================ balance sheet

export function balanceSheet(db: Db, tenantId: string, businessId: string | undefined): BalanceSheet {
  const b = bizRow(db, tenantId, businessId);
  const date = today();
  const assets: BalanceSheet['assets'] = [];
  const liabilities: BalanceSheet['liabilities'] = [];
  for (const a of db.all("select * from money_account where tenant_id = ? and business_id = ? and status = 'active' and currency = ? order by type, name", tenantId, b.id, b.currency)) {
    const bal = balanceOf(db, tenantId, a.id);
    if (bal >= 0) assets.push({ label: a.name, amount: bal });
    else liabilities.push({ label: `${a.name} (overdrawn)`, amount: -bal });
  }
  // receivables: unpaid final invoices + opening balances, less advances held
  const owed = db.all(`select * from (${INVOICE_SELECT} where i.tenant_id = ? and i.business_id = ? and i.status = 'final') where paid < total`, tenantId, b.id).reduce((s, r) => s + inBase(r.total - r.paid, r.fx_factor), 0);
  const openings = db.get('select coalesce(sum(opening_balance), 0) as s from client where tenant_id = ?', tenantId)!.s;
  const receivable = owed + Math.max(openings, 0);
  if (receivable) assets.push({ label: 'Money owed by clients', amount: receivable });
  const stock = stockSummary(db, tenantId).totalValue;
  if (stock) assets.push({ label: 'Stock (at cost)', amount: stock });
  const loans = listLoans(db, tenantId).filter((l) => l.businessId === b.id && l.outstanding > 0);
  const lent = loans.filter((l) => l.direction === 'lent').reduce((s, l) => s + l.outstanding, 0);
  if (lent) assets.push({ label: 'Loans given', amount: lent });
  const pdc = db.get("select coalesce(sum(amount), 0) as s from cheque where tenant_id = ? and business_id = ? and direction = 'in' and status in ('pending','deposited') and payment_id is null", tenantId, b.id)!.s;
  if (pdc) assets.push({ label: 'Cheques in hand', amount: pdc });

  const payable = db
    .all('select total, installments from purchase where tenant_id = ? and business_id = ?', tenantId, b.id)
    .reduce((s, r) => {
      const plan = json<{ amount: number; paid: boolean }[]>(r.installments || '[]', []);
      return s + (plan.length ? plan.filter((x) => !x.paid).reduce((a, x) => a + x.amount, 0) : 0);
    }, 0);
  const supplierOpening = db.get('select coalesce(sum(opening_balance), 0) as s from supplier where tenant_id = ?', tenantId)!.s;
  if (payable + supplierOpening) liabilities.push({ label: 'Owed to suppliers', amount: payable + supplierOpening });
  const borrowed = loans.filter((l) => l.direction === 'borrowed').reduce((s, l) => s + l.outstanding, 0);
  if (borrowed) liabilities.push({ label: 'Loans taken', amount: borrowed });
  const advances = Math.max(-openings, 0);
  if (advances) liabilities.push({ label: 'Client advances', amount: advances });
  const cheqOut = db.get("select coalesce(sum(amount), 0) as s from cheque where tenant_id = ? and business_id = ? and direction = 'out' and status in ('pending','deposited') and purchase_id is null", tenantId, b.id)!.s;
  if (cheqOut) liabilities.push({ label: 'Cheques issued, not cleared', amount: cheqOut });

  const totalAssets = assets.reduce((s, x) => s + x.amount, 0);
  const totalLiabilities = liabilities.reduce((s, x) => s + x.amount, 0);
  return { date, assets, totalAssets, liabilities, totalLiabilities, equity: totalAssets - totalLiabilities, currency: b.currency, currencyPrecision: precisionOf(b.currency) };
}

// ================================================================ day close

export const dayCloseSchema = z.object({
  businessId: z.string().min(1),
  accountId: z.string().nullable().default(null),
  date: isoDate,
  counted: z.number().int().min(-1e13).max(1e13),
  notes: text(1000),
});

function mapClose(r: Row): DayClose {
  return { id: r.id, businessId: r.business_id, accountId: r.account_id, accountName: r.account_name, date: r.date, expected: r.expected, counted: r.counted, difference: r.difference, notes: r.notes, closedByName: r.closed_by_name, createdAt: r.created_at };
}

export function listCloses(db: Db, tenantId: string, businessId?: string): DayClose[] {
  const b = bizRow(db, tenantId, businessId);
  return db.all('select d.*, a.name as account_name from day_close d join money_account a on a.id = d.account_id where d.tenant_id = ? and d.business_id = ? order by d.date desc limit 120', tenantId, b.id).map(mapClose);
}

/** What the cash drawer should hold at the end of a day (for the close screen). */
export function expectedCash(db: Db, tenantId: string, businessId: string | undefined, accountId: string | null | undefined, date: string) {
  const b = bizRow(db, tenantId, businessId);
  const a = accountFor(db, tenantId, b.id, accountId, 'cash');
  return { accountId: a.id, accountName: a.name, date, expected: balanceOf(db, tenantId, a.id, date) };
}

/**
 * Close a day: count the cash, record any shortage or excess as money out / in, and lock every
 * money record of that business dated on or before the day.
 */
export function closeDay(db: Db, auth: AuthContext, body: z.infer<typeof dayCloseSchema>): DayClose {
  return db.tx(() => {
    const b = bizRow(db, auth.tenantId, body.businessId);
    if (body.date > today()) throw new HttpError(422, 'A day in the future cannot be closed.');
    assertDayOpen(db, auth.tenantId, b.id, body.date);
    const a = accountFor(db, auth.tenantId, b.id, body.accountId, 'cash');
    const expected = balanceOf(db, auth.tenantId, a.id, body.date);
    const difference = body.counted - expected;
    let entryId: string | null = null;
    if (difference !== 0) {
      entryId = uid();
      db.run(
        "insert into finance_entry (id, tenant_id, business_id, type, category, amount, date, method, party, notes, account_id, created_by, created_at) values (?,?,?,?,?,?,?,'cash','',?,?,?,?)",
        entryId, auth.tenantId, b.id, difference > 0 ? 'income' : 'expense', difference > 0 ? 'Cash over' : 'Cash short', Math.abs(difference), body.date, `Day close ${body.date}${body.notes ? ` · ${body.notes}` : ''}`, a.id, auth.userId, now(),
      );
    }
    const id = uid();
    db.run(
      'insert into day_close (id, tenant_id, business_id, account_id, date, expected, counted, difference, notes, entry_id, closed_by_name, created_at) values (?,?,?,?,?,?,?,?,?,?,?,?)',
      id, auth.tenantId, b.id, a.id, body.date, expected, body.counted, difference, body.notes, entryId, auth.name, now(),
    );
    db.audit(auth.tenantId, auth.userId, 'day.close', 'day_close', id, { date: body.date, difference });
    return mapClose(db.get('select d.*, a.name as account_name from day_close d join money_account a on a.id = d.account_id where d.id = ?', id)!);
  });
}

/** Reopen the most recent closed day (owner only): its shortage/excess entry is removed. */
export function reopenDay(db: Db, auth: AuthContext, id: string) {
  db.tx(() => {
    if (auth.role !== 'owner') throw new HttpError(403, 'Only the owner can reopen a closed day.');
    const d = db.get('select * from day_close where id = ? and tenant_id = ?', id, auth.tenantId);
    if (!d) throw new HttpError(404, 'Day close not found.');
    const latest = db.get('select max(date) as m from day_close where tenant_id = ? and business_id = ?', auth.tenantId, d.business_id)!.m;
    if (d.date !== latest) throw new HttpError(409, `Reopen ${latest} first; days reopen newest first.`);
    db.run('delete from day_close where business_id = ? and date = ?', d.business_id, d.date);
    if (d.entry_id) db.run('delete from finance_entry where id = ?', d.entry_id);
    db.audit(auth.tenantId, auth.userId, 'day.reopen', 'day_close', id, { date: d.date });
  });
}
