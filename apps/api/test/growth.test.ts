import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import { createApp } from '../src/app';
import { today } from '../src/core';
import { Db } from '../src/db';
import { applyPromotions, type Promotion } from '../../../packages/shared/src/index';

let server: Server;
let base = '';

before(() => {
  server = createApp(new Db(':memory:')).listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(() => server.close());

async function call(token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: any = text;
  try {
    parsed = JSON.parse(text);
  } catch {}
  return { status: res.status, body: parsed };
}

async function setup(email: string) {
  const token = (await call('', 'POST', '/auth/register', { businessName: 'Cafe Lahore', name: 'Owner', email, password: 'test-pass-123' })).body.accessToken as string;
  const businessId = (await call(token, 'GET', '/businesses')).body[0].id as string;
  const shift = (await call(token, 'POST', '/pos/shifts', { businessId })).body;
  const item = async (name: string, price: number, extra: object = {}) => (await call(token, 'POST', '/services', { name, defaultPrice: price, ...extra })).body;
  return { token, businessId, shift, item };
}
const L = (s: any, qty: number) => ({ serviceId: s.id, name: s.name, qty, unitPrice: s.defaultPrice });
const pay = (amount: number) => [{ tender: 'cash', amount }];

const promo = (p: Partial<Promotion>): Promotion => ({ id: 'p', name: 'P', kind: 'percent', itemIds: [], categories: [], percentBp: 0, buyQty: 0, getQty: 0, bundlePrice: 0, minSpend: 0, coupon: '', startDate: '', endDate: '', fromTime: '', toTime: '', days: [], membersOnly: false, active: true, ...p });
const at = { date: '2026-11-24', time: '18:30', weekday: 2 };

test('promotions engine: happy hour, buy-get, bundle, coupon', () => {
  const lines = [
    { serviceId: 'tea', qty: 3000, unitPrice: 10_000, category: 'Drinks' },
    { serviceId: 'cake', qty: 1000, unitPrice: 30_000, category: 'Bakery' },
  ];
  // 20% off drinks between 17:00 and 19:00
  const hh = promo({ id: 'hh', name: 'Happy hour', categories: ['Drinks'], percentBp: 2000, fromTime: '17:00', toTime: '19:00' });
  assert.deepEqual(applyPromotions(lines, [hh], at).lineDiscounts, [6_000, 0]);
  assert.deepEqual(applyPromotions(lines, [hh], { ...at, time: '20:00' }).lineDiscounts, [0, 0]);
  // buy 2 get 1 on tea: 3 teas → 1 free
  const b2g1 = promo({ id: 'b', kind: 'buy_get', itemIds: ['tea'], buyQty: 2000, getQty: 1000 });
  assert.deepEqual(applyPromotions(lines, [b2g1, hh], at).lineDiscounts, [10_000, 0], 'best offer per line wins');
  // tea + cake for 35,000 (instead of 40,000)
  const deal = promo({ id: 'd', kind: 'bundle', itemIds: ['tea', 'cake'], bundlePrice: 35_000 });
  const r = applyPromotions(lines, [deal], at);
  assert.equal(r.lineDiscounts[0] + r.lineDiscounts[1], 5_000);
  // 10% off the bill with a coupon, minimum 50,000
  const coupon = promo({ id: 'c', kind: 'bill', percentBp: 1000, minSpend: 50_000, coupon: 'EID10' });
  assert.equal(applyPromotions(lines, [coupon], at).billDiscount, 0);
  assert.equal(applyPromotions(lines, [coupon], at, 'eid10').billDiscount, 6_000);
});

test('POS sale: promotions, loyalty points, tiers and gift cards', async () => {
  const { token, shift, item } = await setup('g1@test.dev');
  const tea = await item('Chai', 10_000, { category: 'Drinks' });
  await call(token, 'POST', '/promotions', { name: 'Buy 2 get 1 chai', kind: 'buy_get', itemIds: [tea.id], buyQty: 2000, getQty: 1000 });
  await call(token, 'POST', '/promotions', { name: 'EID10', kind: 'bill', percentBp: 1000, coupon: 'EID10' });
  await call(token, 'PUT', '/loyalty/settings', { enabled: true, spendPerPoint: 10_000, pointValue: 100, minRedeem: 10, tiers: [{ name: 'Gold', minPoints: 5, discountBp: 500 }] });
  const ahmed = (await call(token, 'POST', '/clients', { name: 'Ahmed', phone: '0300-1234567' })).body;

  // 3 chai = 30,000, 1 free → 20,000; earns 2 points
  const preview = await call(token, 'POST', '/pos/preview', { lines: [L(tea, 3000)], clientId: ahmed.id });
  assert.equal(preview.body.lineDiscounts[0], 10_000);
  let s = await call(token, 'POST', '/pos/sales', { shiftId: shift.id, clientId: ahmed.id, lines: [L(tea, 3000)], tenders: pay(20_000) });
  assert.equal(s.status, 201, JSON.stringify(s.body));
  assert.equal(s.body.invoice.total, 20_000);
  assert.equal(s.body.pointsEarned, 2);

  // a bad coupon is refused; the good one takes 10% off the bill
  assert.equal((await call(token, 'POST', '/pos/sales', { shiftId: shift.id, lines: [L(tea, 1000)], coupon: 'NOPE', tenders: pay(10_000) })).status, 422);
  s = await call(token, 'POST', '/pos/sales', { shiftId: shift.id, clientId: ahmed.id, lines: [L(tea, 2000), { ...L(tea, 3000) }], coupon: 'EID10', tenders: pay(36_000) });
  assert.equal(s.status, 201, JSON.stringify(s.body));
  // lines 20,000 + (30,000 − 10,000 free) = 40,000, −10% = 36,000
  assert.equal(s.body.invoice.total, 36_000);

  // 2 + 3 = 5 points → Gold: 5% member discount; spend 10 points (= 1,000) too
  const found = (await call(token, 'GET', '/loyalty/find?phone=923001234567')).body;
  assert.equal(found.points, 5);
  assert.equal(found.tier.name, 'Gold');
  assert.equal((await call(token, 'POST', '/pos/sales', { shiftId: shift.id, clientId: ahmed.id, lines: [L(tea, 1000)], redeemPoints: 10, tenders: pay(8_500) })).status, 422, 'not enough points');
  await call(token, 'POST', `/loyalty/clients/${ahmed.id}/adjust`, { points: 10, reason: 'Welcome bonus' });
  s = await call(token, 'POST', '/pos/sales', { shiftId: shift.id, clientId: ahmed.id, lines: [L(tea, 1000)], redeemPoints: 10, tenders: pay(8_500) });
  assert.equal(s.status, 201, JSON.stringify(s.body));
  assert.equal(s.body.memberDiscount, 500);
  assert.equal(s.body.invoice.total, 10_000 - 500 - 1_000);

  // gift card: sold for 15,000 into the drawer, then spent
  const card = (await call(token, 'POST', '/gift-cards', { amount: 15_000, shiftId: shift.id })).body;
  assert.match(card.code, /^GC[A-Z0-9]{8}$/);
  s = await call(token, 'POST', '/pos/sales', { shiftId: shift.id, lines: [L(tea, 2000)], giftCards: [{ code: card.code, amount: 15_000 }], tenders: pay(5_000) });
  assert.equal(s.status, 201, JSON.stringify(s.body));
  assert.equal((await call(token, 'GET', `/gift-cards/${card.code}`)).body.status, 'used');
  assert.equal((await call(token, 'POST', '/pos/sales', { shiftId: shift.id, lines: [L(tea, 1000)], giftCards: [{ code: card.code, amount: 1 }], tenders: pay(9_999) })).status, 422);
  const z = (await call(token, 'GET', `/pos/shifts/${shift.id}`)).body;
  assert.equal(z.cashIn, 15_000);
});

test('restaurant: table order, kitchen tickets, split bill, recipe stock', async () => {
  const { token, shift, item } = await setup('g2@test.dev');
  const bun = await item('Bun', 0, { trackStock: true });
  await call(token, 'POST', '/stock/adjust', { itemId: bun.id, qty: 50_000, mode: 'opening' });
  const burger = await item('Zinger burger', 55_000, { kitchenSection: 'Kitchen', modifiers: [{ name: 'Extra cheese', price: 5_000 }], recipe: [{ itemId: bun.id, name: 'Bun', qty: 1000 }] });
  const drink = await item('Mint margarita', 30_000, { kitchenSection: 'Bar' });
  await call(token, 'PUT', '/restaurant/tables', { tables: [{ name: 'T1', area: 'Hall', seats: 4 }] });
  const o = await call(token, 'POST', '/orders', { kind: 'dine_in', table: 'T1', guests: 2 });
  assert.equal(o.status, 201, JSON.stringify(o.body));
  assert.equal((await call(token, 'POST', '/orders', { kind: 'dine_in', table: 'T1' })).status, 409);
  const ol = (s: any, qty: number, mods: string[] = [], add = 0) => ({ serviceId: s.id, name: s.name + (mods.length ? ` (${mods.join(', ')})` : ''), qty, unitPrice: s.defaultPrice + add, modifiers: mods, section: s.kitchenSection });
  await call(token, 'PUT', `/orders/${o.body.id}`, { lines: [ol(burger, 2000, ['Extra cheese'], 5_000), ol(drink, 2000)] });
  const kots = (await call(token, 'POST', `/orders/${o.body.id}/kot`)).body;
  assert.deepEqual(kots.map((k: any) => k.section).sort(), ['Bar', 'Kitchen']);
  assert.equal((await call(token, 'POST', `/orders/${o.body.id}/kot`)).status, 422, 'nothing new');
  assert.equal((await call(token, 'GET', '/kots?section=Kitchen')).body.length, 1);
  await call(token, 'POST', `/kots/${kots[0].id}/status`, { status: 'ready' });

  // guest 1 pays for the drinks; then the rest with 10% service charge
  const order = (await call(token, 'GET', `/orders/${o.body.id}`)).body;
  let s = await call(token, 'POST', '/pos/sales', { shiftId: shift.id, tableOrderId: order.id, settleLines: [1], lines: [{ ...order.lines[1], discountType: 'percent', discountValue: 0 }].map(({ modifiers, section, sent, note, ...l }: any) => l), tenders: pay(60_000) });
  assert.equal(s.status, 201, JSON.stringify(s.body));
  const left = (await call(token, 'GET', `/orders/${o.body.id}`)).body;
  assert.equal(left.lines.length, 1);
  assert.equal(left.status, 'open');
  s = await call(token, 'POST', '/pos/sales', { shiftId: shift.id, tableOrderId: order.id, serviceChargeBp: 1000, lines: [{ serviceId: burger.id, name: left.lines[0].name, qty: 2000, unitPrice: 60_000 }], tenders: pay(132_000) });
  assert.equal(s.status, 201, JSON.stringify(s.body));
  assert.equal(s.body.invoice.total, 120_000 + 12_000);
  assert.equal((await call(token, 'GET', `/orders/${o.body.id}`)).body.status, 'closed');
  // 2 burgers used 2 buns
  assert.equal((await call(token, 'GET', `/stock/${bun.id}`)).body.item.onHand, 48_000);
});

test('appointments: no double booking; done parks a bill', async () => {
  const { token, businessId, item } = await setup('g3@test.dev');
  const cut = await item('Haircut', 80_000);
  const staff = (await call(token, 'POST', '/employees', { businessId, name: 'Bilal', payType: 'monthly', rate: 0 })).body;
  const a = await call(token, 'POST', '/appointments', { clientName: 'Usman', phone: '0300', serviceId: cut.id, staffId: staff.id, date: today(), time: '15:00', minutes: 45 });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal((await call(token, 'POST', '/appointments', { clientName: 'Ali', serviceId: cut.id, staffId: staff.id, date: today(), time: '15:30' })).status, 409);
  assert.equal((await call(token, 'POST', '/appointments', { clientName: 'Ali', serviceId: cut.id, staffId: staff.id, date: today(), time: '15:45' })).status, 201);
  const done = (await call(token, 'POST', `/appointments/${a.body.id}/status`, { status: 'done' })).body;
  assert.ok(done.heldId);
  const held = (await call(token, 'GET', '/pos/held')).body;
  assert.equal(held[0].lines[0].unitPrice, 80_000);
  assert.equal((await call(token, 'GET', `/appointments?date=${today()}`)).body.length, 2);
});

test('online shop: public catalogue and order into the counter', async () => {
  const { token, item } = await setup('g4@test.dev');
  const naan = await item('Naan', 3_000, { category: 'Bread' });
  const s = (await call(token, 'PUT', '/shop/settings', { enabled: true, title: 'Cafe Lahore', whatsapp: '03001234567', deliveryFee: 15_000 })).body;
  assert.ok(s.token);
  const page = await call('', 'GET', `/s/${s.token}`);
  assert.equal(page.status, 200);
  assert.match(page.body, /Naan/);
  const order = await call('', 'POST', `/s/${s.token}/order`, { name: 'Sara', phone: '03331234567', address: 'House 5, Gulberg', lines: [{ serviceId: naan.id, qty: 4 }] });
  assert.equal(order.status, 201, JSON.stringify(order.body));
  assert.equal(order.body.total, 12_000 + 15_000);
  const open = (await call(token, 'GET', '/orders')).body;
  assert.equal(open[0].kind, 'delivery');
  assert.equal(open[0].customer, 'Sara');
  await call(token, 'PUT', '/shop/settings', { enabled: false });
  assert.equal((await call('', 'GET', `/s/${s.token}`)).status, 404);
});
