import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import { createApp } from '../src/app';
import { Db } from '../src/db';
import { code128Modules, ean13Modules, isEan13 } from '../../../packages/shared/src/index';

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

async function owner(email: string) {
  const r = await call('', 'POST', '/auth/register', { businessName: 'Label Shop', name: 'Owner', email, password: 'test-pass-123' });
  return r.body.accessToken as string;
}

test('barcode encoders produce standard module counts', () => {
  assert.equal(ean13Modules('4006381333931').length, 95);
  assert.throws(() => ean13Modules('4006381333932'));
  // start + 3 chars + check + stop = 5 × 11 + 13 modules
  assert.equal(code128Modules('A-1').length, 5 * 11 + 13);
});

test('stock items get their own barcode; duplicates are refused', async () => {
  const token = await owner('labels1@test.dev');
  const rice = (await call(token, 'POST', '/services', { name: 'Rice 1kg', defaultPrice: 40_000, trackStock: true })).body;
  assert.ok(isEan13(rice.barcode) && rice.barcode.startsWith('20'), rice.barcode);
  const consult = (await call(token, 'POST', '/services', { name: 'Consulting', defaultPrice: 100_000 })).body;
  assert.equal(consult.barcode, '');
  const dup = await call(token, 'POST', '/services', { name: 'Rice copy', defaultPrice: 1, barcode: rice.barcode });
  assert.equal(dup.status, 409);
  const sugar = (await call(token, 'POST', '/services', { name: 'Sugar', defaultPrice: 15_000, trackStock: true, autoCode: false })).body;
  assert.equal(sugar.barcode, '');
  const filled = await call(token, 'POST', '/services/auto-codes', {});
  assert.equal(filled.body.filled, 1);
  assert.equal((await call(token, 'GET', '/services/by-code/' + rice.barcode)).body.id, rice.id);
});

test('price changes queue labels; templates are saved per business', async () => {
  const token = await owner('labels2@test.dev');
  const item = (await call(token, 'POST', '/services', { name: 'Tea', nameUr: 'چائے', defaultPrice: 50_000, mrp: 55_000, trackStock: true })).body;
  assert.equal(item.nameUr, 'چائے');
  assert.equal(item.labelPending, false);
  const put = await call(token, 'PUT', `/services/${item.id}`, { ...item, defaultPrice: 52_000 });
  assert.equal(put.body.labelPending, true);
  assert.deepEqual((await call(token, 'GET', '/labels/pending')).body, [item.id]);
  await call(token, 'POST', '/labels/printed', { ids: [item.id] });
  assert.deepEqual((await call(token, 'GET', '/labels/pending')).body, []);

  const design = { name: 'My tag', size: 'roll50x25', code: 'barcode', show: { business: true, logo: false, name: true, nameUr: true, price: true, mrp: false, sku: false, unit: false } };
  const t = await call(token, 'POST', '/labels/templates', design);
  assert.equal(t.status, 201, JSON.stringify(t.body));
  assert.equal(t.body.size, 'roll50x25');
  await call(token, 'PUT', `/labels/templates/${t.body.id}`, { ...design, name: 'My tag 2', size: 'a4_65' });
  const list = (await call(token, 'GET', '/labels/templates')).body;
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'My tag 2');
  assert.equal((await call(token, 'POST', '/labels/templates', { ...design, size: 'huge' })).status, 422);
  await call(token, 'DELETE', `/labels/templates/${t.body.id}`);
  assert.equal((await call(token, 'GET', '/labels/templates')).body.length, 0);
});
