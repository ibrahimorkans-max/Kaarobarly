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

const day = new Date().toISOString().slice(0, 10);

async function setup(email: string) {
  const r = await call('', 'POST', '/auth/register', { businessName: 'People Co', name: 'Owner', email, password: 'test-pass-123' });
  const token = r.body.accessToken as string;
  const businessId = (await call(token, 'GET', '/businesses')).body[0].id as string;
  const cash = (await call(token, 'GET', '/accounts')).body.find((a: any) => a.type === 'cash');
  await call(token, 'POST', '/finance/entries', { businessId, type: 'income', category: 'Owner investment', amount: 50_000_000, date: day, method: 'cash', accountId: cash.id });
  return { token, businessId, cash };
}
async function member(owner: string, email: string, role: string) {
  await call(owner, 'POST', '/users', { name: `${role} person`, email, password: 'test-pass-123', role });
  return (await call('', 'POST', '/auth/login', { email, password: 'test-pass-123' })).body.accessToken as string;
}
const balance = async (token: string, id: string) => (await call(token, 'GET', `/accounts/${id}`)).body.balance as number;

test('payroll: advances are recovered, approval is required, salaries are a cost and advances are not', async () => {
  const { token, businessId, cash } = await setup('ppl1@test.dev');
  const ali = (await call(token, 'POST', '/employees', { businessId, name: 'Ali', designation: 'Driver', payType: 'monthly', rate: 3_000_000 })).body;
  const sara = (await call(token, 'POST', '/employees', { businessId, name: 'Sara', payType: 'daily', rate: 150_000 })).body;
  assert.equal(ali.payType, 'monthly');

  // an advance of 10,000 leaves the cash now, recovered 5,000 a month; it is not an expense
  const start = await balance(token, cash.id);
  const adv = await call(token, 'POST', `/employees/${ali.id}/advance`, { amount: 1_000_000, date: day, accountId: cash.id, monthlyRecovery: 500_000 });
  assert.equal(adv.status, 201, JSON.stringify(adv.body));
  assert.equal(adv.body.advanceDue, 1_000_000);
  assert.equal(await balance(token, cash.id), start - 1_000_000);
  assert.equal((await call(token, 'GET', `/reports/pnl?from=${day}&to=${day}`)).body.totalExpenses, 0);

  const month = day.slice(0, 7);
  const run = await call(token, 'POST', '/payroll', { businessId, month });
  assert.equal(run.status, 201, JSON.stringify(run.body));
  const aliSlip = run.body.slips.find((s: any) => s.employeeId === ali.id);
  const saraSlip = run.body.slips.find((s: any) => s.employeeId === sara.id);
  assert.equal(aliSlip.advanceRecovery, 500_000);
  assert.equal(aliSlip.net, 2_500_000);
  assert.equal(saraSlip.net, 0);
  assert.equal((await call(token, 'POST', '/payroll', { businessId, month })).status, 409);

  // Sara worked 20 days; Ali gets a 2,000 bonus and missed 3 days
  const dim = aliSlip.daysInMonth;
  await call(token, 'PUT', `/payroll/${run.body.id}/slips/${saraSlip.id}`, { days: 20 });
  const edited = (await call(token, 'PUT', `/payroll/${run.body.id}/slips/${aliSlip.id}`, { days: dim - 3, bonus: 200_000, advanceRecovery: 500_000 })).body;
  const aliNet = Math.round((3_000_000 * (dim - 3)) / dim) + 200_000 - 500_000;
  assert.equal(edited.slips.find((s: any) => s.id === aliSlip.id).net, aliNet);
  assert.equal(edited.net, aliNet + 3_000_000);
  // recovering more than is owed is refused
  assert.equal((await call(token, 'PUT', `/payroll/${run.body.id}/slips/${aliSlip.id}`, { days: dim, advanceRecovery: 2_000_000 })).status, 422);

  // an accountant can submit but not approve; paying needs approval
  const accountant = await member(token, 'acct1@test.dev', 'accountant');
  assert.equal((await call(accountant, 'POST', `/payroll/${run.body.id}/pay`, { date: day })).status, 409);
  assert.equal((await call(accountant, 'POST', `/payroll/${run.body.id}/status`, { status: 'submitted' })).status, 200);
  assert.equal((await call(accountant, 'POST', `/payroll/${run.body.id}/status`, { status: 'approved' })).status, 403);
  const inbox = (await call(token, 'GET', '/approvals')).body;
  assert.ok(inbox.some((a: any) => a.kind === 'payroll' && a.id === run.body.id));
  assert.equal((await call(token, 'POST', `/payroll/${run.body.id}/status`, { status: 'approved' })).body.approvedByName, 'Owner');

  const beforePay = await balance(token, cash.id);
  const paid = await call(accountant, 'POST', `/payroll/${run.body.id}/pay`, { date: day, accountId: cash.id });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.status, 'paid');
  // cash drops by what people received; the cost is the full salary
  assert.equal(await balance(token, cash.id), beforePay - (aliNet + 3_000_000));
  const pnl = (await call(token, 'GET', `/reports/pnl?from=${day}&to=${day}`)).body;
  assert.equal(pnl.expenses.find((e: any) => e.label === 'Salaries').amount, aliNet + 500_000 + 3_000_000);
  assert.equal((await call(token, 'GET', `/employees/${ali.id}`)).body.advanceDue, 500_000);
  // the payroll's money out cannot be edited from Finance
  const entry = (await call(token, 'GET', '/finance/entries?type=expense')).body.find((e: any) => e.category === 'Salaries');
  assert.equal((await call(token, 'DELETE', `/finance/entries/${entry.id}`)).status, 422);
  assert.equal((await call(token, 'DELETE', `/payroll/${run.body.id}`)).status, 409);
});

