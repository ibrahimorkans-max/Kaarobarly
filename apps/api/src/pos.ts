import { z } from 'zod';
import { CASHIER_DISCOUNT_LIMIT_BP, POS_TENDERS, TENDER_METHOD, type HeldBill, type PosShift, type PosTender, type ZReport } from '../../../packages/shared/src/index';
import { accountTypeFor, defaultAccount, ensureAccounts, ownedAccount, refundCredit } from './accounts';
import { createCreditNote } from './collections';
import { now, today, uid, type Db, type Row } from './core';
import { assertDayOpen } from './daylock';
import { INVOICE_SELECT, createInvoice, getInvoice, invoiceSchema, ownedRow, recordPayment } from './domain';
import { HttpError, can, type AuthContext } from './perm';
import { assertLimit } from './saas';

/**
 * Point of sale. A counter sale is stored as a final invoice with its payments, so stock,
 * the cashbook, ledgers, profit & loss and reports all include it. A shift is one cashier's
 * session at one cash drawer: opening float, cash in/out, and a blind count at close.
 */

const minor = z.number().int().min(0).max(1e13);
const lineSchema = z.object({
  serviceId: z.string().nullable().default(null),
  name: z.string().trim().min(1).max(200),
  qty: z.number().int().min(1).max(1e12),
  unit: z.string().trim().max(30).default(''),
  unitPrice: minor,
  discountType: z.enum(['percent', 'fixed']).default('percent'),
  discountValue: minor.default(0),
  taxRateBp: z.number().int().min(0).max(10000).default(0),
});

// ================================================================ shifts

function mapShift(r: Row): PosShift {
  return {
    id: r.id,
    businessId: r.business_id,
    accountId: r.account_id,
    accountName: r.account_name ?? '',
    openedByName: r.opened_by_name,
    openedAt: r.opened_at,
    openingFloat: r.opening_float,
    status: r.status,
    closedAt: r.closed_at,
    closedByName: r.closed_by_name,
    counted: r.counted,
    expected: r.expected,
    difference: r.difference,
    notes: r.notes,
  };
}
const SHIFT_SELECT = 'select s.*, a.name as account_name from pos_shift s left join money_account a on a.id = s.account_id';

export function getShift(db: Db, tenantId: string, id: string): PosShift {
  const r = db.get(`${SHIFT_SELECT} where s.id = ? and s.tenant_id = ?`, id, tenantId);
  if (!r) throw new HttpError(404, 'Shift not found.');
  return mapShift(r);
}

/** The shift this person has open, if any. */
export function myShift(db: Db, auth: AuthContext): PosShift | null {
  const r = db.get(`${SHIFT_SELECT} where s.tenant_id = ? and s.opened_by = ? and s.status = 'open' order by s.opened_at desc limit 1`, auth.tenantId, auth.userId);
  return r ? mapShift(r) : null;
}

export function listShifts(db: Db, tenantId: string): PosShift[] {
  return db.all(`${SHIFT_SELECT} where s.tenant_id = ? order by s.opened_at desc limit 60`, tenantId).map(mapShift);
}

export const openSchema = z.object({ businessId: z.string().min(1), accountId: z.string().nullable().default(null), openingFloat: minor.default(0), notes: z.string().trim().max(500).default('') });

export function openShift(db: Db, auth: AuthContext, body: z.infer<typeof openSchema>): PosShift {
  return db.tx(() => {
    ownedRow(db, 'business', auth.tenantId, body.businessId);
    if (myShift(db, auth)) throw new HttpError(409, 'You already have a shift open. Close it first.');
    ensureAccounts(db, { businessId: body.businessId });
    const account = body.accountId ? ownedAccount(db, auth.tenantId, body.accountId) : ownedAccount(db, auth.tenantId, defaultAccount(db, body.businessId, 'cash'));
    if (account.business_id !== body.businessId) throw new HttpError(422, 'That account belongs to another business.');
    const id = uid();
    db.run(
      "insert into pos_shift (id, tenant_id, business_id, account_id, opened_by, opened_by_name, opened_at, opening_float, status, notes) values (?,?,?,?,?,?,?,?,'open',?)",
      id, auth.tenantId, body.businessId, account.id, auth.userId, auth.name, now(), body.openingFloat, body.notes,
    );
    db.audit(auth.tenantId, auth.userId, 'pos.shift_open', 'pos_shift', id, { float: body.openingFloat });
    return getShift(db, auth.tenantId, id);
  });
}

