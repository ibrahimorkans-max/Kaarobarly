/**
 * Restaurant and service modes, loyalty, gift cards, promotions and the online shop.
 * The promotions engine is shared: the phone previews it, the server applies it.
 */

// ================================================================ promotions

export type PromotionKind = 'percent' | 'buy_get' | 'bundle' | 'bill';
export const PROMOTION_KIND_LABELS: Record<PromotionKind, string> = {
  percent: 'Percent off items or categories',
  buy_get: 'Buy X, get Y free',
  bundle: 'Bundle at a fixed price',
  bill: 'Percent off the bill (minimum spend)',
};

export interface Promotion {
  id: string;
  name: string;
  kind: PromotionKind;
  /** items or categories it applies to; both empty = everything (percent kind) */
  itemIds: string[];
  categories: string[];
  /** percent and bill kinds, basis points */
  percentBp: number;
  /** buy_get: buy this many (thousandths), get this many free */
  buyQty: number;
  getQty: number;
  /** bundle: one of each listed item for this price (minor units) */
  bundlePrice: number;
  /** bill kind: minimum subtotal (minor units) */
  minSpend: number;
  /** only with this code ('' = automatic) */
  coupon: string;
  startDate: string;
  endDate: string;
  /** happy hour, HH:MM–HH:MM ('' = all day) */
  fromTime: string;
  toTime: string;
  /** 0 = Sunday … 6 = Saturday; empty = every day */
  days: number[];
  /** members only (any loyalty tier) */
  membersOnly: boolean;
  active: boolean;
}

export interface PromoLine {
  serviceId: string | null;
  qty: number;
  unitPrice: number;
  category?: string;
}
export interface AppliedPromo {
  promotionId: string;
  name: string;
  amount: number;
}
export interface PromoResult {
  /** extra discount per line index (minor units, on the line total) */
  lineDiscounts: number[];
  /** off the bill as a whole */
  billDiscount: number;
  applied: AppliedPromo[];
}

const lineTotal = (l: PromoLine) => Math.round((l.qty * l.unitPrice) / 1000);

/** Is the promotion running at this moment (local date/time strings) for this customer and coupon? */
export function promotionLive(p: Promotion, at: { date: string; time: string; weekday: number }, coupon: string, member: boolean): boolean {
  if (!p.active) return false;
  if (p.startDate && at.date < p.startDate) return false;
  if (p.endDate && at.date > p.endDate) return false;
  if (p.days.length && !p.days.includes(at.weekday)) return false;
  if (p.fromTime && p.toTime) {
    const inWindow = p.fromTime <= p.toTime ? at.time >= p.fromTime && at.time < p.toTime : at.time >= p.fromTime || at.time < p.toTime;
    if (!inWindow) return false;
  }
  if (p.coupon && p.coupon.trim().toUpperCase() !== coupon.trim().toUpperCase()) return false;
  if (p.membersOnly && !member) return false;
  return true;
}

const matches = (p: Promotion, l: PromoLine) => (!p.itemIds.length && !p.categories.length) || (!!l.serviceId && p.itemIds.includes(l.serviceId)) || (!!l.category && p.categories.includes(l.category));

/**
 * Apply every live promotion. Item promotions do not stack on the same line: each line takes the
 * best one. The bill promotion applies to what is left.
 */
export function applyPromotions(lines: PromoLine[], promos: Promotion[], at: { date: string; time: string; weekday: number }, coupon = '', member = false): PromoResult {
  const live = promos.filter((p) => promotionLive(p, at, coupon, member));
  const best = lines.map(() => ({ amount: 0, promo: null as Promotion | null }));
  const offer = (i: number, amount: number, p: Promotion) => {
    const a = Math.min(Math.max(0, Math.round(amount)), lineTotal(lines[i]));
    if (a > best[i].amount) best[i] = { amount: a, promo: p };
  };

  for (const p of live) {
    if (p.kind === 'percent') {
      lines.forEach((l, i) => matches(p, l) && offer(i, (lineTotal(l) * p.percentBp) / 10_000, p));
    } else if (p.kind === 'buy_get' && p.buyQty > 0 && p.getQty > 0) {
      // per matching line: for every (buy + get) units, the get units are free
      lines.forEach((l, i) => {
        if (!matches(p, l)) return;
        const set = p.buyQty + p.getQty;
        const free = Math.floor(l.qty / set) * p.getQty + Math.max(0, (l.qty % set) - p.buyQty);
        if (free > 0) offer(i, (free * l.unitPrice) / 1000, p);
      });
    } else if (p.kind === 'bundle' && p.itemIds.length > 1 && p.bundlePrice > 0) {
      const idx = p.itemIds.map((id) => lines.findIndex((l) => l.serviceId === id));
      if (idx.some((i) => i < 0)) continue;
      const sets = Math.min(...idx.map((i) => Math.floor(lines[i].qty / 1000)));
      if (sets < 1) continue;
      const full = idx.reduce((s, i) => s + lines[i].unitPrice, 0);
      const saving = (full - p.bundlePrice) * sets;
      if (saving <= 0) continue;
      // spread the saving over the bundle lines by price
      let left = saving;
      idx.forEach((i, k) => {
        const share = k === idx.length - 1 ? left : Math.round((saving * lines[i].unitPrice) / full);
        left -= share;
        offer(i, share, p);
      });
    }
  }

  const lineDiscounts = best.map((b) => b.amount);
  const totals = new Map<string, AppliedPromo>();
  best.forEach((b) => {
    if (!b.promo || !b.amount) return;
    const cur = totals.get(b.promo.id) ?? { promotionId: b.promo.id, name: b.promo.name, amount: 0 };
    cur.amount += b.amount;
    totals.set(b.promo.id, cur);
  });

  let billDiscount = 0;
  const after = lines.reduce((s, l, i) => s + lineTotal(l) - lineDiscounts[i], 0);
  for (const p of live.filter((x) => x.kind === 'bill')) {
    if (after < p.minSpend) continue;
    const a = Math.round((after * p.percentBp) / 10_000);
    if (a > billDiscount) billDiscount = a;
  }
  const billPromo = live.filter((x) => x.kind === 'bill' && after >= x.minSpend).sort((a, b) => b.percentBp - a.percentBp)[0];
  if (billPromo && billDiscount) totals.set(billPromo.id, { promotionId: billPromo.id, name: billPromo.name, amount: billDiscount });
  return { lineDiscounts, billDiscount, applied: [...totals.values()] };
}

