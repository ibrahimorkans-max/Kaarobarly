import { z } from 'zod';
import { PAY_TYPES, computeSlip, daysInMonth, type ApprovalItem, type Employee, type ExpenseClaim, type PayrollRun, type Payslip } from '../../../packages/shared/src/index';
import { addLoanTxn, createLoan, listLoans } from './advanced';
import { defaultAccount, ensureAccounts, ownedAccount } from './accounts';
import { now, today, uid, type Db, type Row } from './core';
import { assertDayOpen } from './daylock';
import { INVOICE_SELECT, ownedRow } from './domain';
import { HttpError, can, type AuthContext } from './perm';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const text = (max = 500) => z.string().trim().max(max).default('');
const minor = z.number().int().min(0).max(1e13);

function payAccount(db: Db, auth: AuthContext, businessId: string, accountId: string | null | undefined): Row {
  ensureAccounts(db, { businessId });
  const a = accountId ? ownedAccount(db, auth.tenantId, accountId) : ownedAccount(db, auth.tenantId, defaultAccount(db, businessId, 'cash'));
  if (a.business_id !== businessId) throw new HttpError(422, 'That account belongs to another business.');
  return a;
}

// ================================================================ employees

export const employeeSchema = z.object({
  businessId: z.string().min(1),
  name: z.string().trim().min(1, 'Enter the name').max(200),
  phone: text(50),
  cnic: text(30),
  designation: text(100),
  joinDate: z.union([isoDate, z.literal('')]).default(''),
  payType: z.enum(PAY_TYPES).default('monthly'),
  rate: minor,
  bankAccount: text(200),
  status: z.enum(['active', 'left']).default('active'),
  notes: text(2000),
});

/** Salary advances still to recover: active loans "lent" to this employee. */
function advanceDue(db: Db, tenantId: string, employeeId: string): number {
  return listLoans(db, tenantId)
    .filter((l) => l.status === 'active' && l.direction === 'lent' && db.get('select 1 from loan where id = ? and employee_id = ?', l.id, employeeId))
    .reduce((s, l) => s + l.outstanding, 0);
}

function mapEmployee(db: Db, r: Row): Employee {
  return {
    id: r.id,
    businessId: r.business_id,
    name: r.name,
    phone: r.phone,
    cnic: r.cnic,
    designation: r.designation,
    joinDate: r.join_date,
    payType: r.pay_type,
    rate: r.rate,
    bankAccount: r.bank_account,
    status: r.status,
    notes: r.notes,
    advanceDue: advanceDue(db, r.tenant_id, r.id),
    createdAt: r.created_at,
  };
}

export function listEmployees(db: Db, tenantId: string): Employee[] {
  return db.all('select * from employee where tenant_id = ? order by status, name collate nocase', tenantId).map((r) => mapEmployee(db, r));
}
export function getEmployee(db: Db, tenantId: string, id: string): Employee {
  const r = db.get('select * from employee where id = ? and tenant_id = ?', id, tenantId);
  if (!r) throw new HttpError(404, 'Employee not found.');
  return mapEmployee(db, r);
}

export function saveEmployee(db: Db, auth: AuthContext, body: z.infer<typeof employeeSchema>, id?: string): Employee {
  ownedRow(db, 'business', auth.tenantId, body.businessId);
  if (id) {
    getEmployee(db, auth.tenantId, id);
    db.run(
      'update employee set business_id=?, name=?, phone=?, cnic=?, designation=?, join_date=?, pay_type=?, rate=?, bank_account=?, status=?, notes=? where id=?',
      body.businessId, body.name, body.phone, body.cnic, body.designation, body.joinDate, body.payType, body.rate, body.bankAccount, body.status, body.notes, id,
    );
  } else {
    id = uid();
    db.run(
      'insert into employee (id, tenant_id, business_id, name, phone, cnic, designation, join_date, pay_type, rate, bank_account, status, notes, created_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id, auth.tenantId, body.businessId, body.name, body.phone, body.cnic, body.designation, body.joinDate, body.payType, body.rate, body.bankAccount, body.status, body.notes, now(),
    );
  }
  db.audit(auth.tenantId, auth.userId, 'employee.save', 'employee', id, { name: body.name });
  return getEmployee(db, auth.tenantId, id);
}

export const advanceSchema = z.object({ amount: z.number().int().min(1).max(1e13), date: isoDate, accountId: z.string().nullable().default(null), monthlyRecovery: minor.default(0), notes: text(500) });

