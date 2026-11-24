import { z } from 'zod';
import {
  DEFAULT_LOYALTY,
  applyPromotions,
  formatMoney,
  tierFor,
  type Appointment,
  type GiftCard,
  type Kot,
  type LoyaltyAccount,
  type LoyaltySettings,
  type OrderLine,
  type Promotion,
  type PromoResult,
  type ShopSettings,
  type TableOrder,
} from '../../../packages/shared/src/index';
import { now, today, uid, type Db, type Row } from './core';
import { HttpError, type AuthContext } from './perm';

const json = <T>(s: string | null | undefined, fallback: T): T => {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
};
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const minor = z.number().int().min(0).max(1e13);
const text = (max = 200) => z.string().trim().max(max).default('');

// ================================================================ settings per business

export function getSetting<T>(db: Db, tenantId: string, key: string, fallback: T): T {
  const r = db.get('select value from tenant_setting where tenant_id = ? and key = ?', tenantId, key);
  return r ? { ...fallback, ...json(r.value, {}) } : fallback;
}
export function setSetting(db: Db, tenantId: string, key: string, value: unknown) {
  db.run('insert into tenant_setting (tenant_id, key, value, updated_at) values (?,?,?,?) on conflict (tenant_id, key) do update set value = excluded.value, updated_at = excluded.updated_at', tenantId, key, JSON.stringify(value), now());
}

