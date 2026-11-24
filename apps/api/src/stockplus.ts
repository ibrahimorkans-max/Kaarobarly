import { z } from 'zod';
import {
  DEFAULT_STOCK_ALERT_SETTINGS,
  STOCK_ALERT_TYPES,
  formatMoney,
  qtyToString,
  type ExpiryBatch,
  type ExpiryReport,
  type ReorderGroup,
  type ReorderSlip,
  type StockAlert,
  type StockAlertSettings,
  type StockBatch,
} from '../../../packages/shared/src/index';
import { now, today, type Db, type Row } from './core';
import { HttpError, type AuthContext } from './perm';
import { saveOrder } from './procurement';
import { addMove, onHand } from './stock';

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
const value = (qty: number, cost: number) => Math.round((Math.max(qty, 0) * cost) / 1000);
const biz = (db: Db, tenantId: string) => db.get('select id, currency, currency_precision from business where tenant_id = ? order by created_at limit 1', tenantId);

// ---------------------------------------------------------------- batches

/** Stock per batch for one item (batches with stock left, or below zero). */
export function batchesOf(db: Db, tenantId: string, itemId: string, on = today()): StockBatch[] {
  const cost = db.get('select cost_price from service where id = ?', itemId)?.cost_price ?? 0;
  return db
    .all(
      `select batch_no, expiry, sum(qty) as q from stock_move where tenant_id = ? and item_id = ? and (batch_no <> '' or expiry <> '')
       group by batch_no, expiry having sum(qty) <> 0 order by case when expiry = '' then 1 else 0 end, expiry, batch_no`,
      tenantId,
      itemId,
    )
    .map((r) => ({ batchNo: r.batch_no, expiry: r.expiry, qty: r.q, value: value(r.q, cost), daysLeft: r.expiry ? days(on, r.expiry) : null }));
}

/**
 * Take stock out of a batch-tracked item, first-expiry-first-out. Expired batches are never
 * sold: when what is in date (plus unbatched stock) is not enough, the sale is refused.
 */
export function takeFefo(db: Db, auth: AuthContext, item: Row, qty: number, move: { date: string; unitCost: number; refType: string; refId: string; refNumber: string }) {
  const t = today();
  const batches = batchesOf(db, auth.tenantId, item.id, t).filter((b) => b.qty > 0);
  const good = batches.filter((b) => !b.expiry || b.expiry >= t);
  const expired = batches.filter((b) => b.expiry && b.expiry < t).reduce((s, b) => s + b.qty, 0);
  let left = qty;
  const takes: { batchNo: string; expiry: string; qty: number }[] = [];
  for (const b of good) {
    if (left <= 0) break;
    const n = Math.min(left, b.qty);
    takes.push({ batchNo: b.batchNo, expiry: b.expiry, qty: n });
    left -= n;
  }
  if (left > 0 && expired > 0) {
    const loose = db.get("select coalesce(sum(qty), 0) as q from stock_move where tenant_id = ? and item_id = ? and batch_no = '' and expiry = ''", auth.tenantId, item.id)!.q;
    if (loose < left) throw new HttpError(422, `${item.name}: only ${qtyToString(qty - left + Math.max(loose, 0))} ${item.unit || ''} is in date. ${qtyToString(expired)} is expired and cannot be sold.`.replace(/ {2}/g, ' '));
  }
  for (const tk of takes) addMove(db, auth, { itemId: item.id, qty: -tk.qty, unitCost: move.unitCost, date: move.date, kind: 'sale', refType: move.refType, refId: move.refId, refNumber: move.refNumber, batchNo: tk.batchNo, expiry: tk.expiry });
  if (left > 0) addMove(db, auth, { itemId: item.id, qty: -left, unitCost: move.unitCost, date: move.date, kind: 'sale', refType: move.refType, refId: move.refId, refNumber: move.refNumber });
}

export const writeOffSchema = z.object({
  itemId: z.string().min(1),
  batchNo: z.string().max(60).default(''),
  expiry: z.string().max(10).default(''),
  qty: z.number().int().min(1).max(1e12),
  reason: z.string().trim().min(2, 'Give a reason').max(300),
});

