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
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: (await res.json()) as any };
}
const plus = (n: number) => new Date(Date.parse(`${today()}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

test('unpaid purchase bills: overdue, due soon, aging, suppliers, part and full payment', async () => {
  const token = (await call('', 'POST', '/auth/register', { businessName: 'Traders', name: 'Owner', email: 'pay@test.dev', password: 'test-pass-123' })).body.accessToken as string;
  const businessId = (await call(token, 'GET', '/businesses')).body[0].id as string;
  const bill = (supplier: string, date: string, amount: number, installments: { dueDate: string; amount: number; paid?: boolean }[]) =>
    call(token, 'POST', '/purchases', { businessId, supplier, date, method: 'cash', lines: [{ name: 'Stock', qty: 1000, unitPrice: amount }], installments });

  // paid at once: never shows up
  assert.equal((await bill('Cash Mart', today(), 10_000, [])).status, 201);
  // 45 days overdue, pay later
  const a = (await bill('Al-Noor Wholesale', plus(-60), 300_000, [{ dueDate: plus(-45), amount: 300_000 }])).body;
  // two installments: one paid, one due in 3 days
  const b = (await bill('Al-Noor Wholesale', plus(-10), 200_000, [{ dueDate: plus(-5), amount: 100_000, paid: true }, { dueDate: plus(3), amount: 100_000 }])).body;
  // due next month
  const c = (await bill('Gul Oils', today(), 50_000, [{ dueDate: plus(30), amount: 50_000 }])).body;

  const r = (await call(token, 'GET', '/purchases/unpaid')).body;
  assert.equal(r.totals.bills, 3);
  assert.equal(r.totals.unpaid, 450_000);
  assert.equal(r.totals.overdue, 300_000);
  assert.equal(r.totals.dueSoon, 100_000);
  assert.deepEqual(r.aging, { notDue: 150_000, d1_30: 0, d31_60: 300_000, d61_90: 0, d90plus: 0 });
  assert.equal(r.bills[0].id, a.id);
  assert.equal(r.bills[0].status, 'overdue');
  assert.equal(r.bills[0].daysOverdue, 45);
  assert.equal(r.bills.find((x: any) => x.id === b.id).status, 'due_soon');
  assert.equal(r.bills.find((x: any) => x.id === c.id).status, 'upcoming');
  assert.equal(r.suppliers[0].supplier, 'Al-Noor Wholesale');
  assert.equal(r.suppliers[0].unpaid, 400_000);
  assert.equal((await call(token, 'GET', '/purchases/unpaid?supplier=gul%20oils')).body.bills.length, 1);

  // part payment splits the installment; money out follows
  assert.equal((await call(token, 'POST', `/purchases/${a.id}/pay`, { amount: 500_000 })).status, 422);
  assert.equal((await call(token, 'POST', `/purchases/${a.id}/pay`, { amount: 1000, date: plus(1) })).status, 422);
  const part = await call(token, 'POST', `/purchases/${a.id}/pay`, { amount: 120_000 });
  assert.equal(part.status, 200, JSON.stringify(part.body));
  assert.equal(part.body.paid, 120_000);
  assert.equal(part.body.balance, 180_000);
  assert.equal(part.body.installments.length, 2);
  assert.deepEqual(part.body.installments.map((x: any) => [x.amount, x.paid]), [[120_000, true], [180_000, false]]);
  const entry = (await call(token, 'GET', `/purchases/${a.id}`)).body.financeEntryId;
  assert.ok(entry, 'a money out entry exists for what was paid');

  // pay the rest
  const full = await call(token, 'POST', `/purchases/${a.id}/pay`, { all: true });
  assert.equal(full.body.balance, 0);
  assert.equal((await call(token, 'POST', `/purchases/${a.id}/pay`, { all: true })).status, 422);
  const after = (await call(token, 'GET', '/purchases/unpaid')).body;
  assert.equal(after.totals.unpaid, 150_000);
  assert.equal(after.totals.overdue, 0);
  assert.equal((await call(token, 'GET', '/purchases/summary')).body.unpaid, 150_000);
});
