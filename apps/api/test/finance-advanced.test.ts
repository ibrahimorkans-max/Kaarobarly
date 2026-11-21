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
const plus = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function setup(email: string) {
  const r = await call('', 'POST', '/auth/register', { businessName: 'Money Co', name: 'Owner', email, password: 'test-pass-123' });
  const token = r.body.accessToken as string;
  const businessId = (await call(token, 'GET', '/businesses')).body[0].id as string;
  const accounts = (await call(token, 'GET', '/accounts')).body;
  return { token, businessId, cash: accounts.find((a: any) => a.type === 'cash'), bank: accounts.find((a: any) => a.type === 'bank') };
}
const balance = async (token: string, id: string) => (await call(token, 'GET', `/accounts/${id}`)).body.balance as number;

test('a received cheque that clears becomes a payment; a bounce cancels it', async () => {
  const { token, businessId, bank } = await setup('adv1@test.dev');
  const client = (await call(token, 'POST', '/clients', { name: 'Rice Mill' })).body;
  const inv = (await call(token, 'POST', '/invoices', { businessId, clientId: client.id, issueDate: day, dueDate: day, finalize: true, lines: [{ name: 'Work', qty: 1000, unitPrice: 5_000_000 }] })).body;
  const ch = await call(token, 'POST', '/cheques', { businessId, direction: 'in', number: '000123', bank: 'HBL', clientId: client.id, amount: 5_000_000, chequeDate: plus(10), accountId: bank.id });
  assert.equal(ch.status, 201, JSON.stringify(ch.body));
  assert.equal(ch.body.party, 'Rice Mill');
  assert.equal(ch.body.status, 'pending');
  // a post-dated cheque shows on the calendar and in the forecast as money coming in
  const cal = (await call(token, 'GET', `/calendar?from=${day}&to=${plus(30)}`)).body;
  assert.ok(cal.some((e: any) => e.kind === 'cheque_in' && e.amount === 5_000_000));
  assert.ok(cal.some((e: any) => e.kind === 'invoice' && e.refId === inv.id));

  const before = await balance(token, bank.id);
  const cleared = await call(token, 'POST', `/cheques/${ch.body.id}/status`, { status: 'cleared' });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  assert.ok(cleared.body.paymentId);
  assert.equal(await balance(token, bank.id), before + 5_000_000);
  assert.equal((await call(token, 'GET', `/invoices/${inv.id}`)).body.invoice.displayStatus, 'paid');
  // cleared cannot be undone into bounced directly
  assert.equal((await call(token, 'POST', `/cheques/${ch.body.id}/status`, { status: 'bounced' })).status, 409);

  // a cheque recorded with its payment: bouncing it rejects the payment
  const pay = (await call(token, 'POST', '/payments', { clientId: client.id, businessId, amount: 100_000, date: day, method: 'cheque', accountId: bank.id })).body;
  const ch2 = (await call(token, 'POST', '/cheques', { businessId, direction: 'in', number: '777', clientId: client.id, amount: 100_000, chequeDate: day, paymentId: pay.id })).body;
  await call(token, 'POST', `/cheques/${ch2.id}/status`, { status: 'deposited' });
  await call(token, 'POST', `/cheques/${ch2.id}/status`, { status: 'bounced' });
  assert.equal((await call(token, 'GET', `/payments/${pay.id}`)).body.payment.verificationStatus, 'rejected');
});

test('loans move money without being income, interest is a cost, repayments close the loan', async () => {
  const { token, businessId, bank } = await setup('adv2@test.dev');
  const start = await balance(token, bank.id);
  const loan = await call(token, 'POST', '/loans', { businessId, direction: 'borrowed', party: 'Meezan Bank', principal: 10_000_000, rateBp: 1500, startDate: day, installmentAmount: 2_500_000, accountId: bank.id });
  assert.equal(loan.status, 201, JSON.stringify(loan.body));
  assert.equal(loan.body.outstanding, 10_000_000);
  assert.ok(loan.body.nextDue);
  assert.equal(await balance(token, bank.id), start + 10_000_000);
  // not income in profit & loss
  assert.equal((await call(token, 'GET', `/reports/pnl?from=${day}&to=${day}`)).body.totalIncome, 0);
  // a liability on the balance sheet
  const bs = (await call(token, 'GET', '/reports/balance-sheet')).body;
  assert.equal(bs.liabilities.find((l: any) => l.label === 'Loans taken').amount, 10_000_000);
  // four repayments due on the calendar
  assert.equal((await call(token, 'GET', `/calendar?from=${day}&to=${plus(130)}`)).body.filter((e: any) => e.kind === 'loan').length, 4);

  await call(token, 'POST', `/loans/${loan.body.id}/txns`, { kind: 'interest', amount: 125_000, date: day, accountId: bank.id });
  const pnl = (await call(token, 'GET', `/reports/pnl?from=${day}&to=${day}`)).body;
  assert.equal(pnl.expenses.find((e: any) => e.label === 'Loan interest').amount, 125_000);
  assert.equal((await call(token, 'POST', `/loans/${loan.body.id}/txns`, { kind: 'repayment', amount: 20_000_000, date: day, accountId: bank.id })).status, 422);
  const done = await call(token, 'POST', `/loans/${loan.body.id}/txns`, { kind: 'repayment', amount: 10_000_000, date: day, accountId: bank.id });
  assert.equal(done.body.status, 'closed');
  assert.equal(await balance(token, bank.id), start - 125_000);
});

