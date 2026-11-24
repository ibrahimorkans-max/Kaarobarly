import { z } from 'zod';
import { lineAmount, type DocLine, type GoodsReceipt, type PurchaseOrder, type PurchaseRequest, type Supplier } from '../../../packages/shared/src/index';
import { now, today, uid, type Db, type Row } from './core';
import { ownedRow } from './domain';
import { HttpError, type AuthContext } from './perm';
import { getPurchase, purchaseSchema, savePurchase, supplierFor } from './purchases';
import { clearMoves, postIncoming } from './stock';
import { cleanCustom, customSchema, parseCustom } from './workspace';

/**
 * Buying: suppliers, purchase requests (demand), purchase orders, goods received notes and the
 * bill made from a receipt. Goods received put stock in; the bill records what is owed/paid.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const text = (max = 500) => z.string().trim().max(max).default('');
const lineSchema = z.object({
  itemId: z.string().nullable().default(null),
  name: z.string().trim().min(1, 'Every item needs a name').max(200),
  qty: z.number().int().min(1, 'Quantity must be above zero').max(1e12),
  unit: text(20),
  unitPrice: z.number().int().min(0).max(1e13).default(0),
  note: text(300),
  batch: z.string().trim().max(60).default(''),
  expiry: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiry must be YYYY-MM-DD'), z.literal('')]).default(''),
});
type LineIn = z.infer<typeof lineSchema>;

const num = (db: Db, tenantId: string, key: string, prefix: string) => `${prefix}${String(db.nextCounter(tenantId, key)).padStart(4, '0')}`;
const withAmounts = (lines: LineIn[]): DocLine[] => lines.map((l) => ({ ...l, amount: lineAmount(l.qty, l.unitPrice) }));
const json = <T>(s: string, fallback: T): T => {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
};

function checkItems(db: Db, tenantId: string, lines: { itemId: string | null }[]) {
  for (const l of lines) if (l.itemId && !db.get('select 1 from service where id = ? and tenant_id = ?', l.itemId, tenantId)) throw new HttpError(422, 'One of the items no longer exists.');
}

// ---------------------------------------------------------------- suppliers

export const supplierSchema = z.object({
  name: z.string().trim().min(1, 'Supplier name is required').max(200),
  contactPerson: text(200),
  phone: text(50),
  email: text(200),
  address: text(1000),
  ntn: text(50),
  openingBalance: z.number().int().min(-1e13).max(1e13).default(0),
  notes: text(4000),
  status: z.enum(['active', 'inactive']).default('active'),
  custom: customSchema,
});

const SUPPLIER_SELECT = `select s.*,
  coalesce((select sum(p.total) from purchase p where p.supplier_id = s.id), 0) as bought,
  coalesce((select sum(p.total) from purchase p where p.supplier_id = s.id), 0) as billed
  from supplier s`;

/** Paid so far on a bill: everything, or only the installments marked paid. */
function billPaid(r: Row): number {
  const plan = json<{ amount: number; paid: boolean }[]>(r.installments || '[]', []);
  return plan.length ? plan.filter((x) => x.paid).reduce((a, x) => a + x.amount, 0) : r.total;
}

function supplierOwed(db: Db, id: string, opening: number): number {
  return opening + db.all('select total, installments from purchase where supplier_id = ?', id).reduce((a, r) => a + (r.total - billPaid(r)), 0);
}

function mapSupplier(db: Db, r: Row): Supplier {
  return {
    id: r.id,
    name: r.name,
    contactPerson: r.contact_person,
    phone: r.phone,
    email: r.email,
    address: r.address,
    ntn: r.ntn,
    openingBalance: r.opening_balance,
    notes: r.notes,
    status: r.status,
    custom: parseCustom(r.custom),
    bought: r.bought ?? undefined,
    owed: supplierOwed(db, r.id, r.opening_balance),
  };
}

export function listSuppliers(db: Db, tenantId: string, q = ''): Supplier[] {
  const like = `%${q}%`;
  return db.all(`${SUPPLIER_SELECT} where s.tenant_id = ? and (s.name like ? or s.phone like ? or s.contact_person like ?) order by s.name collate nocase limit 500`, tenantId, like, like, like).map((r) => mapSupplier(db, r));
}

