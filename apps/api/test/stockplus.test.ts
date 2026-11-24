import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import { createApp } from '../src/app';
import { today } from '../src/core';
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
const plus = (n: number) => new Date(Date.parse(`${today()}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function setup(email: string) {
  const token = (await call('', 'POST', '/auth/register', { businessName: 'Pharmacy', name: 'Owner', email, password: 'test-pass-123' })).body.accessToken as string;
  const businessId = (await call(token, 'GET', '/businesses')).body[0].id as string;
  const supplier = (await call(token, 'POST', '/suppliers', { name: 'Al-Madina Traders', phone: '03001234567' })).body;
  const milk = (await call(token, 'POST', '/services', { name: 'Milk 1L', defaultPrice: 30_000, trackStock: true, trackBatches: true, reorderLevel: 5_000, maxLevel: 20_000, packSize: 6_000 })).body;
  // batch A1 already expired, batch B2 expires in 10 days
  const grn = await call(token, 'POST', '/goods-receipts', {
    businessId,
    supplierId: supplier.id,
    date: today(),
    lines: [
      { itemId: milk.id, name: milk.name, qty: 4_000, unitPrice: 20_000, batch: 'A1', expiry: '2020-01-01' },
      { itemId: milk.id, name: milk.name, qty: 3_000, unitPrice: 22_000, batch: 'B2', expiry: plus(10) },
    ],
  });
  assert.equal(grn.status, 201, JSON.stringify(grn.body));
  return { token, businessId, supplier, milk };
}

test('batches: first-expiry-first-out, expired stock cannot be sold, write-off', async () => {
  const { token, businessId, milk } = await setup('sp1@test.dev');
  const batches = (await call(token, 'GET', `/stock/${milk.id}`)).body.batches;
  assert.deepEqual(batches.map((b: any) => [b.batchNo, b.qty]), [['A1', 4_000], ['B2', 3_000]]);
  assert.ok(batches[0].daysLeft < 0);

  const shift = (await call(token, 'POST', '/pos/shifts', { businessId })).body;
  const sell = (qty: number) => call(token, 'POST', '/pos/sales', { shiftId: shift.id, lines: [{ serviceId: milk.id, name: milk.name, qty, unitPrice: 30_000 }], tenders: [{ tender: 'cash', amount: (qty / 1000) * 30_000 }] });
  assert.equal((await sell(2_000)).status, 201);
  const after = (await call(token, 'GET', `/stock/${milk.id}`)).body.batches;
  assert.deepEqual(after.map((b: any) => [b.batchNo, b.qty]), [['A1', 4_000], ['B2', 1_000]], 'the sale came from the in-date batch');
  const refused = await sell(2_000);
  assert.equal(refused.status, 422);
  assert.match(refused.body.error, /expired/);

  // expiry dashboard, then write the expired batch off
  let ex = (await call(token, 'GET', '/stock/expiry')).body;
  assert.equal(ex.buckets.expired.count, 1);
  assert.equal(ex.buckets.d30.count, 1);
  assert.equal(ex.batches[0].supplierName, 'Al-Madina Traders');
  assert.equal((await call(token, 'POST', '/stock/write-off', { itemId: milk.id, batchNo: 'A1', expiry: '2020-01-01', qty: 5_000, reason: 'Expired' })).status, 422);
  const wo = await call(token, 'POST', '/stock/write-off', { itemId: milk.id, batchNo: 'A1', expiry: '2020-01-01', qty: 4_000, reason: 'Expired' });
  assert.equal(wo.status, 201, JSON.stringify(wo.body));
  ex = (await call(token, 'GET', '/stock/expiry')).body;
  assert.equal(ex.buckets.expired.count, 0);
  assert.equal(ex.lossThisMonth, wo.body.loss);
  assert.ok(wo.body.loss > 0);
});

test('reorder slip: suggested quantity to the pack size, grouped by supplier, into purchase orders', async () => {
  const { token, businessId, supplier, milk } = await setup('sp2@test.dev');
  await call(token, 'POST', '/stock/write-off', { itemId: milk.id, batchNo: 'B2', expiry: plus(10), qty: 3_000, reason: 'Damaged' });
  // the 4 left are the expired batch, so 0 can be sold: refill to 20 in packs of 6 → 24
  const slip = (await call(token, 'GET', '/stock/reorder-slip')).body;
  assert.equal(slip.groups.length, 1);
  assert.equal(slip.groups[0].supplierId, supplier.id);
  const line = slip.groups[0].lines[0];
  assert.equal(line.onHand, 0);
  assert.equal(line.suggested, 24_000);
  const made = await call(token, 'POST', '/stock/reorder-slip/orders', { businessId, groups: [{ supplierId: supplier.id, lines: [{ itemId: milk.id, qty: line.suggested, unitPrice: line.lastPrice }] }] });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body[0].status, 'draft');
  assert.equal(made.body[0].lines[0].qty, 24_000);
  assert.equal((await call(token, 'POST', '/stock/reorder-slip/orders', { businessId, groups: [{ supplierId: '', lines: [{ itemId: milk.id, qty: 1, unitPrice: 0 }] }] })).status, 422);
});

test('alert centre: expiry, low stock and settings', async () => {
  const { token, milk } = await setup('sp3@test.dev');
  let alerts = (await call(token, 'GET', '/stock/alerts')).body as any[];
  const types = new Set(alerts.map((a) => a.type));
  assert.ok(types.has('expired') && types.has('expiring'), JSON.stringify([...types]));
  assert.equal(alerts[0].level, 'danger');
  // a price under cost is flagged
  const fresh = (await call(token, 'GET', '/services')).body.find((s: any) => s.id === milk.id);
  await call(token, 'PUT', `/services/${milk.id}`, { ...fresh, defaultPrice: 10_000 });
  alerts = (await call(token, 'GET', '/stock/alerts')).body;
  assert.ok(alerts.some((a) => a.type === 'below_cost'));
  // switching a type off hides it; dismissing hides one alert
  const s = await call(token, 'PUT', '/stock/alert-settings', { off: ['expiring', 'below_cost'], deadDays: 30, expiryDays: 14, runningOutDays: 5 });
  assert.equal(s.body.deadDays, 30);
  alerts = (await call(token, 'GET', '/stock/alerts')).body;
  assert.ok(!alerts.some((a) => a.type === 'expiring' || a.type === 'below_cost'));
  const expired = alerts.find((a) => a.type === 'expired');
  await call(token, 'POST', '/alerts/dismiss', { key: expired.key });
  assert.ok(!(await call(token, 'GET', '/stock/alerts')).body.some((a: any) => a.key === expired.key));
});