/** Remove expired, damaged or lost stock. The loss is kept for the expiry report. */
export function writeOff(db: Db, auth: AuthContext, body: z.infer<typeof writeOffSchema>) {
  return db.tx(() => {
    const item = db.get('select * from service where id = ? and tenant_id = ?', body.itemId, auth.tenantId);
    if (!item) throw new HttpError(404, 'Item not found.');
    const have =
      body.batchNo || body.expiry
        ? db.get('select coalesce(sum(qty), 0) as q from stock_move where tenant_id = ? and item_id = ? and batch_no = ? and expiry = ?', auth.tenantId, item.id, body.batchNo, body.expiry)!.q
        : onHand(db, auth.tenantId, item.id);
    if (body.qty > have) throw new HttpError(422, `Only ${qtyToString(Math.max(have, 0))} in ${body.batchNo ? `batch ${body.batchNo}` : 'stock'}.`);
    addMove(db, auth, { itemId: item.id, qty: -body.qty, unitCost: item.cost_price, date: today(), kind: 'adjust', refType: 'writeoff', refId: null, note: `Write-off: ${body.reason}`, batchNo: body.batchNo, expiry: body.expiry });
    db.audit(auth.tenantId, auth.userId, 'stock.writeoff', 'service', item.id, { qty: body.qty, batch: body.batchNo, reason: body.reason, value: value(body.qty, item.cost_price) });
    return { ok: true, loss: value(body.qty, item.cost_price) };
  });
}

// ---------------------------------------------------------------- supplier of an item or batch

function lastIncoming(db: Db, tenantId: string, itemId: string, batch?: { batchNo: string; expiry: string }): Row | undefined {
  const where = batch ? 'and m.batch_no = ? and m.expiry = ?' : '';
  return db.get(
    `select m.unit_cost, m.id, coalesce(g.supplier_id, p.supplier_id) as supplier_id from stock_move m
     left join goods_receipt g on m.ref_type = 'receipt' and g.id = m.ref_id
     left join purchase p on m.ref_type = 'purchase' and p.id = m.ref_id
     where m.tenant_id = ? and m.item_id = ? and m.kind in ('receipt','purchase') ${where} order by m.date desc, m.created_at desc limit 1`,
    tenantId,
    itemId,
    ...(batch ? [batch.batchNo, batch.expiry] : []),
  );
}

// ---------------------------------------------------------------- reorder slip

const ITEMS = `select s.*, coalesce((select sum(m.qty) from stock_move m where m.tenant_id = s.tenant_id and m.item_id = s.id), 0) as on_hand
  from service s where s.tenant_id = ? and s.track_stock = 1 and s.status = 'active'`;

/** Every item at or below its minimum, with a suggested quantity, grouped by supplier. */
export function reorderSlip(db: Db, tenantId: string): ReorderSlip {
  const groups = new Map<string, ReorderGroup>();
  const suppliers = new Map(db.all('select id, name, phone from supplier where tenant_id = ?', tenantId).map((s) => [s.id as string, s]));
  const t = today();
  for (const r of db.all(`${ITEMS} order by s.name collate nocase`, tenantId)) {
    // expired batches cannot be sold, so they do not count as stock to sell
    const expired = r.track_batches ? batchesOf(db, tenantId, r.id, t).filter((b) => b.qty > 0 && b.expiry && b.expiry < t).reduce((a, b) => a + b.qty, 0) : 0;
    r.on_hand -= expired;
    if (r.on_hand > r.reorder_level) continue;
    const pack = r.pack_size > 0 ? r.pack_size : 1000;
    const target = r.max_level > 0 ? r.max_level : Math.max(r.reorder_level * 2, pack);
    const need = Math.max(target - r.on_hand, pack);
    const suggested = Math.ceil(need / pack) * pack;
    const last = lastIncoming(db, tenantId, r.id);
    const supplierId: string = r.preferred_supplier_id && suppliers.has(r.preferred_supplier_id) ? r.preferred_supplier_id : (last?.supplier_id ?? '');
    const s = suppliers.get(supplierId);
    const price = last?.unit_cost || r.cost_price || 0;
    const g: ReorderGroup = groups.get(supplierId) ?? { supplierId, supplierName: s?.name ?? 'Supplier not set', supplierPhone: s?.phone ?? '', lines: [], total: 0 };
    const estCost = Math.round((suggested * price) / 1000);
    g.lines.push({ itemId: r.id, name: r.name, barcode: r.barcode ?? '', unit: r.unit, onHand: r.on_hand, reorderLevel: r.reorder_level, maxLevel: r.max_level ?? 0, packSize: r.pack_size ?? 0, suggested, lastPrice: price, estCost });
    g.total += estCost;
    groups.set(supplierId, g);
  }
  const list = [...groups.values()].sort((a, b) => (a.supplierId ? 0 : 1) - (b.supplierId ? 0 : 1) || a.supplierName.localeCompare(b.supplierName));
  const b = biz(db, tenantId);
  return { date: today(), groups: list, total: list.reduce((s, g) => s + g.total, 0), currency: b?.currency ?? 'PKR', currencyPrecision: b?.currency_precision ?? 2 };
}