export function getSupplier(db: Db, tenantId: string, id: string): Supplier {
  const r = db.get(`${SUPPLIER_SELECT} where s.tenant_id = ? and s.id = ?`, tenantId, id);
  if (!r) throw new HttpError(404, 'Supplier not found.');
  return mapSupplier(db, r);
}

export function saveSupplier(db: Db, auth: AuthContext, body: z.infer<typeof supplierSchema>, id?: string): Supplier {
  return db.tx(() => {
    const custom = JSON.stringify(cleanCustom(db, auth.tenantId, 'supplier', body.custom));
    if (id) {
      getSupplier(db, auth.tenantId, id);
      db.run(
        'update supplier set name=?, contact_person=?, phone=?, email=?, address=?, ntn=?, opening_balance=?, notes=?, status=?, custom=? where id=? and tenant_id=?',
        body.name, body.contactPerson, body.phone, body.email, body.address, body.ntn, body.openingBalance, body.notes, body.status, custom, id, auth.tenantId,
      );
      // bills keep the supplier's current name
      db.run('update purchase set supplier = ? where supplier_id = ? and tenant_id = ?', body.name, id, auth.tenantId);
    } else {
      const dup = db.get('select id from supplier where tenant_id = ? and lower(name) = lower(?)', auth.tenantId, body.name);
      if (dup) throw new HttpError(409, `${body.name} is already in your supplier list.`);
      id = uid();
      db.run(
        'insert into supplier (id, tenant_id, name, contact_person, phone, email, address, ntn, opening_balance, notes, status, custom, created_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        id, auth.tenantId, body.name, body.contactPerson, body.phone, body.email, body.address, body.ntn, body.openingBalance, body.notes, body.status, custom, now(),
      );
      // bills typed with this name before the supplier existed now belong to it
      db.run('update purchase set supplier_id = ? where tenant_id = ? and supplier_id is null and lower(supplier) = lower(?)', id, auth.tenantId, body.name);
    }
    db.audit(auth.tenantId, auth.userId, 'supplier.save', 'supplier', id, { name: body.name });
    return getSupplier(db, auth.tenantId, id);
  });
}

/** A supplier's bills, orders and receipts, newest first. */
export function supplierActivity(db: Db, tenantId: string, id: string) {
  const supplier = getSupplier(db, tenantId, id);
  const purchases = db.all('select id from purchase where tenant_id = ? and supplier_id = ? order by date desc, created_at desc limit 100', tenantId, id).map((r) => getPurchase(db, tenantId, r.id));
  const orders = db.all(`${ORDER_SELECT} where o.tenant_id = ? and o.supplier_id = ? order by o.date desc limit 100`, tenantId, id).map(mapOrder);
  const receipts = db.all(`${RECEIPT_SELECT} where g.tenant_id = ? and g.supplier_id = ? order by g.date desc limit 100`, tenantId, id).map(mapReceipt);
  return { supplier, purchases, orders, receipts };
}

export { supplierFor };

// ---------------------------------------------------------------- purchase requests (demand)

export const requestSchema = z.object({
  businessId: z.string().min(1, 'Choose a business'),
  date: isoDate.optional(),
  neededBy: z.union([isoDate, z.literal('')]).default(''),
  lines: z.array(lineSchema).min(1, 'Add at least one item').max(200),
  notes: text(2000),
});

function mapRequest(r: Row): PurchaseRequest {
  return {
    id: r.id,
    number: r.number,
    businessId: r.business_id,
    date: r.date,
    neededBy: r.needed_by,
    lines: json(r.lines, []),
    notes: r.notes,
    status: r.status,
    requestedBy: r.requested_by,
    requestedByName: r.requested_by_name,
    decidedByName: r.decided_by_name,
    decidedAt: r.decided_at,
    decisionNote: r.decision_note,
    orderId: r.order_id,
    createdAt: r.created_at,
  };
}

export function listRequests(db: Db, tenantId: string, status = ''): PurchaseRequest[] {
  return db
    .all(`select * from purchase_request where tenant_id = ? ${status ? 'and status = ?' : ''} order by date desc, created_at desc limit 200`, tenantId, ...(status ? [status] : []))
    .map(mapRequest);
}