/** A salary advance is money lent to the employee: it leaves the account now and comes back from salary. */
export function giveAdvance(db: Db, auth: AuthContext, employeeId: string, body: z.infer<typeof advanceSchema>): Employee {
  return db.tx(() => {
    const e = getEmployee(db, auth.tenantId, employeeId);
    const loan = createLoan(db, auth, {
      businessId: e.businessId,
      direction: 'lent',
      party: e.name,
      principal: body.amount,
      rateBp: 0,
      startDate: body.date,
      endDate: '',
      installmentAmount: body.monthlyRecovery,
      accountId: body.accountId,
      notes: body.notes || 'Salary advance',
    });
    db.run('update loan set employee_id = ? where id = ?', employeeId, loan.id);
    return getEmployee(db, auth.tenantId, employeeId);
  });
}

// ================================================================ payroll

const slipSchema = z.object({
  days: z.number().min(0).max(31),
  overtime: minor.default(0),
  allowances: minor.default(0),
  bonus: minor.default(0),
  deductions: minor.default(0),
  tax: minor.default(0),
  advanceRecovery: minor.default(0),
  notes: text(500),
});
export { slipSchema };

function mapSlip(r: Row): Payslip {
  return {
    id: r.id,
    runId: r.run_id,
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    designation: r.designation,
    payType: r.pay_type,
    rate: r.rate,
    days: r.days,
    daysInMonth: r.days_in_month,
    earned: r.earned,
    overtime: r.overtime,
    allowances: r.allowances,
    bonus: r.bonus,
    deductions: r.deductions,
    tax: r.tax,
    advanceRecovery: r.advance_recovery,
    net: r.net,
    notes: r.notes,
  };
}

export function getRun(db: Db, tenantId: string, id: string): PayrollRun {
  const r = db.get('select p.*, b.currency, b.currency_precision from payroll_run p join business b on b.id = p.business_id where p.id = ? and p.tenant_id = ?', id, tenantId);
  if (!r) throw new HttpError(404, 'Payroll not found.');
  const slips = db.all('select * from payslip where run_id = ? order by employee_name collate nocase', id).map(mapSlip);
  return {
    id: r.id,
    businessId: r.business_id,
    month: r.month,
    status: r.status,
    slips,
    gross: slips.reduce((s, x) => s + x.net + x.advanceRecovery, 0),
    net: slips.reduce((s, x) => s + x.net, 0),
    createdByName: r.created_by_name,
    approvedByName: r.approved_by_name,
    paidDate: r.paid_date,
    accountId: r.account_id,
    currency: r.currency,
    currencyPrecision: r.currency_precision,
    createdAt: r.created_at,
  };
}

export function listRuns(db: Db, tenantId: string): PayrollRun[] {
  return db.all('select id from payroll_run where tenant_id = ? order by month desc limit 36', tenantId).map((r) => getRun(db, tenantId, r.id));
}

/** Start a month's payroll with a payslip for every active employee of the business. */
export function createRun(db: Db, auth: AuthContext, businessId: string, month: string): PayrollRun {
  return db.tx(() => {
    ownedRow(db, 'business', auth.tenantId, businessId);
    if (db.get('select 1 from payroll_run where tenant_id = ? and business_id = ? and month = ?', auth.tenantId, businessId, month)) throw new HttpError(409, `Payroll for ${month} already exists.`);
    const employees = db.all("select * from employee where tenant_id = ? and business_id = ? and status = 'active' order by name", auth.tenantId, businessId);
    if (!employees.length) throw new HttpError(422, 'Add employees first.');
    const id = uid();
    db.run("insert into payroll_run (id, tenant_id, business_id, month, status, created_by_name, created_at) values (?,?,?,?,'draft',?,?)", id, auth.tenantId, businessId, month, auth.name, now());
    const dim = daysInMonth(month);
    for (const e of employees) {
      const days = e.pay_type === 'monthly' ? dim : 0;
      // recover the agreed monthly amount of any advance, never more than is still due
      const loans = db.all("select l.id, l.installment_amount from loan l where l.employee_id = ? and l.status = 'active'", e.id);
      const due = advanceDue(db, auth.tenantId, e.id);
      const planned = loans.reduce((s, l) => s + (l.installment_amount || 0), 0);
      const recovery = Math.min(due, planned || 0);
      const { earned, net } = computeSlip({ payType: e.pay_type, rate: e.rate, days, daysInMonth: dim, overtime: 0, allowances: 0, bonus: 0, deductions: 0, tax: 0, advanceRecovery: recovery });
      db.run(
        'insert into payslip (id, tenant_id, run_id, employee_id, employee_name, designation, pay_type, rate, days, days_in_month, earned, overtime, allowances, bonus, deductions, tax, advance_recovery, net, notes) values (?,?,?,?,?,?,?,?,?,?,?,0,0,0,0,0,?,?,\'\')',
        uid(), auth.tenantId, id, e.id, e.name, e.designation, e.pay_type, e.rate, days, dim, earned, recovery, net,
      );
    }
    db.audit(auth.tenantId, auth.userId, 'payroll.create', 'payroll_run', id, { month });
    return getRun(db, auth.tenantId, id);
  });
}