function openShiftOf(db: Db, auth: AuthContext, shiftId: string): PosShift {
  const s = getShift(db, auth.tenantId, shiftId);
  if (s.status !== 'open') throw new HttpError(409, 'This shift is closed. Open a new shift to sell.');
  if (db.get('select opened_by from pos_shift where id = ?', shiftId)!.opened_by !== auth.userId && !can({ auth }, 'pos.manage')) throw new HttpError(403, 'This shift belongs to another cashier.');
  return s;
}

export const cashMoveSchema = z.object({ kind: z.enum(['in', 'out']), amount: z.number().int().min(1).max(1e13), reason: z.string().trim().min(2, 'Give a reason').max(200) });

/** Cash put into or taken out of the drawer (change, safe drop). It changes the expected count only. */
export function cashMove(db: Db, auth: AuthContext, shiftId: string, body: z.infer<typeof cashMoveSchema>): ZReport {
  openShiftOf(db, auth, shiftId);
  db.run('insert into pos_cash_move (id, tenant_id, shift_id, kind, amount, reason, by_name, at) values (?,?,?,?,?,?,?,?)', uid(), auth.tenantId, shiftId, body.kind, body.amount, body.reason, auth.name, now());
  db.audit(auth.tenantId, auth.userId, `pos.cash_${body.kind}`, 'pos_shift', shiftId, { amount: body.amount, reason: body.reason });
  return zReport(db, auth.tenantId, shiftId);
}

/** Everything that happened in a shift, and the cash the drawer should hold. */
export function zReport(db: Db, tenantId: string, shiftId: string): ZReport {
  const shift = getShift(db, tenantId, shiftId);
  const biz = db.get('select currency, currency_precision from business where id = ?', shift.businessId)!;
  const invoices = db.all("select total, overall_discount, item_discounts, tax_amount from invoice where pos_shift_id = ? and status = 'final'", shiftId);
  const payments = db.all("select method, amount, account_id from payment where pos_shift_id = ? and verification_status <> 'rejected'", shiftId);
  const tenderOf = (m: string): PosTender => (Object.entries(TENDER_METHOD).find(([, v]) => v === m)?.[0] as PosTender) ?? 'bank_transfer';
  const by = new Map<PosTender, number>();
  for (const p of payments) by.set(tenderOf(p.method), (by.get(tenderOf(p.method)) ?? 0) + p.amount);
  const salesTotal = invoices.reduce((s, i) => s + i.total, 0);
  const paid = [...by.values()].reduce((s, v) => s + v, 0);
  // what was not paid at the counter was sold on udhaar
  const credit = db.all("select coalesce(sum(total), 0) as t from invoice where pos_shift_id = ? and status = 'final'", shiftId)[0].t - db.all("select coalesce(sum(p.amount), 0) as t from payment p where p.pos_shift_id = ? and p.verification_status <> 'rejected'", shiftId)[0].t;
  if (credit > 0) by.set('credit', credit);
  const moves = db.all('select * from pos_cash_move where shift_id = ? order by at', shiftId).map((m) => ({ id: m.id, kind: m.kind, amount: m.amount, reason: m.reason, at: m.at, byName: m.by_name }));
  const cashIn = moves.filter((m) => m.kind === 'in').reduce((s, m) => s + m.amount, 0);
  const cashOut = moves.filter((m) => m.kind === 'out').reduce((s, m) => s + m.amount, 0);
  const returns = db.all("select total from credit_note where pos_shift_id = ? and status = 'final'", shiftId);
  const cashRefunds = db.get('select coalesce(sum(amount), 0) as s from client_refund where pos_shift_id = ? and account_id = ?', shiftId, shift.accountId)!.s;
  const cashSales = payments.filter((p) => p.method === 'cash' && p.account_id === shift.accountId).reduce((s, p) => s + p.amount, 0);
  void paid;
  return {
    shift,
    sales: invoices.length,
    salesTotal,
    byTender: POS_TENDERS.filter((t) => by.has(t)).map((t) => ({ tender: t, amount: by.get(t)! })),
    discounts: invoices.reduce((s, i) => s + i.overall_discount + i.item_discounts, 0),
    tax: invoices.reduce((s, i) => s + i.tax_amount, 0),
    returns: returns.length,
    returnsTotal: returns.reduce((s, r) => s + r.total, 0),
    cashIn,
    cashOut,
    cashRefunds,
    expectedCash: shift.openingFloat + cashSales + cashIn - cashOut - cashRefunds,
    moves,
    currency: biz.currency,
    currencyPrecision: biz.currency_precision,
  };
}