export function getRequest(db: Db, tenantId: string, id: string): PurchaseRequest {
  const r = db.get('select * from purchase_request where id = ? and tenant_id = ?', id, tenantId);
  if (!r) throw new HttpError(404, 'Purchase request not found.');
  return mapRequest(r);
}

export function saveRequest(db: Db, auth: AuthContext, body: z.infer<typeof requestSchema>, id?: string): PurchaseRequest {
  return db.tx(() => {
    ownedRow(db, 'business', auth.tenantId, body.businessId);
    checkItems(db, auth.tenantId, body.lines);
    const lines = JSON.stringify(withAmounts(body.lines));
    const t = now();
    if (id) {
      const old = getRequest(db, auth.tenantId, id);
      if (old.status !== 'pending') throw new HttpError(409, 'Only pending requests can be edited.');
      db.run('update purchase_request set business_id=?, date=?, needed_by=?, lines=?, notes=?, updated_at=? where id=?', body.businessId, body.date ?? old.date, body.neededBy, lines, body.notes, t, id);
    } else {
      id = uid();
      db.run(
        "insert into purchase_request (id, tenant_id, business_id, number, date, needed_by, lines, notes, status, requested_by, requested_by_name, created_at, updated_at) values (?,?,?,?,?,?,?,?,'pending',?,?,?,?)",
        id, auth.tenantId, body.businessId, num(db, auth.tenantId, 'request', 'REQ-'), body.date ?? today(), body.neededBy, lines, body.notes, auth.userId, auth.name, t, t,
      );
    }
    db.audit(auth.tenantId, auth.userId, 'request.save', 'purchase_request', id);
    return getRequest(db, auth.tenantId, id);
  });
}

export function decideRequest(db: Db, auth: AuthContext, id: string, decision: 'approved' | 'rejected', note: string): PurchaseRequest {
  return db.tx(() => {
    const r = getRequest(db, auth.tenantId, id);
    if (r.status !== 'pending') throw new HttpError(409, `This request is already ${r.status}.`);
    db.run('update purchase_request set status=?, decided_by_name=?, decided_at=?, decision_note=?, updated_at=? where id=?', decision, auth.name, now(), note, now(), id);
    db.audit(auth.tenantId, auth.userId, `request.${decision}`, 'purchase_request', id);
    return getRequest(db, auth.tenantId, id);
  });
}

export function deleteRequest(db: Db, auth: AuthContext, id: string) {
  const r = getRequest(db, auth.tenantId, id);
  if (r.status === 'ordered') throw new HttpError(409, 'An ordered request cannot be deleted.');
  if (r.requestedBy !== auth.userId && !['owner', 'manager'].includes(auth.role)) throw new HttpError(403, 'Only the person who raised it or a manager can delete this request.');
  db.run('delete from purchase_request where id = ?', id);
  db.audit(auth.tenantId, auth.userId, 'request.delete', 'purchase_request', id);
}

// ---------------------------------------------------------------- purchase orders

export const orderSchema = z.object({
  businessId: z.string().min(1, 'Choose a business'),
  supplierId: z.string().min(1, 'Choose a supplier'),
  requestId: z.string().nullable().default(null),
  date: isoDate,
  expectedDate: z.union([isoDate, z.literal('')]).default(''),
  lines: z.array(lineSchema).min(1, 'Add at least one item').max(200),
  notes: text(2000),
  terms: text(2000),
});

const ORDER_SELECT = `select o.*, s.name as supplier_name, b.currency, b.currency_precision
  from purchase_order o join supplier s on s.id = o.supplier_id join business b on b.id = o.business_id`;

function mapOrder(r: Row): PurchaseOrder {
  return {
    id: r.id,
    number: r.number,
    businessId: r.business_id,
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    requestId: r.request_id,
    date: r.date,
    expectedDate: r.expected_date,
    lines: json(r.lines, []),
    total: r.total,
    notes: r.notes,
    terms: r.terms,
    status: r.status,
    currency: r.currency,
    currencyPrecision: r.currency_precision,
    createdAt: r.created_at,
  };
}