/** Local date, time and weekday for promotions (server clock). */
export function moment(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}`, weekday: d.getDay() };
}

// ================================================================ promotions

export const promotionSchema = z.object({
  name: z.string().trim().min(1, 'Name the promotion').max(80),
  kind: z.enum(['percent', 'buy_get', 'bundle', 'bill']),
  itemIds: z.array(z.string()).max(200).default([]),
  categories: z.array(z.string().max(100)).max(50).default([]),
  percentBp: z.number().int().min(0).max(10_000).default(0),
  buyQty: z.number().int().min(0).max(1e9).default(0),
  getQty: z.number().int().min(0).max(1e9).default(0),
  bundlePrice: minor.default(0),
  minSpend: minor.default(0),
  coupon: z.string().trim().max(30).default(''),
  startDate: z.union([isoDate, z.literal('')]).default(''),
  endDate: z.union([isoDate, z.literal('')]).default(''),
  fromTime: z.union([z.string().regex(/^\d{2}:\d{2}$/), z.literal('')]).default(''),
  toTime: z.union([z.string().regex(/^\d{2}:\d{2}$/), z.literal('')]).default(''),
  days: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  membersOnly: z.boolean().default(false),
  active: z.boolean().default(true),
});

const mapPromotion = (r: Row): Promotion => ({ id: r.id, name: r.name, active: !!r.active, ...json(r.config, {}) }) as Promotion;

export function listPromotions(db: Db, tenantId: string): Promotion[] {
  return db.all('select * from promotion where tenant_id = ? order by active desc, name collate nocase', tenantId).map(mapPromotion);
}

export function savePromotion(db: Db, auth: AuthContext, body: z.infer<typeof promotionSchema>, id?: string): Promotion {
  if (body.kind === 'buy_get' && (!body.buyQty || !body.getQty)) throw new HttpError(422, 'Set how many to buy and how many are free.');
  if (body.kind === 'bundle' && (body.itemIds.length < 2 || !body.bundlePrice)) throw new HttpError(422, 'A bundle needs at least two items and a price.');
  if ((body.kind === 'percent' || body.kind === 'bill') && !body.percentBp) throw new HttpError(422, 'Set the percent off.');
  const { name, active, ...config } = body;
  if (id) {
    if (!db.get('select 1 from promotion where id = ? and tenant_id = ?', id, auth.tenantId)) throw new HttpError(404, 'Promotion not found.');
    db.run('update promotion set name = ?, active = ?, config = ? where id = ?', name, active ? 1 : 0, JSON.stringify(config), id);
  } else {
    id = uid();
    db.run('insert into promotion (id, tenant_id, name, active, config, created_at) values (?,?,?,?,?,?)', id, auth.tenantId, name, active ? 1 : 0, JSON.stringify(config), now());
  }
  db.audit(auth.tenantId, auth.userId, 'promotion.save', 'promotion', id, { name });
  return mapPromotion(db.get('select * from promotion where id = ?', id)!);
}

export function deletePromotion(db: Db, auth: AuthContext, id: string) {
  db.run('delete from promotion where id = ? and tenant_id = ?', id, auth.tenantId);
  return { ok: true };
}

/** Promotions for a set of lines right now (also used by the phone to preview the bill). */
export function promotionsFor(db: Db, tenantId: string, lines: { serviceId: string | null; qty: number; unitPrice: number }[], coupon = '', member = false): PromoResult {
  const cats = new Map<string, string>();
  const ids = [...new Set(lines.map((l) => l.serviceId).filter(Boolean))] as string[];
  if (ids.length) for (const r of db.all(`select id, category from service where tenant_id = ? and id in (${ids.map(() => '?').join(',')})`, tenantId, ...ids)) cats.set(r.id, r.category);
  return applyPromotions(
    lines.map((l) => ({ ...l, category: l.serviceId ? cats.get(l.serviceId) : undefined })),
    listPromotions(db, tenantId),
    moment(),
    coupon,
    member,
  );
}

// ================================================================ loyalty

export const loyaltySchema = z.object({
  enabled: z.boolean(),
  spendPerPoint: z.number().int().min(1).max(1e12),
  pointValue: z.number().int().min(0).max(1e12),
  minRedeem: z.number().int().min(0).max(1e9),
  tiers: z.array(z.object({ name: z.string().trim().min(1).max(30), minPoints: z.number().int().min(0).max(1e12), discountBp: z.number().int().min(0).max(5000) })).max(6),
});

export const getLoyalty = (db: Db, tenantId: string): LoyaltySettings => getSetting(db, tenantId, 'loyalty', DEFAULT_LOYALTY);

export function saveLoyalty(db: Db, auth: AuthContext, body: z.infer<typeof loyaltySchema>): LoyaltySettings {
  setSetting(db, auth.tenantId, 'loyalty', body);
  db.audit(auth.tenantId, auth.userId, 'loyalty.settings', 'tenant', auth.tenantId);
  return getLoyalty(db, auth.tenantId);
}

function points(db: Db, tenantId: string, clientId: string) {
  return db.get('select coalesce(sum(points), 0) as p, coalesce(sum(case when points > 0 then points else 0 end), 0) as life from loyalty_txn where tenant_id = ? and client_id = ?', tenantId, clientId)!;
}

export function loyaltyAccount(db: Db, tenantId: string, clientId: string): LoyaltyAccount {
  const c = db.get('select id, name, phone from client where id = ? and tenant_id = ?', clientId, tenantId);
  if (!c) throw new HttpError(404, 'Customer not found.');
  const s = getLoyalty(db, tenantId);
  const p = points(db, tenantId, clientId);
  const tier = tierFor(s.tiers, p.life);
  const nextTier = [...s.tiers].sort((a, b) => a.minPoints - b.minPoints).find((t) => t.minPoints > p.life) ?? null;
  const history = db.all('select id, points, reason, created_at from loyalty_txn where tenant_id = ? and client_id = ? order by created_at desc limit 30', tenantId, clientId).map((r) => ({ id: r.id, points: r.points, reason: r.reason, at: r.created_at }));
  return { clientId, name: c.name, phone: c.phone, points: p.p, lifetime: p.life, tier, nextTier, history };
}

/** Find a member by phone number (the last 10 digits match, so 0300… and +92300… are the same). */
export function findMember(db: Db, tenantId: string, phone: string) {
  const digits = phone.replace(/\D/g, '').slice(-10);
  if (digits.length < 7) throw new HttpError(422, 'Enter the phone number.');
  const c = db.all("select id, phone, whatsapp from client where tenant_id = ? and category <> 'Walk-in'", tenantId).find((r) => [r.phone, r.whatsapp].some((x: string) => (x ?? '').replace(/\D/g, '').slice(-10) === digits));
  if (!c) throw new HttpError(404, 'No customer with this number.');
  return loyaltyAccount(db, tenantId, c.id);
}

export function addPoints(db: Db, auth: AuthContext, clientId: string, pts: number, reason: string, invoiceId: string | null = null) {
  if (!pts) return;
  db.run('insert into loyalty_txn (id, tenant_id, client_id, points, reason, invoice_id, created_at) values (?,?,?,?,?,?,?)', uid(), auth.tenantId, clientId, pts, reason.slice(0, 200), invoiceId, now());
}

export const adjustPointsSchema = z.object({ points: z.number().int().min(-1e9).max(1e9).refine((v) => v !== 0, 'Enter points'), reason: z.string().trim().min(2).max(200) });

// ================================================================ gift cards

const mapCard = (r: Row): GiftCard => ({ id: r.id, code: r.code, initial: r.initial, balance: r.balance, clientName: r.client_name ?? '', status: r.status, createdAt: r.created_at });

export function listGiftCards(db: Db, tenantId: string): GiftCard[] {
  return db.all('select * from gift_card where tenant_id = ? order by created_at desc limit 200', tenantId).map(mapCard);
}

export function giftCardByCode(db: Db, tenantId: string, code: string): GiftCard {
  const r = db.get('select * from gift_card where tenant_id = ? and code = ?', tenantId, code.trim().toUpperCase());
  if (!r) throw new HttpError(404, 'No gift card with this code.');
  return mapCard(r);
}

export const giftCardSchema = z.object({ amount: z.number().int().min(1).max(1e12), clientName: text(120), shiftId: z.string().nullable().default(null) });

/** Sell a gift card: the money comes in now (into the drawer when a shift is open), the balance is spent later. */
export function issueGiftCard(db: Db, auth: AuthContext, body: z.infer<typeof giftCardSchema>): GiftCard {
  return db.tx(() => {
    let code = '';
    for (let i = 0; i < 20 && (!code || db.get('select 1 from gift_card where tenant_id = ? and code = ?', auth.tenantId, code)); i++) code = `GC${uid().replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase()}`;
    const id = uid();
    db.run("insert into gift_card (id, tenant_id, code, initial, balance, client_name, status, created_at) values (?,?,?,?,?,?,'active',?)", id, auth.tenantId, code, body.amount, body.amount, body.clientName, now());
    const shift = body.shiftId ? db.get("select * from pos_shift where id = ? and tenant_id = ? and status = 'open'", body.shiftId, auth.tenantId) : null;
    const businessId = shift?.business_id ?? db.get('select id from business where tenant_id = ? order by created_at limit 1', auth.tenantId)?.id;
    if (businessId) {
      db.run(
        "insert into finance_entry (id, tenant_id, business_id, type, category, amount, date, method, party, notes, account_id, created_by, created_at) values (?,?,?,'income','Gift cards sold',?,?,'cash',?,?,?,?,?)",
        uid(), auth.tenantId, businessId, body.amount, today(), body.clientName, `Gift card ${code}`, shift?.account_id ?? null, auth.userId, now(),
      );
    }
    if (shift) db.run("insert into pos_cash_move (id, tenant_id, shift_id, kind, amount, reason, by_name, at) values (?,?,?,'in',?,?,?,?)", uid(), auth.tenantId, shift.id, body.amount, `Gift card ${code} sold`, auth.name, now());
    db.audit(auth.tenantId, auth.userId, 'giftcard.issue', 'gift_card', id, { amount: body.amount });
    return mapCard(db.get('select * from gift_card where id = ?', id)!);
  });
}

/** Take money off gift cards for a sale. Returns the total used. */
export function spendGiftCards(db: Db, auth: AuthContext, cards: { code: string; amount: number }[], invoiceId: string) {
  let used = 0;
  for (const c of cards) {
    const card = giftCardByCode(db, auth.tenantId, c.code);
    if (card.status !== 'active') throw new HttpError(422, `Gift card ${card.code} is ${card.status}.`);
    if (c.amount > card.balance) throw new HttpError(422, `Gift card ${card.code} has only ${card.balance} left.`);
    const left = card.balance - c.amount;
    db.run('update gift_card set balance = ?, status = ? where id = ?', left, left === 0 ? 'used' : 'active', card.id);
    db.audit(auth.tenantId, auth.userId, 'giftcard.spend', 'gift_card', card.id, { amount: c.amount, invoiceId });
    used += c.amount;
  }
  return used;
}

// ================================================================ restaurant: tables, orders, kitchen tickets

export interface TableDef {
  name: string;
  area: string;
  seats: number;
}
export const tablesSchema = z.object({ tables: z.array(z.object({ name: z.string().trim().min(1).max(20), area: text(30), seats: z.number().int().min(0).max(50).default(4) })).max(200) });
export const getTables = (db: Db, tenantId: string): TableDef[] => getSetting(db, tenantId, 'tables', { tables: [] as TableDef[] }).tables;

const orderLineSchema = z.object({
  serviceId: z.string().nullable().default(null),
  name: z.string().trim().min(1).max(200),
  qty: z.number().int().min(1).max(1e9),
  unit: text(30),
  unitPrice: minor,
  modifiers: z.array(z.string().max(60)).max(20).default([]),
  note: text(200),
  section: text(30),
  sent: z.number().int().min(0).max(1e9).default(0),
  taxRateBp: z.number().int().min(0).max(10_000).default(0),
});

const total = (lines: OrderLine[]) => lines.reduce((s, l) => s + Math.round((l.qty * l.unitPrice) / 1000), 0);

function mapOrder(r: Row): TableOrder {
  const lines = json<OrderLine[]>(r.lines, []);
  return {
    id: r.id,
    number: r.number,
    kind: r.kind,
    table: r.table_name,
    guests: r.guests,
    customer: r.customer,
    phone: r.phone,
    address: r.address,
    waiter: r.waiter,
    lines,
    status: r.status,
    total: total(lines),
    createdAt: r.created_at,
    rider: r.rider ?? '',
    deliveryStatus: r.delivery_status ?? '',
  };
}

export function getOrder(db: Db, tenantId: string, id: string): TableOrder {
  const r = db.get('select * from table_order where id = ? and tenant_id = ?', id, tenantId);
  if (!r) throw new HttpError(404, 'Order not found.');
  return mapOrder(r);
}

export function listOrders(db: Db, tenantId: string, status = 'open'): TableOrder[] {
  return db.all('select * from table_order where tenant_id = ? and status = ? order by created_at desc limit 200', tenantId, status).map(mapOrder);
}

export const orderSchema = z.object({
  kind: z.enum(['dine_in', 'takeaway', 'delivery']).default('dine_in'),
  table: text(20),
  guests: z.number().int().min(0).max(200).default(0),
  customer: text(120),
  phone: text(30),
  address: text(300),
  lines: z.array(orderLineSchema).max(300).default([]),
});

export function openOrder(db: Db, auth: AuthContext, body: z.infer<typeof orderSchema>, source = 'pos'): TableOrder {
  if (body.kind === 'dine_in' && !body.table) throw new HttpError(422, 'Choose a table.');
  if (body.kind === 'dine_in' && db.get("select 1 from table_order where tenant_id = ? and status = 'open' and kind = 'dine_in' and table_name = ?", auth.tenantId, body.table)) throw new HttpError(409, `Table ${body.table} already has an open order.`);
  const id = uid();
  const n = db.nextCounter(auth.tenantId, 'table_order');
  db.run(
    "insert into table_order (id, tenant_id, number, kind, table_name, guests, customer, phone, address, waiter, lines, status, source, rider, delivery_status, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?,?,'open',?,'',?,?,?)",
    id, auth.tenantId, `ORD-${String(n).padStart(4, '0')}`, body.kind, body.table, body.guests, body.customer, body.phone, body.address, auth.name, JSON.stringify(body.lines), source, body.kind === 'delivery' ? 'preparing' : '', now(), now(),
  );
  return getOrder(db, auth.tenantId, id);
}

export const orderUpdateSchema = z.object({
  lines: z.array(orderLineSchema).max(300).optional(),
  table: z.string().trim().max(20).optional(),
  guests: z.number().int().min(0).max(200).optional(),
  rider: z.string().trim().max(60).optional(),
  deliveryStatus: z.enum(['', 'preparing', 'on_the_way', 'delivered']).optional(),
});

export function updateOrder(db: Db, auth: AuthContext, id: string, body: z.infer<typeof orderUpdateSchema>): TableOrder {
  const o = getOrder(db, auth.tenantId, id);
  if (o.status !== 'open') throw new HttpError(409, 'This order is closed.');
  if (body.lines) {
    // a line already sent to the kitchen cannot go below what was sent without a manager
    db.run('update table_order set lines = ?, updated_at = ? where id = ?', JSON.stringify(body.lines.map((l) => ({ ...l, sent: Math.min(l.sent, l.qty) }))), now(), id);
  }
  if (body.table !== undefined && body.table !== o.table) {
    if (db.get("select 1 from table_order where tenant_id = ? and status = 'open' and kind = 'dine_in' and table_name = ? and id <> ?", auth.tenantId, body.table, id)) throw new HttpError(409, `Table ${body.table} is taken.`);
    db.run('update table_order set table_name = ? where id = ?', body.table, id);
  }
  if (body.guests !== undefined) db.run('update table_order set guests = ? where id = ?', body.guests, id);
  if (body.rider !== undefined) db.run('update table_order set rider = ? where id = ?', body.rider, id);
  if (body.deliveryStatus !== undefined) db.run('update table_order set delivery_status = ? where id = ?', body.deliveryStatus, id);
  return getOrder(db, auth.tenantId, id);
}

/** Send what is new on the order to the kitchen: one ticket per section. */
export function sendToKitchen(db: Db, auth: AuthContext, id: string): Kot[] {
  return db.tx(() => {
    const o = getOrder(db, auth.tenantId, id);
    if (o.status !== 'open') throw new HttpError(409, 'This order is closed.');
    const bySection = new Map<string, Kot['items']>();
    // once dishes have kitchen sections, items without one (drinks from the fridge) skip the kitchen;
    // a shop that set no sections sends everything to one kitchen
    const sectioned = o.lines.some((l) => l.section);
    const lines = o.lines.map((l) => {
      const add = l.qty - l.sent;
      if (add <= 0) return l;
      if (sectioned && !l.section) return { ...l, sent: l.qty };
      const section = l.section || 'Kitchen';
      bySection.set(section, [...(bySection.get(section) ?? []), { name: l.name, qty: add, modifiers: l.modifiers, note: l.note }]);
      return { ...l, sent: l.qty };
    });
    if (!bySection.size) throw new HttpError(422, 'Nothing new to send.');
    db.run('update table_order set lines = ?, updated_at = ? where id = ?', JSON.stringify(lines), now(), id);
    const out: Kot[] = [];
    for (const [section, items] of bySection) {
      const kid = uid();
      db.run("insert into kot (id, tenant_id, number, order_id, section, items, status, created_at) values (?,?,?,?,?,?,'new',?)", kid, auth.tenantId, db.nextCounter(auth.tenantId, 'kot'), id, section, JSON.stringify(items), now());
      out.push(getKot(db, auth.tenantId, kid));
    }
    return out;
  });
}

const KOT_SELECT = 'select k.*, o.number as order_number, o.table_name, o.kind from kot k join table_order o on o.id = k.order_id';
const mapKot = (r: Row): Kot => ({ id: r.id, number: r.number, orderId: r.order_id, orderNumber: r.order_number, table: r.table_name, kind: r.kind, section: r.section, items: json(r.items, []), status: r.status, createdAt: r.created_at });
export function getKot(db: Db, tenantId: string, id: string): Kot {
  const r = db.get(`${KOT_SELECT} where k.id = ? and k.tenant_id = ?`, id, tenantId);
  if (!r) throw new HttpError(404, 'Ticket not found.');
  return mapKot(r);
}
/** The kitchen display: tickets still being prepared (and those ready, not yet served). */
export function listKots(db: Db, tenantId: string, section = ''): Kot[] {
  return db.all(`${KOT_SELECT} where k.tenant_id = ? and k.status <> 'served' ${section ? 'and k.section = ?' : ''} order by k.created_at`, tenantId, ...(section ? [section] : [])).map(mapKot);
}
export function setKotStatus(db: Db, auth: AuthContext, id: string, status: 'new' | 'ready' | 'served'): Kot {
  getKot(db, auth.tenantId, id);
  db.run('update kot set status = ? where id = ?', status, id);
  return getKot(db, auth.tenantId, id);
}

export function cancelOrder(db: Db, auth: AuthContext, id: string, reason: string) {
  const o = getOrder(db, auth.tenantId, id);
  if (o.status !== 'open') throw new HttpError(409, 'This order is closed.');
  db.run("update table_order set status = 'cancelled', updated_at = ? where id = ?", now(), id);
  db.run("update kot set status = 'served' where order_id = ?", id);
  // voids after the kitchen started are logged for the owner
  db.audit(auth.tenantId, auth.userId, 'order.cancel', 'table_order', id, { reason, sent: o.lines.some((l) => l.sent > 0), total: o.total });
  return { ok: true };
}

/** After a (part) payment: drop the settled lines, close the order when nothing is left. */
export function settleOrderLines(db: Db, tenantId: string, id: string, settled: number[] | undefined) {
  const o = getOrder(db, tenantId, id);
  const keep = settled?.length ? o.lines.filter((_, i) => !settled.includes(i)) : [];
  if (keep.length) db.run('update table_order set lines = ?, updated_at = ? where id = ?', JSON.stringify(keep), now(), id);
  else {
    db.run("update table_order set status = 'closed', lines = ?, updated_at = ?, delivery_status = case when kind = 'delivery' then 'delivered' else delivery_status end where id = ?", JSON.stringify(o.lines), now(), id);
    db.run("update kot set status = 'served' where order_id = ?", id);
  }
}

// ================================================================ service mode: appointments and walk-ins

export const appointmentSchema = z.object({
  clientId: z.string().nullable().default(null),
  clientName: z.string().trim().min(1, 'Enter the customer name').max(120),
  phone: text(30),
  serviceId: z.string().nullable().default(null),
  staffId: z.string().nullable().default(null),
  date: isoDate,
  time: z.union([z.string().regex(/^\d{2}:\d{2}$/), z.literal('')]).default(''),
  minutes: z.number().int().min(5).max(600).default(30),
  notes: text(500),
  walkIn: z.boolean().default(false),
});

const APPT_SELECT = "select a.*, coalesce(s.name, '') as service_name, coalesce(s.default_price, 0) as price, coalesce(e.name, '') as staff_name from appointment a left join service s on s.id = a.service_id left join employee e on e.id = a.staff_id";
const mapAppt = (r: Row): Appointment => ({
  id: r.id,
  clientId: r.client_id,
  clientName: r.client_name,
  phone: r.phone,
  serviceId: r.service_id,
  serviceName: r.service_name,
  price: r.price,
  staffId: r.staff_id,
  staffName: r.staff_name,
  date: r.date,
  time: r.time,
  minutes: r.minutes,
  status: r.status,
  notes: r.notes,
  walkIn: !!r.walk_in,
  heldId: r.held_id,
  createdAt: r.created_at,
});

export function listAppointments(db: Db, tenantId: string, date: string): Appointment[] {
  return db.all(`${APPT_SELECT} where a.tenant_id = ? and a.date = ? order by case when a.time = '' then 1 else 0 end, a.time, a.created_at`, tenantId, date).map(mapAppt);
}

export function getAppointment(db: Db, tenantId: string, id: string): Appointment {
  const r = db.get(`${APPT_SELECT} where a.id = ? and a.tenant_id = ?`, id, tenantId);
  if (!r) throw new HttpError(404, 'Appointment not found.');
  return mapAppt(r);
}

export function saveAppointment(db: Db, auth: AuthContext, body: z.infer<typeof appointmentSchema>, id?: string): Appointment {
  if (body.staffId && body.time) {
    // the same person cannot be booked twice at overlapping times
    const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    const start = toMin(body.time);
    for (const o of db.all("select id, time, minutes from appointment where tenant_id = ? and staff_id = ? and date = ? and time <> '' and status in ('booked','waiting','in_service') and id <> ?", auth.tenantId, body.staffId, body.date, id ?? '')) {
      const s = toMin(o.time);
      if (start < s + o.minutes && s < start + body.minutes) throw new HttpError(409, `That time overlaps another booking at ${o.time}.`);
    }
  }
  if (id) {
    getAppointment(db, auth.tenantId, id);
    db.run('update appointment set client_id=?, client_name=?, phone=?, service_id=?, staff_id=?, date=?, time=?, minutes=?, notes=?, walk_in=? where id=?', body.clientId, body.clientName, body.phone, body.serviceId, body.staffId, body.date, body.time, body.minutes, body.notes, body.walkIn ? 1 : 0, id);
  } else {
    id = uid();
    db.run(
      'insert into appointment (id, tenant_id, client_id, client_name, phone, service_id, staff_id, date, time, minutes, status, notes, walk_in, created_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id, auth.tenantId, body.clientId, body.clientName, body.phone, body.serviceId, body.staffId, body.date, body.time, body.minutes, body.walkIn ? 'waiting' : 'booked', body.notes, body.walkIn ? 1 : 0, now(),
    );
  }
  return getAppointment(db, auth.tenantId, id);
}

/** Move an appointment along; "done" parks a bill at the counter for it. */
export function setAppointmentStatus(db: Db, auth: AuthContext, id: string, status: Appointment['status']): Appointment {
  const a = getAppointment(db, auth.tenantId, id);
  db.run('update appointment set status = ? where id = ?', status, id);
  if (status === 'done' && !a.heldId && a.serviceId) {
    const s = db.get('select * from service where id = ?', a.serviceId)!;
    const hid = uid();
    const line = { serviceId: s.id, name: `${s.name}${a.staffName ? ` · ${a.staffName}` : ''}`, qty: 1000, unit: s.unit, unitPrice: s.default_price, discountType: 'percent', discountValue: s.default_discount_bp, taxRateBp: s.tax_rate_bp };
    db.run('insert into pos_held (id, tenant_id, name, client_id, lines, bill_discount, by_name, created_at) values (?,?,?,?,?,0,?,?)', hid, auth.tenantId, `${a.clientName} (${a.time || 'walk-in'})`, a.clientId, JSON.stringify([line]), auth.name, now());
    db.run('update appointment set held_id = ? where id = ?', hid, id);
  }
  return getAppointment(db, auth.tenantId, id);
}

// ================================================================ online shop and WhatsApp ordering

export const DEFAULT_SHOP: ShopSettings = { enabled: false, token: '', title: '', whatsapp: '', note: '', deliveryFee: 0, inStockOnly: false };
export const shopSchema = z.object({ enabled: z.boolean(), title: text(80), whatsapp: text(30), note: text(300), deliveryFee: minor.default(0), inStockOnly: z.boolean().default(false) });

export function getShop(db: Db, tenantId: string): ShopSettings {
  return getSetting(db, tenantId, 'shop', DEFAULT_SHOP);
}
export function saveShop(db: Db, auth: AuthContext, body: z.infer<typeof shopSchema>): ShopSettings {
  const cur = getShop(db, auth.tenantId);
  const token = cur.token || uid().replace(/[^a-z0-9]/gi, '').slice(-14);
  setSetting(db, auth.tenantId, 'shop', { ...body, token });
  if (!cur.token) db.run('insert or replace into shop_link (token, tenant_id) values (?, ?)', token, auth.tenantId);
  return getShop(db, auth.tenantId);
}

function shopTenant(db: Db, token: string) {
  const r = db.get('select tenant_id from shop_link where token = ?', token);
  if (!r) return null;
  const s = getShop(db, r.tenant_id);
  return s.enabled ? { tenantId: r.tenant_id as string, shop: s } : null;
}

function shopItems(db: Db, tenantId: string, s: ShopSettings) {
  return db
    .all(
      `select s.id, s.name, s.name_ur, s.category, s.default_price, s.unit, s.track_stock,
       case when s.track_stock = 1 then coalesce((select sum(m.qty) from stock_move m where m.item_id = s.id), 0) end as on_hand
       from service s where s.tenant_id = ? and s.status = 'active' and s.default_price > 0 order by s.category, s.name collate nocase limit 500`,
      tenantId,
    )
    .filter((r) => !s.inStockOnly || !r.track_stock || r.on_hand > 0);
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The public catalogue page: pick items, then send the order (to the shop's counter, and on WhatsApp). */
export function shopPage(db: Db, token: string): string | null {
  const t = shopTenant(db, token);
  if (!t) return null;
  const b = db.get('select * from business where tenant_id = ? order by created_at limit 1', t.tenantId);
  const m = (v: number) => formatMoney(v, b?.currency ?? 'PKR', b?.currency_precision ?? 2);
  const items = shopItems(db, t.tenantId, t.shop);
  const title = t.shop.title || b?.trading_name || b?.legal_name || 'Our shop';
  const cats = [...new Set(items.map((i) => i.category || 'Other'))];
  const data = items.map((i) => ({ id: i.id, n: i.name, p: i.default_price, u: i.unit, c: i.category || 'Other', out: !!i.track_stock && i.on_hand <= 0 }));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${esc(title)}</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#EEF1FB;color:#1A1D2E}
header{background:#3D5AF1;color:#fff;padding:20px 16px 26px}header h1{margin:0;font-size:22px}header p{margin:6px 0 0;opacity:.9;font-size:14px}
main{max-width:720px;margin:-14px auto 120px;padding:0 12px}h2{font-size:15px;margin:18px 4px 8px;color:#7A7F96}
.it{background:#fff;border-radius:16px;padding:12px 14px;margin-bottom:8px;display:flex;align-items:center;gap:10px;box-shadow:0 4px 14px rgba(41,52,110,.06)}
.it .n{flex:1;font-weight:600}.it .p{color:#3D5AF1;font-weight:800;font-size:14px}.q{display:flex;align-items:center;gap:6px}
button{border:0;border-radius:12px;font-weight:700;cursor:pointer}.q button{width:34px;height:34px;background:#E8ECFE;color:#3D5AF1;font-size:18px}.q b{min-width:20px;text-align:center}
.out{opacity:.5}.bar{position:fixed;left:0;right:0;bottom:0;background:#fff;padding:12px 16px;box-shadow:0 -6px 20px rgba(0,0,0,.08)}
.bar .in{max-width:720px;margin:0 auto}input,textarea{width:100%;padding:11px 12px;border:1px solid #E6E9F4;border-radius:12px;font:inherit;margin-top:6px;background:#F5F6FB}
.go{width:100%;padding:14px;background:#1E9E55;color:#fff;font-size:16px;margin-top:8px}.tot{display:flex;justify-content:space-between;font-weight:800}
#form{display:none}.done{background:#E2F6EA;color:#1E9E55;padding:14px;border-radius:14px;margin-top:12px;font-weight:700}
</style></head><body>
<header><h1>${esc(title)}</h1><p>${esc(t.shop.note || 'Choose what you need and send your order.')}</p></header>
<main>${cats
    .map((c) => `<h2>${esc(c)}</h2>${data.filter((i) => i.c === c).map((i) => `<div class="it ${i.out ? 'out' : ''}"><div class="n">${esc(i.n)}<div class="p">${m(i.p)}${i.u ? ` / ${esc(i.u)}` : ''}</div></div>${i.out ? '<small>Out of stock</small>' : `<div class="q"><button aria-label="Less" onclick="add('${i.id}',-1)">−</button><b id="q-${i.id}">0</b><button aria-label="More" onclick="add('${i.id}',1)">+</button></div>`}</div>`).join('')}`)
    .join('')}</main>
<div class="bar"><div class="in"><div class="tot"><span id="cnt">No items yet</span><span id="sum"></span></div>
<div id="form"><input id="nm" placeholder="Your name" autocomplete="name"/><input id="ph" placeholder="Phone number" inputmode="tel" autocomplete="tel"/>
<textarea id="ad" rows="2" placeholder="Delivery address (leave empty to pick up)"></textarea></div>
<button class="go" id="go" onclick="go()">Order</button><div id="msg"></div></div></div>
<script>
const items=${JSON.stringify(data).replace(/</g, '\\u003c')};const fee=${t.shop.deliveryFee};const cart={};const wa=${JSON.stringify(t.shop.whatsapp.replace(/\D/g, '').replace(/^0/, '92'))};
const money=v=>${JSON.stringify(b?.currency ?? 'PKR')}+' '+(v/${10 ** (b?.currency_precision ?? 2)}).toLocaleString();
function add(id,d){cart[id]=Math.max(0,(cart[id]||0)+d);document.getElementById('q-'+id).textContent=cart[id];draw()}
function draw(){const n=Object.values(cart).reduce((a,b)=>a+b,0);const s=items.reduce((a,i)=>a+(cart[i.id]||0)*i.p,0);document.getElementById('cnt').textContent=n?n+' item'+(n>1?'s':''):'No items yet';document.getElementById('sum').textContent=n?money(s):''}
async function go(){const f=document.getElementById('form');if(f.style.display!=='block'){f.style.display='block';return}
const lines=items.filter(i=>cart[i.id]).map(i=>({serviceId:i.id,qty:cart[i.id]}));if(!lines.length)return alert('Add something first');
const name=document.getElementById('nm').value.trim(),phone=document.getElementById('ph').value.trim(),address=document.getElementById('ad').value.trim();if(!name||!phone)return alert('Enter your name and phone');
const b=document.getElementById('go');b.disabled=true;b.textContent='Sending…';
try{const r=await fetch(location.pathname.replace(/\\/$/,'')+'/order',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,phone,address,lines})});const j=await r.json();if(!r.ok)throw new Error(j.error||'Could not send');
document.getElementById('msg').innerHTML='<div class="done">Order '+j.number+' received. We will call you to confirm.</div>';b.textContent='Sent';
if(wa){const t=encodeURIComponent('Order '+j.number+'\\n'+items.filter(i=>cart[i.id]).map(i=>'• '+i.n+' × '+cart[i.id]).join('\\n')+'\\n'+name+' '+phone+(address?'\\n'+address:''));setTimeout(()=>location.href='https://wa.me/'+wa+'?text='+t,800)}}
catch(e){alert(e.message);b.disabled=false;b.textContent='Order'}}
</script></body></html>`;
}