export const closeSchema = z.object({ counted: minor, notes: z.string().trim().max(500).default('') });

/** Blind count at the end of the shift; a difference is recorded as cash over or short. */
export function closeShift(db: Db, auth: AuthContext, shiftId: string, body: z.infer<typeof closeSchema>): ZReport {
  return db.tx(() => {
    const s = openShiftOf(db, auth, shiftId);
    const expected = zReport(db, auth.tenantId, shiftId).expectedCash;
    const difference = body.counted - expected;
    if (difference !== 0) {
      assertDayOpen(db, auth.tenantId, s.businessId, today());
      db.run(
        "insert into finance_entry (id, tenant_id, business_id, type, category, amount, date, method, party, notes, account_id, created_by, created_at) values (?,?,?,?,?,?,?,'cash',?,?,?,?,?)",
        uid(), auth.tenantId, s.businessId, difference > 0 ? 'income' : 'expense', difference > 0 ? 'Cash over' : 'Cash short', Math.abs(difference), today(), s.openedByName, `POS shift close${body.notes ? ` · ${body.notes}` : ''}`, s.accountId, auth.userId, now(),
      );
    }
    db.run("update pos_shift set status = 'closed', closed_at = ?, closed_by_name = ?, counted = ?, expected = ?, difference = ?, notes = ? where id = ?", now(), auth.name, body.counted, expected, difference, body.notes || s.notes, shiftId);
    db.audit(auth.tenantId, auth.userId, 'pos.shift_close', 'pos_shift', shiftId, { expected, counted: body.counted, difference });
    return zReport(db, auth.tenantId, shiftId);
  });
}

// ================================================================ sales

/** The customer counter sales go to when nobody is named. */
export function walkInClient(db: Db, auth: AuthContext): string {
  const found = db.get("select id from client where tenant_id = ? and category = 'Walk-in' order by created_at limit 1", auth.tenantId);
  if (found) return found.id;
  const id = uid();
  db.run("insert into client (id, tenant_id, name, category, notes, created_at) values (?,?,'Walk-in customer','Walk-in','Counter sales without a named customer',?)", id, auth.tenantId, now());
  return id;
}

export const saleSchema = z.object({
  shiftId: z.string().min(1),
  clientId: z.string().nullable().default(null),
  lines: z.array(lineSchema).min(1, 'Add at least one item').max(300),
  billDiscountType: z.enum(['percent', 'fixed']).default('fixed'),
  billDiscountValue: minor.default(0),
  /** how the bill is paid; must add up to the total. 'credit' leaves that part as udhaar. */
  tenders: z.array(z.object({ tender: z.enum(POS_TENDERS), amount: z.number().int().min(1).max(1e13) })).min(1).max(8),
  /** cash handed over, for the change shown on the receipt */
  cashGiven: minor.optional(),
  heldId: z.string().nullable().default(null),
  clientRequestId: z.string().min(8).max(64).optional(),
});