export function listOrders(db: Db, tenantId: string, status = ''): PurchaseOrder[] {
  const open = status === 'open';
  const where = open ? "and o.status in ('sent','partial')" : status ? 'and o.status = ?' : '';
  return db.all(`${ORDER_SELECT} where o.tenant_id = ? ${where} order by o.date desc, o.created_at desc limit 200`, tenantId, ...(status && !open ? [status] : [])).map(mapOrder);
}

export function getOrder(db: Db, tenantId: string, id: string): PurchaseOrder {
  const r = db.get(`${ORDER_SELECT} where o.id = ? and o.tenant_id = ?`, id, tenantId);
  if (!r) throw new HttpError(404, 'Purchase order not found.');
  return mapOrder(r);
}

export function saveOrder(db: Db, auth: AuthContext, body: z.infer<typeof orderSchema>, id?: string): PurchaseOrder {
  return db.tx(() => {
    ownedRow(db, 'business', auth.tenantId, body.businessId);
    getSupplier(db, auth.tenantId, body.supplierId);
    checkItems(db, auth.tenantId, body.lines);
    const lines = withAmounts(body.lines).map((l) => ({ ...l, received: 0 }));
    const total = lines.reduce((a, l) => a + l.amount, 0);
    const t = now();
    if (id) {
      const old = getOrder(db, auth.tenantId, id);
      if (old.status !== 'draft') throw new HttpError(409, 'Only draft orders can be edited. Cancel it and make a new one.');
      db.run('update purchase_order set business_id=?, supplier_id=?, date=?, expected_date=?, lines=?, total=?, notes=?, terms=?, updated_at=? where id=?', body.businessId, body.supplierId, body.date, body.expectedDate, JSON.stringify(lines), total, body.notes, body.terms, t, id);
    } else {
      if (body.requestId) {
        const req = getRequest(db, auth.tenantId, body.requestId);
        if (req.status !== 'approved') throw new HttpError(409, req.status === 'pending' ? 'This request has not been approved yet.' : `This request is ${req.status}.`);
      }
      id = uid();
      db.run(
        "insert into purchase_order (id, tenant_id, business_id, number, supplier_id, request_id, date, expected_date, lines, total, notes, terms, status, created_by, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?)",
        id, auth.tenantId, body.businessId, num(db, auth.tenantId, 'order', 'PO-'), body.supplierId, body.requestId, body.date, body.expectedDate, JSON.stringify(lines), total, body.notes, body.terms, auth.userId, t, t,
      );
      if (body.requestId) db.run("update purchase_request set status = 'ordered', order_id = ?, updated_at = ? where id = ?", id, t, body.requestId);
    }
    db.audit(auth.tenantId, auth.userId, 'order.save', 'purchase_order', id, { total });
    return getOrder(db, auth.tenantId, id);
  });
}

const ORDER_MOVES: Record<string, string[]> = { draft: ['sent', 'cancelled'], sent: ['cancelled', 'closed'], partial: ['closed'], received: ['closed'] };

/** Send, cancel or close an order (receiving is done with goods received notes). */
export function setOrderStatus(db: Db, auth: AuthContext, id: string, status: 'sent' | 'cancelled' | 'closed'): PurchaseOrder {
  return db.tx(() => {
    const o = getOrder(db, auth.tenantId, id);
    if (!(ORDER_MOVES[o.status] ?? []).includes(status)) throw new HttpError(409, `A ${o.status} order cannot be marked ${status}.`);
    db.run('update purchase_order set status = ?, updated_at = ? where id = ?', status, now(), id);
    // a cancelled order frees its request to be ordered again
    if (status === 'cancelled' && o.requestId) db.run("update purchase_request set status = 'approved', order_id = null where id = ? and order_id = ?", o.requestId, id);
    db.audit(auth.tenantId, auth.userId, `order.${status}`, 'purchase_order', id);
    return getOrder(db, auth.tenantId, id);
  });
}

export function deleteOrder(db: Db, auth: AuthContext, id: string) {
  db.tx(() => {
    const o = getOrder(db, auth.tenantId, id);
    if (o.status !== 'draft') throw new HttpError(409, 'Only draft orders can be deleted. Cancel it instead.');
    db.run('delete from purchase_order where id = ?', id);
    if (o.requestId) db.run("update purchase_request set status = 'approved', order_id = null where id = ? and order_id = ?", o.requestId, id);
    db.audit(auth.tenantId, auth.userId, 'order.delete', 'purchase_order', id);
  });
}