export function updateSlip(db: Db, auth: AuthContext, runId: string, slipId: string, body: z.infer<typeof slipSchema>): PayrollRun {
  return db.tx(() => {
    const run = getRun(db, auth.tenantId, runId);
    if (run.status !== 'draft') throw new HttpError(409, 'Only a draft payroll can be changed. Send it back to draft first.');
    const s = run.slips.find((x) => x.id === slipId);
    if (!s) throw new HttpError(404, 'Payslip not found.');
    if (s.payType === 'monthly' && body.days > s.daysInMonth) throw new HttpError(422, `${s.employeeName}: at most ${s.daysInMonth} days this month.`);
    const due = advanceDue(db, auth.tenantId, s.employeeId);
    if (body.advanceRecovery > due) throw new HttpError(422, `${s.employeeName} only owes ${due / 10 ** run.currencyPrecision} in advances.`);
    const { earned, net } = computeSlip({ payType: s.payType, rate: s.rate, daysInMonth: s.daysInMonth, ...body });
    if (net < 0) throw new HttpError(422, `${s.employeeName}: deductions are more than the pay.`);
    db.run(
      'update payslip set days=?, earned=?, overtime=?, allowances=?, bonus=?, deductions=?, tax=?, advance_recovery=?, net=?, notes=? where id=?',
      body.days, earned, body.overtime, body.allowances, body.bonus, body.deductions, body.tax, body.advanceRecovery, net, body.notes, slipId,
    );
    return getRun(db, auth.tenantId, runId);
  });
}

const RUN_MOVES: Record<string, { to: string; perm: 'payroll.manage' | 'approvals.decide' }[]> = {
  draft: [{ to: 'submitted', perm: 'payroll.manage' }],
  submitted: [
    { to: 'approved', perm: 'approvals.decide' },
    { to: 'draft', perm: 'approvals.decide' },
  ],
  approved: [{ to: 'draft', perm: 'approvals.decide' }],
};

/** Submit for approval, approve, or send back to draft. */
export function moveRun(db: Db, auth: AuthContext, id: string, to: 'submitted' | 'approved' | 'draft'): PayrollRun {
  return db.tx(() => {
    const run = getRun(db, auth.tenantId, id);
    const move = (RUN_MOVES[run.status] ?? []).find((m) => m.to === to);
    if (!move) throw new HttpError(409, `A ${run.status} payroll cannot be marked ${to}.`);
    if (!can({ auth }, move.perm)) throw new HttpError(403, to === 'submitted' ? 'You cannot submit payroll.' : 'Only a manager can approve payroll.');
    db.run('update payroll_run set status = ?, approved_by_name = ? where id = ?', to, to === 'approved' ? auth.name : '', id);
    db.audit(auth.tenantId, auth.userId, `payroll.${to}`, 'payroll_run', id);
    return getRun(db, auth.tenantId, id);
  });
}

export const payRunSchema = z.object({ date: isoDate, accountId: z.string().nullable().default(null) });

/**
 * Pay an approved payroll: salaries become money out (the full salary cost), and advances
 * recovered come back in against each employee's advance, so the account only drops by what
 * employees actually receive.
 */