test('budgets compare spending with the plan; a default budget covers months without their own', async () => {
  const { token, businessId } = await setup('adv3@test.dev');
  const month = day.slice(0, 7);
  await call(token, 'PUT', '/budgets', { businessId, month: 'default', lines: [{ category: 'Rent', amount: 5_000_000 }, { category: 'Fuel & transport', amount: 1_000_000 }] });
  await call(token, 'POST', '/finance/entries', { businessId, type: 'expense', category: 'Fuel & transport', amount: 1_200_000, date: day, method: 'cash' });
  await call(token, 'POST', '/finance/entries', { businessId, type: 'expense', category: 'Marketing', amount: 300_000, date: day, method: 'cash' });
  const r = (await call(token, 'GET', `/budgets?month=${month}`)).body;
  const fuel = r.lines.find((l: any) => l.category === 'Fuel & transport');
  assert.equal(fuel.actual, 1_200_000);
  assert.equal(fuel.remaining, -200_000);
  assert.equal(fuel.usedBp, 12_000);
  assert.equal(r.totalBudget, 6_000_000);
  assert.deepEqual(r.unbudgeted, [{ category: 'Marketing', actual: 300_000 }]);
  // a month-specific budget replaces the default for that month
  const own = (await call(token, 'PUT', '/budgets', { businessId, month, lines: [{ category: 'Rent', amount: 4_000_000 }] })).body;
  assert.equal(own.totalBudget, 4_000_000);
});

test('day close records a shortage, locks the day, and only the latest day reopens', async () => {
  const { token, businessId, cash } = await setup('adv4@test.dev');
  const yesterday = plus(-1);
  await call(token, 'POST', '/finance/entries', { businessId, type: 'income', category: 'Sales', amount: 1_000_000, date: yesterday, method: 'cash', accountId: cash.id });
  const exp = (await call(token, 'GET', `/day-close/expected?date=${yesterday}`)).body;
  assert.equal(exp.expected, 1_000_000);
  const close = await call(token, 'POST', '/day-close', { businessId, accountId: cash.id, date: yesterday, counted: 990_000, notes: 'drawer' });
  assert.equal(close.status, 201, JSON.stringify(close.body));
  assert.equal(close.body.difference, -10_000);
  assert.equal(await balance(token, cash.id), 990_000);
  // the closed day is locked for money records
  const late = await call(token, 'POST', '/finance/entries', { businessId, type: 'expense', category: 'Rent', amount: 100, date: yesterday, method: 'cash' });
  assert.equal(late.status, 409);
  assert.match(late.body.error, /closed/);
  assert.equal((await call(token, 'POST', '/finance/entries', { businessId, type: 'expense', category: 'Rent', amount: 100, date: day, method: 'cash' })).status, 201);
  assert.equal((await call(token, 'POST', '/day-close', { businessId, accountId: cash.id, date: yesterday, counted: 0 })).status, 409);
  // close today too, then reopening yesterday first is refused
  const today2 = await call(token, 'POST', '/day-close', { businessId, accountId: cash.id, date: day, counted: 989_900 });
  assert.equal(today2.body.difference, 0);
  assert.equal((await call(token, 'DELETE', `/day-close/${close.body.id}`)).status, 409);
  assert.equal((await call(token, 'DELETE', `/day-close/${today2.body.id}`)).status, 200);
  assert.equal((await call(token, 'DELETE', `/day-close/${close.body.id}`)).status, 200);
  assert.equal(await balance(token, cash.id), 999_900);
});

test('forecast starts from cash in hand and adds what is due', async () => {
  const { token, businessId, cash } = await setup('adv5@test.dev');
  await call(token, 'POST', '/finance/entries', { businessId, type: 'income', category: 'Owner investment', amount: 2_000_000, date: day, method: 'cash', accountId: cash.id });
  const client = (await call(token, 'POST', '/clients', { name: 'Shop' })).body;
  await call(token, 'POST', '/invoices', { businessId, clientId: client.id, issueDate: day, dueDate: plus(3), finalize: true, lines: [{ name: 'Goods', qty: 1000, unitPrice: 500_000 }] });
  await call(token, 'POST', '/purchases', { businessId, supplier: 'Mill', date: day, method: 'cash', lines: [{ name: 'Paddy', qty: 1000, unitPrice: 300_000 }], installments: [{ dueDate: plus(10), amount: 300_000 }] });
  const f = (await call(token, 'GET', '/forecast?days=28')).body;
  assert.equal(f.opening, 2_000_000);
  assert.equal(f.weeks.length, 4);
  assert.equal(f.weeks[0].moneyIn, 500_000);
  assert.equal(f.weeks[1].moneyOut, 300_000);
  assert.equal(f.weeks[3].closing, 2_200_000);
});