/** Recount what has been received on each order line from its receipts, and set the status. */
function refreshOrder(db: Db, tenantId: string, orderId: string) {
  const o = db.get('select * from purchase_order where id = ? and tenant_id = ?', orderId, tenantId);
  if (!o) return;
  const lines = json<DocLine[]>(o.lines, []).map((l) => ({ ...l, received: 0 }));
  for (const g of db.all('select lines from goods_receipt where order_id = ? and tenant_id = ?', orderId, tenantId)) {
    for (const gl of json<(DocLine & { orderLine?: number })[]>(g.lines, [])) {
      if (gl.orderLine !== undefined && lines[gl.orderLine]) lines[gl.orderLine].received = (lines[gl.orderLine].received ?? 0) + gl.qty;
    }
  }
  const any = lines.some((l) => (l.received ?? 0) > 0);
  const all = lines.every((l) => (l.received ?? 0) >= l.qty);
  let status = o.status;
  if (o.status !== 'closed' && o.status !== 'cancelled') status = all ? 'received' : any ? 'partial' : o.status === 'draft' ? 'draft' : 'sent';
  db.run('update purchase_order set lines = ?, status = ?, updated_at = ? where id = ?', JSON.stringify(lines), status, now(), orderId);
}

// ---------------------------------------------------------------- goods received

export const receiptSchema = z.object({
  businessId: z.string().min(1, 'Choose a business'),
  supplierId: z.string().min(1, 'Choose a supplier'),
  orderId: z.string().nullable().default(null),
  date: isoDate,
  lines: z
    .array(lineSchema.extend({ orderLine: z.number().int().min(0).optional() }))
    .min(1, 'Add at least one item')
    .max(200),
  notes: text(2000),
});

const RECEIPT_SELECT = `select g.*, s.name as supplier_name, coalesce(o.number, '') as order_number, coalesce(p.number, '') as purchase_number, b.currency, b.currency_precision
  from goods_receipt g join supplier s on s.id = g.supplier_id join business b on b.id = g.business_id
  left join purchase_order o on o.id = g.order_id left join purchase p on p.id = g.purchase_id`;

function mapReceipt(r: Row): GoodsReceipt {
  return {
    id: r.id,
    number: r.number,
    businessId: r.business_id,
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    orderId: r.order_id,
    orderNumber: r.order_number,
    date: r.date,
    lines: json(r.lines, []),
    total: r.total,
    notes: r.notes,
    purchaseId: r.purchase_id,
    purchaseNumber: r.purchase_number,
    currency: r.currency,
    currencyPrecision: r.currency_precision,
    createdAt: r.created_at,
  };
}

export function listReceipts(db: Db, tenantId: string, unbilled = false): GoodsReceipt[] {
  return db.all(`${RECEIPT_SELECT} where g.tenant_id = ? ${unbilled ? 'and g.purchase_id is null' : ''} order by g.date desc, g.created_at desc limit 200`, tenantId).map(mapReceipt);
}

export function getReceipt(db: Db, tenantId: string, id: string): GoodsReceipt {
  const r = db.get(`${RECEIPT_SELECT} where g.id = ? and g.tenant_id = ?`, id, tenantId);
  if (!r) throw new HttpError(404, 'Goods received note not found.');
  return mapReceipt(r);
}