export function payRun(db: Db, auth: AuthContext, id: string, body: z.infer<typeof payRunSchema>): PayrollRun {
  return db.tx(() => {
    const run = getRun(db, auth.tenantId, id);
    if (run.status !== 'approved') throw new HttpError(409, run.status === 'paid' ? 'This payroll is already paid.' : 'Payroll must be approved before it is paid.');
    assertDayOpen(db, auth.tenantId, run.businessId, body.date);
    const account = payAccount(db, auth, run.businessId, body.accountId);
    if (run.gross > 0) {
      db.run(
        "insert into finance_entry (id, tenant_id, business_id, type, category, amount, date, method, party, notes, account_id, payroll_id, created_by, created_at) values (?,?,?,'expense','Salaries',?,?,?,?,?,?,?,?,?)",
        uid(), auth.tenantId, run.businessId, run.gross, body.date, account.type === 'cash' ? 'cash' : 'bank_transfer', `Payroll ${run.month}`, `${run.slips.length} payslips`, account.id, run.id, auth.userId, now(),
      );
    }
    for (const s of run.slips.filter((x) => x.advanceRecovery > 0)) {
      let left = s.advanceRecovery;
      for (const l of db.all("select id from loan where employee_id = ? and status = 'active' order by start_date, created_at", s.employeeId)) {
        if (left <= 0) break;
        const loan = listLoans(db, auth.tenantId).find((x) => x.id === l.id)!;
        const take = Math.min(left, loan.outstanding);
        if (take > 0) addLoanTxn(db, auth, l.id, { kind: 'repayment', amount: take, date: body.date, accountId: account.id, notes: `Recovered from ${run.month} salary` });
        left -= take;
      }
    }
    db.run("update payroll_run set status = 'paid', paid_date = ?, account_id = ? where id = ?", body.date, account.id, id);
    db.audit(auth.tenantId, auth.userId, 'payroll.paid', 'payroll_run', id, { net: run.net });
    return getRun(db, auth.tenantId, id);
  });
}

export function deleteRun(db: Db, auth: AuthContext, id: string) {
  const run = getRun(db, auth.tenantId, id);
  if (run.status === 'paid') throw new HttpError(409, 'A paid payroll cannot be deleted.');
  db.run('delete from payslip where run_id = ?', id);
  db.run('delete from payroll_run where id = ?', id);
  db.audit(auth.tenantId, auth.userId, 'payroll.delete', 'payroll_run', id);
}

// ================================================================ expense claims

export const claimSchema = z.object({
  businessId: z.string().min(1),
  date: isoDate,
  category: z.string().trim().min(1).max(60),
  amount: z.number().int().min(1, 'Enter the amount').max(1e13),
  description: z.string().trim().min(1, 'What was it for?').max(1000),
  receipt: z.string().max(1_500_000).default(''),
});

function mapClaim(r: Row): ExpenseClaim {
  return {
    id: r.id,
    businessId: r.business_id,
    number: r.number,
    date: r.date,
    category: r.category,
    amount: r.amount,
    description: r.description,
    hasReceipt: !!r.receipt,
    status: r.status,
    claimedBy: r.claimed_by,
    claimedByName: r.claimed_by_name,
    decidedByName: r.decided_by_name,
    decisionNote: r.decision_note,
    financeEntryId: r.finance_entry_id,
    createdAt: r.created_at,
  };
}

export function listClaims(db: Db, auth: AuthContext): ExpenseClaim[] {
  // people who decide see everyone's claims; others see their own
  const all = can({ auth }, 'approvals.decide') || can({ auth }, 'finance.manage');
  return db.all(`select * from expense_claim where tenant_id = ? ${all ? '' : 'and claimed_by = ?'} order by created_at desc limit 300`, auth.tenantId, ...(all ? [] : [auth.userId])).map(mapClaim);
}

export function getClaim(db: Db, tenantId: string, id: string): ExpenseClaim & { receipt: string } {
  const r = db.get('select * from expense_claim where id = ? and tenant_id = ?', id, tenantId);
  if (!r) throw new HttpError(404, 'Claim not found.');
  return { ...mapClaim(r), receipt: r.receipt };
}

export function createClaim(db: Db, auth: AuthContext, body: z.infer<typeof claimSchema>): ExpenseClaim {
  ownedRow(db, 'business', auth.tenantId, body.businessId);
  const id = uid();
  const number = `EXP-${String(db.nextCounter(auth.tenantId, 'claim')).padStart(4, '0')}`;
  db.run(
    "insert into expense_claim (id, tenant_id, business_id, number, date, category, amount, description, receipt, status, claimed_by, claimed_by_name, created_at) values (?,?,?,?,?,?,?,?,?,'pending',?,?,?)",
    id, auth.tenantId, body.businessId, number, body.date, body.category, body.amount, body.description, body.receipt, auth.userId, auth.name, now(),
  );
  db.audit(auth.tenantId, auth.userId, 'claim.create', 'expense_claim', id, { amount: body.amount });
  return mapClaim(db.get('select * from expense_claim where id = ?', id)!);
}

export const decideClaimSchema = z.object({ decision: z.enum(['approved', 'rejected']), note: text(500), pay: z.boolean().default(false), accountId: z.string().nullable().default(null), date: isoDate.optional() });

