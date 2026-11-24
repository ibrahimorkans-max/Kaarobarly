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
const month = today().slice(0, 7);

test('attendance by QR and by hand feeds payroll days; commission becomes the bonus', async () => {
  const owner = (await call('', 'POST', '/auth/register', { businessName: 'Salon', name: 'Owner', email: 'pp1@test.dev', password: 'test-pass-123' })).body.accessToken as string;
  const businessId = (await call(owner, 'GET', '/businesses')).body[0].id;
  const staffUser = (await call(owner, 'POST', '/users', { name: 'Sana', email: 'sana@test.dev', password: 'test-pass-123', role: 'staff' })).body;
  const sana = (await call(owner, 'POST', '/employees', { businessId, name: 'Sana', payType: 'monthly', rate: 3_000_000, userId: staffUser.id, salesTarget: 10_000_000, commissionBp: 500 })).body;
  assert.equal(sana.commissionBp, 500);
  const ali = (await call(owner, 'POST', '/employees', { businessId, name: 'Ali', payType: 'daily', rate: 100_000 })).body;
  assert.equal((await call(owner, 'POST', '/employees', { businessId, name: 'Copy', rate: 0, userId: staffUser.id })).status, 409);

  // Sana scans the counter code: in, then out
  const code = (await call(owner, 'GET', '/attendance/settings')).body.code;
  const staff = (await call('', 'POST', '/auth/login', { email: 'sana@test.dev', password: 'test-pass-123' })).body.accessToken;
  assert.equal((await call(staff, 'POST', '/attendance/check', { code: 'WRONG' })).status, 422);
  assert.equal((await call(staff, 'POST', '/attendance/check', { code })).body.action, 'in');
  assert.equal((await call(staff, 'POST', '/attendance/check', { code })).body.action, 'out');
  assert.equal((await call(owner, 'POST', '/attendance/check', { code })).status, 422, 'owner login is not an employee');

  // Ali: worked 2 days, absent 1
  const d = (n: number) => `${month}-${String(n).padStart(2, '0')}`;
  await call(owner, 'POST', '/attendance/mark', { employeeId: ali.id, date: d(1), status: 'present', checkIn: '09:00' });
  await call(owner, 'POST', '/attendance/mark', { employeeId: ali.id, date: d(2), status: 'present', checkIn: '10:15' });
  await call(owner, 'POST', '/attendance/mark', { employeeId: ali.id, date: d(3), status: 'absent' });
  const mon = (await call(owner, 'GET', `/attendance/month?month=${month}`)).body;
  const a = mon.find((x: any) => x.name === 'Ali');
  assert.deepEqual([a.present, a.absent, a.late], [2, 1, 1]);

  // Sana sells 1,000,000 → 5% commission = 50,000
  const shift = (await call(staff, 'POST', '/pos/shifts', { businessId })).body;
  const inv = await call(staff, 'POST', '/pos/sales', { shiftId: shift.id, lines: [{ serviceId: null, name: 'Bridal makeup', qty: 1000, unitPrice: 1_000_000 }], tenders: [{ tender: 'cash', amount: 1_000_000 }] });
  assert.equal(inv.status, 201, JSON.stringify(inv.body));
  const board = (await call(owner, 'GET', `/people/leaderboard?month=${month}`)).body;
  assert.equal(board.rows[0].name, 'Sana');
  assert.equal(board.rows[0].commission, 50_000);
  assert.equal(board.rows[0].progressBp, 1000);

  const run = (await call(owner, 'POST', '/payroll', { businessId, month })).body;
  const slip = (n: string) => run.slips.find((s: any) => s.employeeName === n);
  assert.equal(slip('Ali').days, 2, 'daily pay from attendance');
  assert.equal(slip('Ali').earned, 200_000);
  assert.equal(slip('Sana').bonus, 50_000);
});

test('cashier performance from shifts', async () => {
  const owner = (await call('', 'POST', '/auth/register', { businessName: 'Shop', name: 'Owner', email: 'pp2@test.dev', password: 'test-pass-123' })).body.accessToken as string;
  const businessId = (await call(owner, 'GET', '/businesses')).body[0].id;
  const soap = (await call(owner, 'POST', '/services', { name: 'Soap', defaultPrice: 10_000 })).body;
  const shift = (await call(owner, 'POST', '/pos/shifts', { businessId, openingFloat: 0 })).body;
  for (const qty of [1000, 3000]) await call(owner, 'POST', '/pos/sales', { shiftId: shift.id, lines: [{ serviceId: soap.id, name: 'Soap', qty, unitPrice: 10_000 }], tenders: [{ tender: 'cash', amount: qty * 10 }] });
  await call(owner, 'POST', `/pos/shifts/${shift.id}/close`, { counted: 39_000 });
  const r = (await call(owner, 'GET', '/reports/cashiers')).body.rows[0];
  assert.equal(r.bills, 2);
  assert.equal(r.sales, 40_000);
  assert.equal(r.averageBill, 20_000);
  assert.equal(r.variance, -1_000);
  assert.equal(r.shortShifts, 1);
});