/** Record goods that arrived (against an order or not). Tracked items go into stock. */
export function createReceipt(db: Db, auth: AuthContext, body: z.infer<typeof receiptSchema>): GoodsReceipt {
  return db.tx(() => {
    ownedRow(db, 'business', auth.tenantId, body.businessId);
    getSupplier(db, auth.tenantId, body.supplierId);
    checkItems(db, auth.tenantId, body.lines);
    if (body.orderId) {
      const o = getOrder(db, auth.tenantId, body.orderId);
      if (o.supplierId !== body.supplierId) throw new HttpError(422, 'The receipt and the order are for different suppliers.');
      if (o.status === 'draft') throw new HttpError(409, 'Mark the order as sent before receiving goods against it.');
      if (o.status === 'cancelled' || o.status === 'closed') throw new HttpError(409, `This order is ${o.status}.`);
      for (const l of body.lines) {
        if (l.orderLine === undefined) continue;
        const ol = o.lines[l.orderLine];
        if (!ol) throw new HttpError(422, 'A line does not match the order.');
        const left = ol.qty - (ol.received ?? 0);
        if (l.qty > left) throw new HttpError(422, `${ol.name}: only ${left / 1000} ${ol.unit} still to receive on ${o.number}.`);
      }
    }
    const lines = body.lines.map((l) => ({ ...l, amount: lineAmount(l.qty, l.unitPrice) }));
    const total = lines.reduce((a, l) => a + l.amount, 0);
    const id = uid();
    const number = num(db, auth.tenantId, 'receipt', 'GRN-');
    db.run(
      'insert into goods_receipt (id, tenant_id, business_id, number, supplier_id, order_id, date, lines, total, notes, created_by, created_at) values (?,?,?,?,?,?,?,?,?,?,?,?)',
      id, auth.tenantId, body.businessId, number, body.supplierId, body.orderId, body.date, JSON.stringify(lines), total, body.notes, auth.userId, now(),
    );
    postIncoming(db, auth, 'receipt', id, number, body.date, lines);
    if (body.orderId) refreshOrder(db, auth.tenantId, body.orderId);
    db.audit(auth.tenantId, auth.userId, 'receipt.create', 'goods_receipt', id, { total });
    return getReceipt(db, auth.tenantId, id);
  });
}

export function deleteReceipt(db: Db, auth: AuthContext, id: string) {
  db.tx(() => {
    const g = getReceipt(db, auth.tenantId, id);
    if (g.purchaseId) throw new HttpError(409, `This receipt is billed on ${g.purchaseNumber}. Delete that bill first.`);
    clearMoves(db, auth.tenantId, 'receipt', id);
    db.run('delete from goods_receipt where id = ?', id);
    if (g.orderId) refreshOrder(db, auth.tenantId, g.orderId);
    db.audit(auth.tenantId, auth.userId, 'receipt.delete', 'goods_receipt', id);
  });
}

/** Turn a goods receipt into a purchase bill (money owed or paid). Stock was already counted. */
export const billSchema = purchaseSchema.pick({ billNo: true, method: true, accountId: true, notes: true, reference: true, installments: true, attachment: true, category: true }).extend({
  date: isoDate.optional(),
});

export function billReceipt(db: Db, auth: AuthContext, id: string, body: z.infer<typeof billSchema>) {
  return db.tx(() => {
    const g = getReceipt(db, auth.tenantId, id);
    if (g.purchaseId) return getPurchase(db, auth.tenantId, g.purchaseId);
    if (g.total <= 0) throw new HttpError(422, 'Add prices to the received items before making a bill.');
    const p = savePurchase(db, auth, {
      ...body,
      businessId: g.businessId,
      supplier: g.supplierName,
      supplierId: g.supplierId,
      receiptId: g.id,
      date: body.date ?? g.date,
      lines: g.lines.map((l) => ({ itemId: l.itemId, name: l.name, qty: l.qty, unit: l.unit, unitPrice: l.unitPrice, batch: '', expiry: '' })),
      custom: {},
    });
    db.run('update goods_receipt set purchase_id = ? where id = ?', p.id, g.id);
    return getPurchase(db, auth.tenantId, p.id);
  });
}

/** Items at or below their reorder level, for the "what to buy" list. */
export function reorderList(db: Db, tenantId: string) {
  return db
    .all(
      `select s.id, s.name, s.unit, s.reorder_level, s.cost_price, coalesce((select sum(m.qty) from stock_move m where m.item_id = s.id), 0) as on_hand
       from service s where s.tenant_id = ? and s.track_stock = 1 and s.status = 'active'`,
      tenantId,
    )
    .filter((r) => r.on_hand <= r.reorder_level)
    .map((r) => ({ itemId: r.id, name: r.name, unit: r.unit, onHand: r.on_hand, reorderLevel: r.reorder_level, costPrice: r.cost_price }));
}