/** Approve or reject a claim; approving can also pay it (money out from the chosen account). */
export function decideClaim(db: Db, auth: AuthContext, id: string, body: z.infer<typeof decideClaimSchema>): ExpenseClaim {
  return db.tx(() => {
    const c = getClaim(db, auth.tenantId, id);
    if (c.status !== 'pending') throw new HttpError(409, `This claim is already ${c.status}.`);
    if (c.claimedBy === auth.userId && auth.role !== 'owner') throw new HttpError(403, 'Someone else must approve your own claim.');
    db.run('update expense_claim set status = ?, decided_by_name = ?, decision_note = ? where id = ?', body.decision, auth.name, body.note, id);
    db.audit(auth.tenantId, auth.userId, `claim.${body.decision}`, 'expense_claim', id);
    if (body.decision === 'approved' && body.pay) return payClaim(db, auth, id, { accountId: body.accountId, date: body.date });
    return mapClaim(db.get('select * from expense_claim where id = ?', id)!);
  });
}

export function payClaim(db: Db, auth: AuthContext, id: string, body: { accountId: string | null; date?: string }): ExpenseClaim {
  return db.tx(() => {
    if (!can({ auth }, 'finance.manage')) throw new HttpError(403, 'You cannot pay out money.');
    const c = getClaim(db, auth.tenantId, id);
    if (c.status !== 'approved') throw new HttpError(409, c.status === 'paid' ? 'Already paid.' : 'Approve the claim first.');
    const date = body.date ?? today();
    assertDayOpen(db, auth.tenantId, c.businessId, date);
    const account = payAccount(db, auth, c.businessId, body.accountId);
    const entryId = uid();
    db.run(
      "insert into finance_entry (id, tenant_id, business_id, type, category, amount, date, method, party, notes, account_id, attachment, claim_id, created_by, created_at) values (?,?,?,'expense',?,?,?,?,?,?,?,?,?,?,?)",
      entryId, auth.tenantId, c.businessId, c.category, c.amount, date, account.type === 'cash' ? 'cash' : 'bank_transfer', c.claimedByName, `${c.number} · ${c.description}`.slice(0, 2000), account.id, c.receipt, id, auth.userId, now(),
    );
    db.run("update expense_claim set status = 'paid', finance_entry_id = ? where id = ?", entryId, id);
    db.audit(auth.tenantId, auth.userId, 'claim.paid', 'expense_claim', id, { amount: c.amount });
    return mapClaim(db.get('select * from expense_claim where id = ?', id)!);
  });
}

// ================================================================ approvals inbox

/** Everything waiting for this person's decision, oldest first. */
export function approvals(db: Db, auth: AuthContext): ApprovalItem[] {
  const out: ApprovalItem[] = [];
  if (can({ auth }, 'purchases.approve')) {
    for (const r of db.all("select * from purchase_request where tenant_id = ? and status = 'pending' order by created_at", auth.tenantId)) {
      const lines = JSON.parse(r.lines) as { name: string; amount: number }[];
      out.push({ kind: 'purchase_request', id: r.id, title: `Purchase request ${r.number}`, sub: lines.map((l) => l.name).join(', '), amount: lines.reduce((s, l) => s + (l.amount || 0), 0), date: r.date, byName: r.requested_by_name });
    }
  }
  if (can({ auth }, 'approvals.decide')) {
    for (const r of db.all("select * from expense_claim where tenant_id = ? and status = 'pending' and (claimed_by <> ? or ? = 'owner') order by created_at", auth.tenantId, auth.userId, auth.role)) {
      out.push({ kind: 'expense_claim', id: r.id, title: `Expense claim ${r.number}`, sub: `${r.category} · ${r.description}`, amount: r.amount, date: r.date, byName: r.claimed_by_name });
    }
    for (const r of db.all("select id from payroll_run where tenant_id = ? and status = 'submitted' order by month", auth.tenantId)) {
      const run = getRun(db, auth.tenantId, r.id);
      out.push({ kind: 'payroll', id: run.id, title: `Payroll ${run.month}`, sub: `${run.slips.length} employees`, amount: run.net, date: run.createdAt.slice(0, 10), byName: run.createdByName });
    }
  }
  if (can({ auth }, 'invoices.finalize')) {
    for (const r of db.all(`${INVOICE_SELECT} where i.tenant_id = ? and i.status = 'draft' and i.recurring_id is not null order by i.issue_date`, auth.tenantId)) {
      out.push({ kind: 'recurring_draft', id: r.id, title: 'Recurring invoice to approve', sub: r.client_name, amount: r.total, date: r.issue_date, byName: 'Schedule' });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
