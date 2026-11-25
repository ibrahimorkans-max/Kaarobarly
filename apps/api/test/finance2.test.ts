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
  const token = (await call('', 'POST', '/auth/register', { businessName: 'Traders', name: 'Owner', email, password: 'test-pass-123' })).body.accessToken as string;
  const businessId = (await call(token, 'GET', '/businesses')).body[0].id as string;
  return { token, businessId };
}

test('tax centre: output tax on sales, input tax on purchases, customers without NTN', async () => {
  const { token, businessId } = await setup('f1@test.dev');
  const client = (await call(token, 'POST', '/clients', { name: 'No NTN Co' })).body;
  const inv = await call(token, 'POST', '/invoices', { businessId, clientId: client.id, issueDate: today(), dueDate: today(), lines: [{ name: 'Goods', qty: 1000, unitPrice: 100_000, taxRateBp: 1800 }], finalize: true });
  assert.equal(inv.status, 201, JSON.stringify(inv.body));
  await call(token, 'POST', '/purchases', { businessId, supplier: 'Al-Noor Wholesale', date: today(), lines: [{ name: 'Stock', qty: 1000, unitPrice: 59_000 }], taxAmount: 9_000 });
  await call(token, 'POST', '/finance/entries', { businessId, type: 'expense', category: 'Taxes & fees', amount: 5_000, date: today() });
  const t = (await call(token, 'GET', '/tax/summary')).body;
  assert.equal(t.totals.outputTax, 18_000);
  assert.equal(t.totals.inputTax, 9_000);
  assert.equal(t.totals.payable, 9_000);
  assert.equal(t.totals.paid, 5_000);
  assert.equal(t.noNtn[0].name, 'No NTN Co');
});

test('owner investment and loans received are not income', async () => {
  const { token, businessId } = await setup('f2@test.dev');
  await call(token, 'POST', '/finance/entries', { businessId, type: 'income', category: 'Owner investment', amount: 500_000, date: today() });
  await call(token, 'POST', '/finance/entries', { businessId, type: 'income', category: 'Other income', amount: 10_000, date: today() });
  const pnl = (await call(token, 'GET', `/reports/pnl?from=${today()}&to=${today()}`)).body;
  assert.equal(pnl.totalIncome ?? pnl.income?.reduce?.((s: number, x: any) => s + x.amount, 0), 10_000, JSON.stringify(pnl).slice(0, 300));
});

test('reconciliation: statement lines match recorded money; new lines are added', async () => {
  const { token, businessId } = await setup('f3@test.dev');
  const bank = (await call(token, 'GET', '/accounts')).body.find((a: any) => a.type === 'bank');
  await call(token, 'POST', '/finance/entries', { businessId, type: 'income', category: 'Sales', amount: 250_000, date: today(), accountId: bank.id, method: 'bank_transfer' });
  await call(token, 'POST', '/finance/entries', { businessId, type: 'expense', category: 'Rent', amount: 80_000, date: plus(-1), accountId: bank.id, method: 'bank_transfer' });
  const rows = [
    { date: plus(1), description: 'IBFT ALI', amount: 250_000 },
    { date: plus(-1), description: 'RENT', amount: -80_000 },
    { date: today(), description: 'SMS CHARGES', amount: -150 },
  ];
  const p = (await call(token, 'POST', '/reconcile/preview', { accountId: bank.id, rows })).body;
  assert.equal(p.matched, 2, JSON.stringify(p));
  assert.equal(p.unmatched, 1);
  const s = await call(token, 'POST', '/reconcile/confirm', {
    accountId: bank.id,
    matches: p.rows.filter((r: any) => r.match).map((r: any) => ({ key: r.match.key, date: r.date, description: r.description, amount: r.amount })),
    add: [{ date: today(), description: 'SMS CHARGES', amount: -150, category: 'Taxes & fees' }],
  });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal(s.body.matched, 3);
  assert.equal(s.body.openLast90, 0);
  // matched lines are not offered again
  assert.equal((await call(token, 'POST', '/reconcile/preview', { accountId: bank.id, rows })).body.matched, 0);
});

test('profit by item, customer and cashier', async () => {
  const { token, businessId } = await setup('f4@test.dev');
  const rice = (await call(token, 'POST', '/services', { name: 'Rice', defaultPrice: 30_000, trackStock: true, category: 'Grocery' })).body;
  await call(token, 'POST', '/stock/adjust', { itemId: rice.id, qty: 10_000, mode: 'opening', unitCost: 20_000 });
  const c = (await call(token, 'POST', '/clients', { name: 'Hotel One' })).body;
  await call(token, 'POST', '/invoices', { businessId, clientId: c.id, issueDate: today(), dueDate: today(), lines: [{ serviceId: rice.id, name: 'Rice', qty: 4000, unitPrice: 30_000 }, { name: 'Delivery', qty: 1000, unitPrice: 10_000 }], finalize: true });
  const byItem = (await call(token, 'GET', '/reports/profit?by=item')).body;
  const r = byItem.rows.find((x: any) => x.name === 'Rice');
  assert.equal(r.revenue, 120_000);
  assert.equal(r.cost, 80_000);
  assert.equal(r.marginBp, 3333);
  assert.equal(byItem.totals.revenue, 130_000);
  const byClient = (await call(token, 'GET', '/reports/profit?by=client')).body;
  assert.equal(byClient.rows[0].profit, 50_000);
  assert.equal((await call(token, 'GET', '/reports/profit?by=cashier')).body.rows[0].name, 'Owner');
  assert.equal((await call(token, 'GET', '/reports/profit?by=category')).body.rows.find((x: any) => x.name === 'Grocery').profit, 40_000);
});