test('expense claims: staff claim, someone else approves and pays, it becomes money out', async () => {
  const { token, businessId, cash } = await setup('ppl2@test.dev');
  const staff = await member(token, 'staff2@test.dev', 'staff');
  const manager = await member(token, 'mgr2@test.dev', 'manager');
  const c = await call(staff, 'POST', '/expense-claims', { businessId, date: day, category: 'Fuel & transport', amount: 250_000, description: 'Rickshaw to client site' });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.equal(c.body.number, 'EXP-0001');
  // staff see only their own claims and cannot approve
  assert.equal((await call(staff, 'GET', '/expense-claims')).body.length, 1);
  assert.equal((await call(staff, 'POST', `/expense-claims/${c.body.id}/decide`, { decision: 'approved' })).status, 403);
  // a manager cannot approve their own claim
  const own = (await call(manager, 'POST', '/expense-claims', { businessId, date: day, category: 'Supplies', amount: 1_000, description: 'Pens' })).body;
  assert.equal((await call(manager, 'POST', `/expense-claims/${own.id}/decide`, { decision: 'approved' })).status, 403);
  assert.ok((await call(manager, 'GET', '/approvals')).body.some((a: any) => a.id === c.body.id));

  const before = await balance(token, cash.id);
  const done = await call(manager, 'POST', `/expense-claims/${c.body.id}/decide`, { decision: 'approved', pay: true, accountId: cash.id });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.status, 'paid');
  assert.equal(await balance(token, cash.id), before - 250_000);
  const pnl = (await call(token, 'GET', `/reports/pnl?from=${day}&to=${day}`)).body;
  assert.equal(pnl.expenses.find((e: any) => e.label === 'Fuel & transport').amount, 250_000);
  assert.equal((await call(manager, 'POST', `/expense-claims/${c.body.id}/decide`, { decision: 'rejected' })).status, 409);
});

test('team: roles change, people can be turned off, the last owner stays', async () => {
  const { token } = await setup('ppl3@test.dev');
  const staffToken = await member(token, 'staff3@test.dev', 'staff');
  const users = (await call(token, 'GET', '/users')).body;
  const staff = users.find((u: any) => u.email === 'staff3@test.dev');
  const owner = users.find((u: any) => u.role === 'owner');
  assert.equal((await call(token, 'PUT', `/users/${staff.id}`, { role: 'accountant' })).body.role, 'accountant');
  assert.equal((await call(token, 'PUT', `/users/${owner.id}`, { role: 'manager' })).status, 409);
  assert.equal((await call(token, 'PUT', `/users/${staff.id}`, { status: 'disabled' })).body.status, 'disabled');
  // turned off: signed out and cannot sign in
  assert.equal((await call('', 'POST', '/auth/login', { email: 'staff3@test.dev', password: 'test-pass-123' })).status, 401);
  void staffToken;
});