// ================================================================ loyalty and gift cards

export interface LoyaltyTier {
  name: string;
  /** lifetime points needed */
  minPoints: number;
  /** member discount on every bill, basis points */
  discountBp: number;
}
export interface LoyaltySettings {
  enabled: boolean;
  /** spend this much (minor units) to earn 1 point */
  spendPerPoint: number;
  /** one point is worth this much when redeemed (minor units) */
  pointValue: number;
  /** points needed before they can be redeemed */
  minRedeem: number;
  tiers: LoyaltyTier[];
}
export const DEFAULT_LOYALTY: LoyaltySettings = {
  enabled: false,
  spendPerPoint: 10_000,
  pointValue: 100,
  minRedeem: 100,
  tiers: [
    { name: 'Silver', minPoints: 1_000, discountBp: 200 },
    { name: 'Gold', minPoints: 5_000, discountBp: 500 },
  ],
};

export interface LoyaltyAccount {
  clientId: string;
  name: string;
  phone: string;
  points: number;
  lifetime: number;
  tier: LoyaltyTier | null;
  nextTier: LoyaltyTier | null;
  history: { id: string; points: number; reason: string; at: string }[];
}

export interface GiftCard {
  id: string;
  code: string;
  initial: number;
  balance: number;
  clientName: string;
  status: 'active' | 'used' | 'cancelled';
  createdAt: string;
}

/** Tier for a lifetime points total. */
export function tierFor(tiers: LoyaltyTier[], lifetime: number): LoyaltyTier | null {
  return [...tiers].sort((a, b) => b.minPoints - a.minPoints).find((t) => lifetime >= t.minPoints) ?? null;
}

// ================================================================ restaurant

export type OrderKind = 'dine_in' | 'takeaway' | 'delivery';
export const ORDER_KIND_LABELS: Record<OrderKind, string> = { dine_in: 'Dine-in', takeaway: 'Takeaway', delivery: 'Delivery' };

export interface Modifier {
  name: string;
  /** added to the price, minor units (can be 0) */
  price: number;
}

export interface OrderLine {
  serviceId: string | null;
  name: string;
  qty: number;
  unit: string;
  unitPrice: number;
  modifiers: string[];
  note: string;
  /** kitchen, bar … ('' = not sent to a kitchen) */
  section: string;
  /** quantity already sent to the kitchen */
  sent: number;
  taxRateBp: number;
}

export interface TableOrder {
  id: string;
  number: string;
  kind: OrderKind;
  table: string;
  guests: number;
  customer: string;
  phone: string;
  address: string;
  waiter: string;
  lines: OrderLine[];
  status: 'open' | 'closed' | 'cancelled';
  total: number;
  createdAt: string;
  /** a rider for delivery orders */
  rider: string;
  deliveryStatus: '' | 'preparing' | 'on_the_way' | 'delivered';
}

export interface Kot {
  id: string;
  number: number;
  orderId: string;
  orderNumber: string;
  table: string;
  kind: OrderKind;
  section: string;
  items: { name: string; qty: number; modifiers: string[]; note: string }[];
  status: 'new' | 'ready' | 'served';
  createdAt: string;
}

export interface RecipeLine {
  itemId: string;
  name: string;
  /** thousandths of the ingredient per 1 unit sold */
  qty: number;
}

// ================================================================ service mode

export type AppointmentStatus = 'booked' | 'waiting' | 'in_service' | 'done' | 'no_show' | 'cancelled';
export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  booked: 'Booked',
  waiting: 'Waiting',
  in_service: 'In service',
  done: 'Done',
  no_show: 'No-show',
  cancelled: 'Cancelled',
};
export interface Appointment {
  id: string;
  clientId: string | null;
  clientName: string;
  phone: string;
  serviceId: string | null;
  serviceName: string;
  price: number;
  staffId: string | null;
  staffName: string;
  date: string;
  time: string;
  minutes: number;
  status: AppointmentStatus;
  notes: string;
  /** walk-in queue position (waiting) */
  walkIn: boolean;
  heldId: string | null;
  createdAt: string;
}

// ================================================================ online shop

export interface ShopSettings {
  enabled: boolean;
  token: string;
  title: string;
  whatsapp: string;
  note: string;
  deliveryFee: number;
  /** show only items in stock (tracked items) */
  inStockOnly: boolean;
}
