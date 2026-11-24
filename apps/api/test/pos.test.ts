import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import { createApp } from '../src/app';
import { Db } from '../src/db';

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
  return { status: res.status, body: (await res.json()) as any };
}

async function setup(email: string) {
  const r = await call('', 'POST', '/auth/register', { businessName: 'Corner Shop', name: 'Owner', email, password: 'test-pass-123' });
  const token = r.body.accessToken as string;
  const businessId = (await call(token, 'GET', '/businesses')).body[0].id as string;
  const cash = (await call(token, 'GET', '/accounts')).body.find((a: any) => a.type === 'cash');
  const soap = (await call(token, 'POST', '/services', { name: 'Soap', defaultPrice: 15_000, trackStock: true, barcode: '8961000000011' })).body;
  const tea = (await call(token, 'POST', '/services', { name: 'Tea 250g', defaultPrice: 52_000, trackStock: true })).body;
  await call(token, 'POST', '/stock/adjust', { itemId: soap.id, qty: 100_000, mode: 'opening' });
  await call(token, 'POST', '/stock/adjust', { itemId: tea.id, qty: 20_000, mode: 'opening' });
  return { token, businessId, cash, soap, tea };
}
const line = (s: any, qty: number) => ({ serviceId: s.id, name: s.name, qty, unitPrice: s.defaultPrice });
const balance = async (token: string, id: string) => (await call(token, 'GET', `/accounts/${id}`)).body.balance as number;
const onHand = async (token: string, id: string) => (await call(token, 'GET', `/stock/${id}`)).body.item.onHand as number;

test('a shift: sell with split payment and change, stock goes out, the Z-report adds up', async () => {
  const { token, businessId, cash, soap, tea } = await setup('pos1@test.dev');
  const startCash = await balance(token, cash.id);
  const shift = await call(token, 'POST', '/pos/shifts', { businessId, openingFloat: 500_000 });
  assert.equal(shift.status, 201, JSON.stringify(shift.body));
  assert.equal((await call(token, 'POST', '/pos/shifts', { businessId })).status, 409);
  assert.equal((await call(token, 'GET', '/pos/shift')).body.shift.id, shift.body.id);

  // 3 soaps + 1 tea = 450 + 520 = 970: 500 card, 470 cash from a 1,000 note
  const sale = await call(token, 'POST', '/pos/sales', {
    shiftId: shift.body.id,
    lines: [line(soap, 3000), line(tea, 1000)],
    tenders: [{ tender: 'card', amount: 50_000 }, { tender: 'cash', amount: 47_000 }],
    cashGiven: 100_000,
  });
  assert.equal(sale.status, 201, JSON.stringify(sale.body));
  assert.equal(sale.body.invoice.total, 97_000);
  assert.equal(sale.body.invoice.displayStatus, 'paid');
  assert.equal(sale.body.invoice.clientName, 'Walk-in customer');
  assert.equal(sale.body.change, 53_000);
  assert.equal(await onHand(token, soap.id), 97_000);
  assert.equal(await balance(token, cash.id), startCash + 47_000);

  // payments must add up to the bill
  assert.equal((await call(token, 'POST', '/pos/sales', { shiftId: shift.body.id, lines: [line(soap, 1000)], tenders: [{ tender: 'cash', amount: 1 }] })).status, 422);
  // udhaar needs a named customer
  assert.equal((await call(token, 'POST', '/pos/sales', { shiftId: shift.body.id, lines: [line(soap, 1000)], tenders: [{ tender: 'credit', amount: 15_000 }] })).status, 422);
  const cust = (await call(token, 'POST', '/clients', { name: 'Regular Ahmed' })).body;
  const credit = await call(token, 'POST', '/pos/sales', { shiftId: shift.body.id, clientId: cust.id, lines: [line(tea, 2000)], tenders: [{ tender: 'cash', amount: 4_000 }, { tender: 'credit', amount: 100_000 }] });
  assert.equal(credit.status, 201, JSON.stringify(credit.body));
  assert.equal((await call(token, 'GET', `/clients/${cust.id}`)).body.outstanding, 100_000);

  // drawer moves
  await call(token, 'POST', `/pos/shifts/${shift.body.id}/cash`, { kind: 'out', amount: 20_000, reason: 'Safe drop' });
  const z = (await call(token, 'GET', `/pos/shifts/${shift.body.id}`)).body;
  assert.equal(z.sales, 2);
  assert.equal(z.salesTotal, 97_000 + 104_000);
  assert.deepEqual(Object.fromEntries(z.byTender.map((t: any) => [t.tender, t.amount])), { cash: 51_000, card: 50_000, credit: 100_000 });
  assert.equal(z.expectedCash, 500_000 + 51_000 - 20_000);

  // blind count 2,000 short is recorded as money out
  const closed = await call(token, 'POST', `/pos/shifts/${shift.body.id}/close`, { counted: 529_000 });
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  assert.equal(closed.body.shift.difference, -2_000);
  assert.equal(closed.body.shift.status, 'closed');
  assert.equal((await call(token, 'POST', '/pos/sales', { shiftId: shift.body.id, lines: [line(soap, 1000)], tenders: [{ tender: 'cash', amount: 15_000 }] })).status, 409);
});