export function sell(db: Db, auth: AuthContext, body: z.infer<typeof saleSchema>) {
  return db.tx(() => {
    const shift = openShiftOf(db, auth, body.shiftId);
    if (body.clientRequestId) {
      const dup = db.get('select id from invoice where tenant_id = ? and client_request_id = ?', auth.tenantId, body.clientRequestId);
      if (dup) return { invoice: getInvoice(db, auth.tenantId, dup.id), change: 0 };
    }
    assertLimit(db, auth.tenantId, 'invoice');
    const walkIn = walkInClient(db, auth);
    const clientId = body.clientId ?? walkIn;
    if (body.tenders.some((t) => t.tender === 'credit') && clientId === walkIn) throw new HttpError(422, 'Choose the customer to sell on udhaar.');
    const t = today();
    const inv = createInvoice(
      db,
      auth,
      invoiceSchema.parse({
        businessId: shift.businessId,
        clientId,
        issueDate: t,
        dueDate: t,
        lines: body.lines.map((l) => ({ ...l, description: '' })),
        overallDiscountType: body.billDiscountType,
        overallDiscountValue: body.billDiscountValue,
        reference: 'POS',
        finalize: true,
        clientRequestId: body.clientRequestId,
        custom: undefined,
      }),
      true,
    );
    // cashiers may give a limited discount; more needs a manager
    const discount = inv.itemDiscounts + inv.overallDiscount;
    if (inv.subtotal > 0 && discount * 10_000 > inv.subtotal * CASHIER_DISCOUNT_LIMIT_BP && !can({ auth }, 'pos.manage')) {
      throw new HttpError(403, `Discounts above ${CASHIER_DISCOUNT_LIMIT_BP / 100}% need a manager.`);
    }
    const tendered = body.tenders.reduce((s, x) => s + x.amount, 0);
    if (tendered !== inv.total) throw new HttpError(422, `The payments add up to ${tendered / 10 ** inv.currencyPrecision} but the bill is ${inv.total / 10 ** inv.currencyPrecision}.`);
    for (const x of body.tenders) {
      if (x.tender === 'credit') continue;
      const method = TENDER_METHOD[x.tender];
      const accountId = x.tender === 'cash' ? shift.accountId : defaultAccount(db, shift.businessId, accountTypeFor(method));
      const p = recordPayment(db, auth, { clientId, businessId: shift.businessId, invoiceId: inv.id, amount: x.amount, date: t, method, reference: '', notes: 'POS', proof: '', autoAllocate: false, accountId }, true);
      db.run('update payment set pos_shift_id = ? where id = ?', shift.id, p.id);
    }
    db.run('update invoice set pos_shift_id = ? where id = ?', shift.id, inv.id);
    if (body.heldId) db.run('delete from pos_held where id = ? and tenant_id = ?', body.heldId, auth.tenantId);
    const cash = body.tenders.find((x) => x.tender === 'cash')?.amount ?? 0;
    const change = body.cashGiven !== undefined && body.cashGiven > cash ? body.cashGiven - cash : 0;
    db.audit(auth.tenantId, auth.userId, 'pos.sale', 'invoice', inv.id, { total: inv.total, shift: shift.id });
    return { invoice: getInvoice(db, auth.tenantId, inv.id), change };
  });
}

/** A sale found by its receipt (invoice) number, for returns and reprints. */
export function findSale(db: Db, tenantId: string, number: string) {
  const r = db.get(`${INVOICE_SELECT} where i.tenant_id = ? and i.number = ? and i.status = 'final'`, tenantId, number.trim());
  if (!r) throw new HttpError(404, 'No sale with this receipt number.');
  return getInvoice(db, tenantId, r.id);
}

export const returnSchema = z.object({
  shiftId: z.string().min(1),
  invoiceId: z.string().min(1),
  lines: z.array(lineSchema.pick({ serviceId: true, name: true, qty: true, unit: true, unitPrice: true })).min(1).max(300),
  reason: z.string().trim().min(2, 'Give a reason').max(300),
  refundTender: z.enum(['cash', 'card', 'jazzcash', 'easypaisa', 'bank_transfer']).default('cash'),
});