export const slipOrdersSchema = z.object({
  businessId: z.string().min(1),
  expectedDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).default(''),
  groups: z
    .array(
      z.object({
        supplierId: z.string().min(1, 'Choose a supplier for every group'),
        lines: z.array(z.object({ itemId: z.string().min(1), qty: z.number().int().min(1).max(1e12), unitPrice: z.number().int().min(0).max(1e13) })).min(1),
      }),
    )
    .min(1, 'Nothing to order'),
});

/** One draft purchase order per supplier from the (edited) slip. */
export function ordersFromSlip(db: Db, auth: AuthContext, body: z.infer<typeof slipOrdersSchema>) {
  return db.tx(() =>
    body.groups.map((g) =>
      saveOrder(db, auth, {
        businessId: body.businessId,
        supplierId: g.supplierId,
        requestId: null,
        date: today(),
        expectedDate: body.expectedDate,
        notes: 'Made from the reorder slip',
        terms: '',
        lines: g.lines.map((l) => {
          const item = db.get('select name, unit from service where id = ? and tenant_id = ?', l.itemId, auth.tenantId);
          if (!item) throw new HttpError(422, 'One of the items no longer exists.');
          return { itemId: l.itemId, name: item.name as string, unit: (item.unit ?? '') as string, qty: l.qty, unitPrice: l.unitPrice, note: '', batch: '', expiry: '' };
        }),
      }),
    ),
  );
}

// ---------------------------------------------------------------- settings

