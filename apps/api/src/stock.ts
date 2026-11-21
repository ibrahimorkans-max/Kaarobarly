import { z } from 'zod';
import type { StockItem, StockMove, StockMoveKind, StockSummary } from '../../../packages/shared/src/index';
import { now, today, uid, type Db, type Row } from './core';
import { HttpError, type AuthContext } from './perm';

/**
 * The stock ledger. Every change to a quantity is a row in stock_move (positive in, negative
 * out), so the count on hand is always the sum of its moves and can be explained line by line.
 * Only items with track_stock = 1 get moves.
 */

export interface MoveInput {
  itemId: string;
  qty: number;
  unitCost?: number;
  date: string;
  kind: StockMoveKind;
  refType: string;
  refId: string | null;
  refNumber?: string;
  note?: string;
}

export function onHand(db: Db, tenantId: string, itemId: string): number {
  return db.get('select coalesce(sum(qty), 0) as q from stock_move where tenant_id = ? and item_id = ?', tenantId, itemId)!.q;
}

export const isTracked = (db: Db, tenantId: string, itemId: string | null | undefined) =>
  !!itemId && !!db.get('select 1 from service where id = ? and tenant_id = ? and track_stock = 1', itemId, tenantId);

export function addMove(db: Db, auth: AuthContext, m: MoveInput) {
  if (!m.qty) return;
  db.run(
    'insert into stock_move (id, tenant_id, item_id, date, qty, unit_cost, kind, ref_type, ref_id, ref_number, note, created_by, created_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    uid(), auth.tenantId, m.itemId, m.date, m.qty, m.unitCost ?? 0, m.kind, m.refType, m.refId, m.refNumber ?? '', (m.note ?? '').slice(0, 500), auth.userId, now(),
  );
}

/** Remove every move a document made (before re-posting it, or when it is cancelled or deleted). */
export function clearMoves(db: Db, tenantId: string, refType: string, refId: string) {
  db.run('delete from stock_move where tenant_id = ? and ref_type = ? and ref_id = ?', tenantId, refType, refId);
}

/** Lines of a document that touch stock: tracked items only, quantities summed per item. */
function trackedLines(db: Db, tenantId: string, lines: { itemId?: string | null; serviceId?: string | null; qty: number; unitPrice?: number }[]) {
  const out = new Map<string, { qty: number; unitPrice: number }>();
  for (const l of lines) {
    const id = l.itemId ?? l.serviceId;
    if (!id || !isTracked(db, tenantId, id)) continue;
    const cur = out.get(id) ?? { qty: 0, unitPrice: l.unitPrice ?? 0 };
    cur.qty += l.qty;
    out.set(id, cur);
  }
  return out;
}

/** Stock leaves when an invoice is final; cancelling it puts the stock back. */
export function postInvoice(db: Db, auth: AuthContext, invoiceId: string) {
  const inv = db.get('select * from invoice where id = ? and tenant_id = ?', invoiceId, auth.tenantId);
  if (!inv) return;
  clearMoves(db, auth.tenantId, 'invoice', invoiceId);
  if (inv.status !== 'final') return;
  for (const [itemId, l] of trackedLines(db, auth.tenantId, JSON.parse(inv.lines))) {
    const cost = db.get('select cost_price from service where id = ?', itemId)!.cost_price;
    addMove(db, auth, { itemId, qty: -l.qty, unitCost: cost, date: inv.issue_date, kind: 'sale', refType: 'invoice', refId: invoiceId, refNumber: inv.number ?? '' });
  }
}

/** Stock arrives with goods received, or with a purchase bill that was not made from a receipt. */
export function postIncoming(db: Db, auth: AuthContext, refType: 'receipt' | 'purchase', refId: string, refNumber: string, date: string, lines: { itemId?: string | null; qty: number; unitPrice: number }[]) {
  clearMoves(db, auth.tenantId, refType, refId);
  for (const [itemId, l] of trackedLines(db, auth.tenantId, lines)) {
    addMove(db, auth, { itemId, qty: l.qty, unitCost: l.unitPrice, date, kind: refType === 'receipt' ? 'receipt' : 'purchase', refType, refId, refNumber });
    // the latest buying price becomes the item's cost
    if (l.unitPrice > 0) db.run('update service set cost_price = ? where id = ?', l.unitPrice, itemId);
  }
}