test('returns: stock comes back and the paid part is refunded from the drawer', async () => {
  const { token, businessId, cash, soap } = await setup('pos2@test.dev');
  const shift = (await call(token, 'POST', '/pos/shifts', { businessId, openingFloat: 0 })).body;
  const sale = (await call(token, 'POST', '/pos/sales', { shiftId: shift.id, lines: [line(soap, 4000)], tenders: [{ tender: 'cash', amount: 60_000 }] })).body.invoice;
  const before = await balance(token, cash.id);
  const found = (await call(token, 'GET', `/pos/sales/find?number=${encodeURIComponent(sale.number)}`)).body;
  assert.equal(found.id, sale.id);
  const ret = await call(token, 'POST', '/pos/returns', { shiftId: shift.id, invoiceId: sale.id, reason: 'Damaged', lines: [{ serviceId: soap.id, name: 'Soap', qty: 1000, unitPrice: 15_000 }] });
  assert.equal(ret.status, 201, JSON.stringify(ret.body));
  assert.equal(ret.body.refund, 15_000);
  assert.equal(await balance(token, cash.id), before - 15_000);
  assert.equal(await onHand(token, soap.id), 97_000);
  assert.equal(ret.body.invoice.balance, 0);
  // cannot return more than was sold
  assert.equal((await call(token, 'POST', '/pos/returns', { shiftId: shift.id, invoiceId: sale.id, reason: 'x', lines: [{ serviceId: soap.id, name: 'Soap', qty: 4000, unitPrice: 15_000 }] })).status, 422);
  const z = (await call(token, 'GET', `/pos/shifts/${shift.id}`)).body;
  assert.equal(z.returns, 1);
  assert.equal(z.cashRefunds, 15_000);
  assert.equal(z.expectedCash, 60_000 - 15_000);
});

test('cashiers: limited discounts, own shift only, held bills', async () => {
  const { token, businessId, soap } = await setup('pos3@test.dev');
  await call(token, 'POST', '/users', { name: 'Cashier', email: 'cashier3@test.dev', password: 'test-pass-123', role: 'staff' });
  const cashier = (await call('', 'POST', '/auth/login', { email: 'cashier3@test.dev', password: 'test-pass-123' })).body.accessToken;
  const shift = (await call(cashier, 'POST', '/pos/shifts', { businessId })).body;
  // 20% off is over the cashier limit; 5% is fine
  const big = await call(cashier, 'POST', '/pos/sales', { shiftId: shift.id, lines: [line(soap, 1000)], billDiscountType: 'percent', billDiscountValue: 2000, tenders: [{ tender: 'cash', amount: 12_000 }] });
  assert.equal(big.status, 403);
  assert.equal((await call(cashier, 'POST', '/pos/sales', { shiftId: shift.id, lines: [line(soap, 1000)], billDiscountType: 'percent', billDiscountValue: 500, tenders: [{ tender: 'cash', amount: 14_250 }] })).status, 201);
  // returns need a manager
  const s = (await call(cashier, 'GET', '/pos/shift')).body;
  assert.equal(s.report.sales, 1);
  // held bills come back and are cleared by the sale
  const held = (await call(cashier, 'POST', '/pos/held', { lines: [line(soap, 2000)] })).body;
  assert.equal(held.name, 'Bill 1');
  assert.equal((await call(cashier, 'GET', '/pos/held')).body.length, 1);
  await call(cashier, 'POST', '/pos/sales', { shiftId: shift.id, heldId: held.id, lines: held.lines, tenders: [{ tender: 'cash', amount: 30_000 }] });
  assert.equal((await call(cashier, 'GET', '/pos/held')).body.length, 0);
  // the owner (manager rights) cannot be blocked from another shift, but another cashier is
  await call(token, 'POST', '/users', { name: 'Other', email: 'other3@test.dev', password: 'test-pass-123', role: 'staff' });
  const other = (await call('', 'POST', '/auth/login', { email: 'other3@test.dev', password: 'test-pass-123' })).body.accessToken;
  assert.equal((await call(other, 'POST', '/pos/sales', { shiftId: shift.id, lines: [line(soap, 1000)], tenders: [{ tender: 'cash', amount: 15_000 }] })).status, 403);
});