export function getAlertSettings(db: Db, tenantId: string): StockAlertSettings {
  const raw = db.get('select config from stock_alert_config where tenant_id = ?', tenantId)?.config;
  try {
    return { ...DEFAULT_STOCK_ALERT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return DEFAULT_STOCK_ALERT_SETTINGS;
  }
}

export const settingsSchema = z.object({
  off: z.array(z.enum(STOCK_ALERT_TYPES)).default([]),
  deadDays: z.number().int().min(7).max(730).default(60),
  expiryDays: z.number().int().min(1).max(730).default(30),
  runningOutDays: z.number().int().min(1).max(90).default(7),
});

export function saveAlertSettings(db: Db, auth: AuthContext, body: z.infer<typeof settingsSchema>): StockAlertSettings {
  db.run('insert into stock_alert_config (tenant_id, config, updated_at) values (?,?,?) on conflict (tenant_id) do update set config = excluded.config, updated_at = excluded.updated_at', auth.tenantId, JSON.stringify(body), now());
  return getAlertSettings(db, auth.tenantId);
}

// ---------------------------------------------------------------- expiry

const clearanceBp = (daysLeft: number) => (daysLeft < 0 ? 0 : daysLeft <= 7 ? 3000 : daysLeft <= 30 ? 2000 : 1000);

/** Batches expired or expiring within 90 days, with totals at risk and the loss from write-offs. */
export function expiryReport(db: Db, tenantId: string): ExpiryReport {
  const t = today();
  const suppliers = new Map(db.all('select id, name from supplier where tenant_id = ?', tenantId).map((s) => [s.id as string, s.name as string]));
  const batches: ExpiryBatch[] = [];
  const buckets = { expired: { count: 0, value: 0 }, d7: { count: 0, value: 0 }, d30: { count: 0, value: 0 }, d90: { count: 0, value: 0 } };
  const rows = db.all(
    `select m.item_id, m.batch_no, m.expiry, sum(m.qty) as q, s.name, s.barcode, s.unit, s.cost_price, s.default_price from stock_move m join service s on s.id = m.item_id
     where m.tenant_id = ? and m.expiry <> '' and s.status = 'active' group by m.item_id, m.batch_no, m.expiry having sum(m.qty) > 0 order by m.expiry`,
    tenantId,
  );
  for (const r of rows) {
    const daysLeft = days(t, r.expiry);
    if (daysLeft > 90) continue;
    const v = value(r.q, r.cost_price);
    const bucket = daysLeft < 0 ? buckets.expired : daysLeft <= 7 ? buckets.d7 : daysLeft <= 30 ? buckets.d30 : buckets.d90;
    bucket.count++;
    bucket.value += v;
    const sup = lastIncoming(db, tenantId, r.item_id, { batchNo: r.batch_no, expiry: r.expiry })?.supplier_id ?? '';
    batches.push({ itemId: r.item_id, name: r.name, barcode: r.barcode ?? '', unit: r.unit, salePrice: r.default_price, batchNo: r.batch_no, expiry: r.expiry, qty: r.q, value: v, daysLeft, supplierId: sup, supplierName: suppliers.get(sup) ?? '', suggestedDiscountBp: clearanceBp(daysLeft) });
  }
  const loss = db.get("select coalesce(sum(-qty * unit_cost / 1000), 0) as v from stock_move where tenant_id = ? and ref_type = 'writeoff' and date >= ?", tenantId, `${t.slice(0, 7)}-01`)!.v;
  const b = biz(db, tenantId);
  return { buckets, batches, lossThisMonth: Math.round(loss), currency: b?.currency ?? 'PKR', currencyPrecision: b?.currency_precision ?? 2 };
}

// ---------------------------------------------------------------- alert centre

/** Everything about stock and buying that needs attention now. Alerts close themselves when fixed. */
export function stockAlerts(db: Db, tenantId: string): StockAlert[] {
  const t = today();
  const set = getAlertSettings(db, tenantId);
  const on = (type: StockAlert['type']) => !set.off.includes(type);
  const dismissed = new Set(db.all('select key from alert_dismissal where tenant_id = ?', tenantId).map((r) => r.key as string));
  const b = biz(db, tenantId);
  const m = (v: number) => formatMoney(v, b?.currency ?? 'PKR', b?.currency_precision ?? 2);
  const out: StockAlert[] = [];
  const push = (a: StockAlert) => !dismissed.has(a.key) && out.push(a);
  const since30 = addDays(t, -30);

  for (const r of db.all(ITEMS, tenantId)) {
    const q = r.on_hand as number;
    const u = r.unit ? ` ${r.unit}` : '';
    const sales = db.get("select coalesce(-sum(qty), 0) as sold, max(date) as last from stock_move where tenant_id = ? and item_id = ? and kind = 'sale'", tenantId, r.id)!;
    const sold30 = db.get("select coalesce(-sum(qty), 0) as q from stock_move where tenant_id = ? and item_id = ? and kind = 'sale' and date >= ?", tenantId, r.id, since30)!.q;
    if (q < 0 && on('negative')) push({ key: `neg:${r.id}:${q}`, type: 'negative', level: 'danger', title: `${r.name} is below zero`, sub: `Records show ${qtyToString(q)}${u}. Count it to correct the stock.`, itemId: r.id, action: 'count' });
    else if (q === 0 && r.default_price > 0 && on('out_of_stock')) push({ key: `out:${r.id}:${sales.last ?? ''}`, type: 'out_of_stock', level: 'danger', title: `${r.name} is out of stock`, sub: r.reorder_level ? `Reorder level ${qtyToString(r.reorder_level)}${u}` : 'Nothing left to sell', itemId: r.id, action: 'reorder' });
    else if (q > 0 && q <= r.reorder_level && on('low_stock')) push({ key: `low:${r.id}:${q}`, type: 'low_stock', level: 'warn', title: `${r.name} is low`, sub: `${qtyToString(q)}${u} left · reorder at ${qtyToString(r.reorder_level)}`, itemId: r.id, action: 'reorder' });
    else if (q > r.reorder_level && sold30 > 0 && on('running_out')) {
      const lasts = Math.floor(q / (sold30 / 30));
      if (lasts < set.runningOutDays) push({ key: `run:${r.id}:${lasts}`, type: 'running_out', level: 'warn', title: `${r.name} runs out in about ${lasts} day${lasts === 1 ? '' : 's'}`, sub: `${qtyToString(q)}${u} left · sold ${qtyToString(sold30)} in 30 days`, itemId: r.id, action: 'reorder' });
    }
    if (r.max_level > 0 && q > r.max_level && on('overstock')) push({ key: `over:${r.id}:${q}`, type: 'overstock', level: 'info', title: `${r.name} is overstocked`, sub: `${qtyToString(q)}${u} · maximum ${qtyToString(r.max_level)}. Hold reorders.`, itemId: r.id, action: 'item' });
    if (q > 0 && on('dead_stock')) {
      const first = db.get('select min(date) as d from stock_move where tenant_id = ? and item_id = ? and qty > 0', tenantId, r.id)!.d as string | null;
      const idle = sales.last ? days(sales.last, t) : first ? days(first, t) : 0;
      if (idle >= set.deadDays) push({ key: `dead:${r.id}:${sales.last ?? first}`, type: 'dead_stock', level: 'info', title: `${r.name} has not sold for ${idle} days`, sub: `${qtyToString(q)}${u} worth ${m(value(q, r.cost_price))} at cost. Try a clearance price or return it.`, itemId: r.id, action: 'item' });
    }
    if (r.default_price > 0 && r.cost_price > r.default_price && on('below_cost')) push({ key: `cost:${r.id}:${r.default_price}:${r.cost_price}`, type: 'below_cost', level: 'warn', title: `${r.name} sells below cost`, sub: `Price ${m(r.default_price)} · cost ${m(r.cost_price)}`, itemId: r.id, action: 'price' });
    if (on('price_rise')) {
      // compare with the delivery before (not another batch on the same delivery)
      const last = db.get("select id, ref_id, max(unit_cost) as unit_cost from stock_move where tenant_id = ? and item_id = ? and kind in ('receipt','purchase') and unit_cost > 0 group by ref_id order by max(date) desc, max(created_at) desc limit 1", tenantId, r.id);
      const prev = last && db.get("select max(unit_cost) as unit_cost from stock_move where tenant_id = ? and item_id = ? and kind in ('receipt','purchase') and unit_cost > 0 and coalesce(ref_id, '') <> coalesce(?, '') group by ref_id order by max(date) desc, max(created_at) desc limit 1", tenantId, r.id, last.ref_id);
      if (last && prev && last.unit_cost > prev.unit_cost) {
        const pct = Math.round(((last.unit_cost - prev.unit_cost) / prev.unit_cost) * 100);
        push({ key: `rise:${last.id}`, type: 'price_rise', level: 'info', title: `${r.name} cost went up ${pct}%`, sub: `Bought at ${m(last.unit_cost)}, was ${m(prev.unit_cost)} · selling at ${m(r.default_price)}`, itemId: r.id, action: 'price' });
      }
    }
    if (r.label_pending && on('label_pending')) push({ key: `label:${r.id}:${r.default_price}`, type: 'label_pending', level: 'info', title: `New price labels for ${r.name}`, sub: `Price is now ${m(r.default_price)}`, itemId: r.id, action: 'labels' });

    if (r.track_batches && (on('expired') || on('expiring'))) {
      const warn = r.expiry_warn_days || set.expiryDays;
      for (const bt of batchesOf(db, tenantId, r.id, t)) {
        if (bt.qty <= 0 || bt.daysLeft === null) continue;
        const name = `${r.name}${bt.batchNo ? ` (batch ${bt.batchNo})` : ''}`;
        if (bt.daysLeft < 0 && on('expired')) push({ key: `exp:${r.id}:${bt.batchNo}:${bt.expiry}:${bt.qty}`, type: 'expired', level: 'danger', title: `${name} has expired`, sub: `${qtyToString(bt.qty)}${u} worth ${m(bt.value)} · expired ${bt.expiry}. It cannot be sold.`, itemId: r.id, action: 'expiry' });
        else if (bt.daysLeft >= 0 && bt.daysLeft <= warn && on('expiring')) push({ key: `soon:${r.id}:${bt.batchNo}:${bt.expiry}`, type: 'expiring', level: 'warn', title: `${name} expires in ${bt.daysLeft} day${bt.daysLeft === 1 ? '' : 's'}`, sub: `${qtyToString(bt.qty)}${u} worth ${m(bt.value)} · ${bt.expiry}`, itemId: r.id, action: 'expiry' });
      }
    }
  }

  if (on('overdue_po')) {
    for (const o of db.all("select o.id, o.number, o.expected_date, s.name as supplier, s.phone from purchase_order o join supplier s on s.id = o.supplier_id where o.tenant_id = ? and o.status in ('sent','partial') and o.expected_date <> '' and o.expected_date < ?", tenantId, t)) {
      const late = days(o.expected_date, t);
      push({ key: `po:${o.id}:${o.expected_date}`, type: 'overdue_po', level: late > 7 ? 'danger' : 'warn', title: `${o.number} from ${o.supplier} is ${late} day${late === 1 ? '' : 's'} late`, sub: `Expected ${o.expected_date}${o.phone ? ` · ${o.phone}` : ''}`, refId: o.id, action: 'order' });
    }
  }
  const rank = { danger: 0, warn: 1, info: 2 };
  return out.sort((a, c) => rank[a.level] - rank[c.level]);
}