/**
 * Return goods from a sale: stock comes back, the sale is reduced with a credit note, and
 * whatever the customer had already paid for those goods is refunded (cash from the drawer).
 */
export function returnSale(db: Db, auth: AuthContext, body: z.infer<typeof returnSchema>) {
  return db.tx(() => {
    const shift = openShiftOf(db, auth, body.shiftId);
    if (!can({ auth }, 'pos.manage') && !can({ auth }, 'invoices.cancel')) throw new HttpError(403, 'Returns need a manager.');
    const inv = getInvoice(db, auth.tenantId, body.invoiceId);
    if (inv.status !== 'final') throw new HttpError(409, 'Only completed sales can be returned.');
    const amount = body.lines.reduce((s, l) => s + Math.round((l.qty * l.unitPrice) / 1000), 0);
    const room = inv.total - (inv.credited ?? 0);
    if (amount > room) throw new HttpError(422, `At most ${room / 10 ** inv.currencyPrecision} of this sale can still be returned.`);
    // first release payments from the sale so the credit note can cover the paid part
    const unpaid = inv.total - inv.paid;
    let toRefund = Math.max(0, amount - unpaid);
    let release = toRefund;
    for (const a of db.all('select a.id, a.amount from payment_allocation a where a.invoice_id = ? order by a.created_at desc', inv.id)) {
      if (release <= 0) break;
      const take = Math.min(release, a.amount);
      if (take === a.amount) db.run('delete from payment_allocation where id = ?', a.id);
      else db.run('update payment_allocation set amount = amount - ? where id = ?', take, a.id);
      release -= take;
    }
    toRefund -= release;
    const note = createCreditNote(db, auth, { invoiceId: inv.id, date: today(), reason: body.reason, restock: true, lines: body.lines });
    db.run('update credit_note set pos_shift_id = ? where id = ?', shift.id, note.id);
    let refund = 0;
    if (toRefund > 0) {
      const method = TENDER_METHOD[body.refundTender];
      const r = refundCredit(db, auth, inv.clientId, { businessId: shift.businessId, amount: toRefund, date: today(), method, accountId: body.refundTender === 'cash' ? shift.accountId : null, notes: `Return on ${inv.number}` });
      db.run('update client_refund set pos_shift_id = ? where id = ?', shift.id, r.id);
      refund = toRefund;
    }
    db.audit(auth.tenantId, auth.userId, 'pos.return', 'invoice', inv.id, { amount, refund });
    return { note, refund, invoice: getInvoice(db, auth.tenantId, inv.id) };
  });
}

// ================================================================ held bills

export const holdSchema = z.object({
  name: z.string().trim().max(60).default(''),
  clientId: z.string().nullable().default(null),
  lines: z.array(lineSchema).min(1).max(300),
  billDiscount: minor.default(0),
});

const mapHeld = (r: Row): HeldBill => ({ id: r.id, name: r.name, clientId: r.client_id, lines: JSON.parse(r.lines), billDiscount: r.bill_discount, byName: r.by_name, createdAt: r.created_at });

export function listHeld(db: Db, tenantId: string): HeldBill[] {
  return db.all('select * from pos_held where tenant_id = ? order by created_at desc limit 50', tenantId).map(mapHeld);
}

export function holdBill(db: Db, auth: AuthContext, body: z.infer<typeof holdSchema>): HeldBill {
  const id = uid();
  const count = db.get('select count(*) as n from pos_held where tenant_id = ?', auth.tenantId)!.n;
  db.run('insert into pos_held (id, tenant_id, name, client_id, lines, bill_discount, by_name, created_at) values (?,?,?,?,?,?,?,?)', id, auth.tenantId, body.name || `Bill ${count + 1}`, body.clientId, JSON.stringify(body.lines), body.billDiscount, auth.name, now());
  return mapHeld(db.get('select * from pos_held where id = ?', id)!);
}

export function dropHeld(db: Db, auth: AuthContext, id: string) {
  db.run('delete from pos_held where id = ? and tenant_id = ?', id, auth.tenantId);
}

export { lineSchema as posLineSchema };