export const shopOrderSchema = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().min(7).max(30),
  address: text(300),
  lines: z.array(z.object({ serviceId: z.string().min(1), qty: z.number().int().min(1).max(999) })).min(1).max(100),
});

/** An order from the public catalogue: it lands in the counter's order list. */
export function shopOrder(db: Db, token: string, body: z.infer<typeof shopOrderSchema>) {
  const t = shopTenant(db, token);
  if (!t) throw new HttpError(404, 'This shop is closed.');
  const recent = db.get("select count(*) as n from table_order where tenant_id = ? and source = 'online' and created_at > ?", t.tenantId, new Date(Date.now() - 3_600_000).toISOString())!.n;
  if (recent > 100) throw new HttpError(429, 'Too many orders right now. Please call the shop.');
  const items = new Map(shopItems(db, t.tenantId, t.shop).map((i) => [i.id as string, i]));
  const lines: OrderLine[] = body.lines.map((l) => {
    const i = items.get(l.serviceId);
    if (!i) throw new HttpError(422, 'One of the items is no longer available.');
    return { serviceId: i.id, name: i.name, qty: l.qty * 1000, unit: i.unit, unitPrice: i.default_price, modifiers: [], note: '', section: '', sent: 0, taxRateBp: 0 };
  });
  if (body.address && t.shop.deliveryFee) lines.push({ serviceId: null, name: 'Delivery charge', qty: 1000, unit: '', unitPrice: t.shop.deliveryFee, modifiers: [], note: '', section: '', sent: 0, taxRateBp: 0 });
  const auth = { tenantId: t.tenantId, userId: 'online', name: 'Online shop', role: 'staff' } as unknown as AuthContext;
  const o = openOrder(db, auth, { kind: body.address ? 'delivery' : 'takeaway', table: '', guests: 0, customer: body.name, phone: body.phone, address: body.address, lines }, 'online');
  return { number: o.number, total: o.total };
}