export const adjustSchema = z.object({
  itemId: z.string().min(1),
  /** thousandths; signed for 'adjust', the counted quantity for 'count' */
  qty: z.number().int().min(-1e12).max(1e12),
  mode: z.enum(['adjust', 'count', 'opening']).default('adjust'),
  unitCost: z.number().int().min(0).max(1e13).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().trim().max(500).default(''),
});

/** Opening stock, a +/- correction, or a physical count (the difference is recorded). */
export function adjust(db: Db, auth: AuthContext, body: z.infer<typeof adjustSchema>): StockItem {
  return db.tx(() => {
    const item = db.get('select * from service where id = ? and tenant_id = ?', body.itemId, auth.tenantId);
    if (!item) throw new HttpError(404, 'Item not found.');
    if (!item.track_stock) db.run('update service set track_stock = 1 where id = ?', item.id);
    const current = onHand(db, auth.tenantId, item.id);
    const delta = body.mode === 'count' ? body.qty - current : body.qty;
    if (!delta) throw new HttpError(422, body.mode === 'count' ? 'The count matches the stock already recorded.' : 'Enter a quantity other than zero.');
    if (body.mode === 'opening' && body.qty <= 0) throw new HttpError(422, 'Opening stock must be above zero.');
    const note = body.note || (body.mode === 'count' ? `Stock count: ${body.qty / 1000}` : '');
    addMove(db, auth, { itemId: item.id, qty: delta, unitCost: body.unitCost ?? item.cost_price, date: body.date ?? today(), kind: body.mode === 'opening' ? 'opening' : 'adjust', refType: 'adjust', refId: null, note });
    if (body.mode === 'opening' && body.unitCost) db.run('update service set cost_price = ? where id = ?', body.unitCost, item.id);
    db.audit(auth.tenantId, auth.userId, 'stock.adjust', 'service', item.id, { delta, mode: body.mode });
    return stockItem(db, auth.tenantId, item.id);
  });
}

function mapStock(r: Row): StockItem {
  const onHand = r.on_hand ?? 0;
  return {
    id: r.id,
    name: r.name,
    sku: r.sku ?? '',
    barcode: r.barcode ?? '',
    unit: r.unit,
    itemType: r.item_type ?? '',
    category: r.category,
    onHand,
    reorderLevel: r.reorder_level ?? 0,
    costPrice: r.cost_price ?? 0,
    salePrice: r.default_price,
    value: Math.round((Math.max(onHand, 0) * (r.cost_price ?? 0)) / 1000),
    low: onHand <= (r.reorder_level ?? 0),
  };
}

const STOCK_SELECT = `select s.*, coalesce((select sum(m.qty) from stock_move m where m.tenant_id = s.tenant_id and m.item_id = s.id), 0) as on_hand from service s`;

export function stockItem(db: Db, tenantId: string, id: string): StockItem {
  const r = db.get(`${STOCK_SELECT} where s.tenant_id = ? and s.id = ?`, tenantId, id);
  if (!r) throw new HttpError(404, 'Item not found.');
  return mapStock(r);
}

export function stockSummary(db: Db, tenantId: string, q = ''): StockSummary {
  const like = `%${q}%`;
  const items = db
    .all(`${STOCK_SELECT} where s.tenant_id = ? and s.track_stock = 1 and s.status = 'active' and (s.name like ? or s.sku like ? or s.barcode like ? or s.category like ?) order by s.name collate nocase`, tenantId, like, like, like, like)
    .map(mapStock);
  return {
    items,
    totalValue: items.reduce((a, i) => a + i.value, 0),
    lowCount: items.filter((i) => i.low && i.onHand > 0).length,
    outCount: items.filter((i) => i.onHand <= 0).length,
  };
}

export function moves(db: Db, tenantId: string, itemId: string, limit = 100): StockMove[] {
  return db
    .all('select * from stock_move where tenant_id = ? and item_id = ? order by date desc, created_at desc limit ?', tenantId, itemId, limit)
    .map((r) => ({ id: r.id, itemId: r.item_id, date: r.date, qty: r.qty, unitCost: r.unit_cost, kind: r.kind, refType: r.ref_type, refId: r.ref_id, refNumber: r.ref_number, note: r.note, createdAt: r.created_at }));
}

/** Find a catalogue item by its barcode or SKU (exact match). */
export function findByCode(db: Db, tenantId: string, code: string): Row | undefined {
  const c = code.trim();
  if (!c) return undefined;
  return db.get("select * from service where tenant_id = ? and (barcode = ? or sku = ?) and status = 'active' limit 1", tenantId, c, c);
}
