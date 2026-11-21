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
const ago = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

async function setup(email: string) {
  const r = await call('', 'POST', '/auth/register', { businessName: 'Collect Co', name: 'Owner', email, password: 'test-pass-123' });
  const token = r.body.accessToken as string;
  const businessId = (await call(token, 'GET', '/businesses')).body[0].id as string;
  const client = (await call(token, 'POST', '/clients', { name: 'Slow Payer', phone: '0300 1112223' })).body;
  return { token, businessId, client };
}
const invoice = (token: string, businessId: string, clientId: string, amount: number, due: string, extra: object = {}) =>
  call(token, 'POST', '/invoices', { businessId, clientId, issueDate: ago(40), dueDate: due, finalize: true, lines: [{ name: 'Work', qty: 1000, unitPrice: amount }], ...extra });

test('collections list who owes what, most overdue first, and remembers reminders', async () => {
  const { token, businessId, client } = await setup('col1@test.dev');
  const other = (await call(token, 'POST', '/clients', { name: 'On Time' })).body;
  const old = (await invoice(token, businessId, client.id, 1_000_000, ago(20))).body;
  await invoice(token, businessId, client.id, 500_000, ago(-5));
  await invoice(token, businessId, other.id, 200_000, ago(-10));
  const list = (await call(token, 'GET', '/collections')).body;
  assert.equal(list.length, 2);
  assert.equal(list[0].clientId, client.id);
  assert.equal(list[0].outstanding, 1_500_000);
  assert.equal(list[0].overdue, 1_000_000);
  assert.equal(list[0].daysOverdue, 20);
  assert.equal(list[1].overdue, 0);

  const rem = await call(token, 'POST', '/reminders', { clientId: client.id, invoiceId: old.id, channel: 'whatsapp', note: 'Will pay Friday', promiseDate: ago(-3) });
  assert.equal(rem.status, 201, JSON.stringify(rem.body));
  assert.equal((await call(token, 'GET', '/collections')).body[0].lastReminder.note, 'Will pay Friday');
  assert.equal((await call(token, 'GET', `/clients/${client.id}/reminders`)).body.length, 1);
});

test('the client portal shows only that client, and stops working when turned off', async () => {
  const { token, businessId, client } = await setup('col2@test.dev');
  const inv = (await invoice(token, businessId, client.id, 750_000, ago(-5))).body;
  const other = (await call(token, 'POST', '/clients', { name: 'Someone Else' })).body;
  const otherInv = (await invoice(token, businessId, other.id, 999_000, ago(-5))).body;
  const { token: key } = (await call(token, 'POST', `/clients/${client.id}/portal`)).body;
  assert.match(key, /^[0-9a-f]{40}$/);
  // the same key comes back unless renewed
  assert.equal((await call(token, 'POST', `/clients/${client.id}/portal`)).body.token, key);
  const page = await fetch(`${base}/p/${key}`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Slow Payer/);
  assert.match(html, new RegExp(inv.number));
  assert.doesNotMatch(html, /Someone Else/);
  assert.equal((await fetch(`${base}/p/${key}/invoice/${inv.id}`)).status, 200);
  // another client's invoice is not reachable through this link
  assert.equal((await fetch(`${base}/p/${key}/invoice/${otherInv.id}`)).status, 404);
  const renewed = (await call(token, 'POST', `/clients/${client.id}/portal?renew=1`)).body.token;
  assert.notEqual(renewed, key);
  assert.equal((await fetch(`${base}/p/${key}`)).status, 404);
  await call(token, 'DELETE', `/clients/${client.id}/portal`);
  assert.equal((await fetch(`${base}/p/${renewed}`)).status, 404);
});

test('a credit note lowers what is owed, restocks returns and reduces sales; cancelling undoes it', async () => {
  const { token, businessId, client } = await setup('col3@test.dev');
  const item = (await call(token, 'POST', '/services', { name: 'Fan', defaultPrice: 800_000, trackStock: true })).body;
  await call(token, 'POST', '/stock/adjust', { itemId: item.id, qty: 10_000, mode: 'opening' });
  const inv = (await call(token, 'POST', '/invoices', { businessId, clientId: client.id, issueDate: day, dueDate: day, finalize: true, lines: [{ serviceId: item.id, name: 'Fan', qty: 3000, unitPrice: 800_000 }] })).body;
  assert.equal((await call(token, 'GET', `/stock/${item.id}`)).body.item.onHand, 7000);
  // more than the unpaid balance is refused
  const tooMuch = await call(token, 'POST', '/credit-notes', { invoiceId: inv.id, date: day, reason: 'x', lines: [{ name: 'Fan', qty: 4000, unitPrice: 800_000 }] });
  assert.equal(tooMuch.status, 422);
  const cn = await call(token, 'POST', '/credit-notes', { invoiceId: inv.id, date: day, reason: 'One fan returned', restock: true, lines: [{ serviceId: item.id, name: 'Fan', qty: 1000, unitPrice: 800_000 }] });
  assert.equal(cn.status, 201, JSON.stringify(cn.body));
  assert.equal(cn.body.number, 'CN-00001');
  const after1 = (await call(token, 'GET', `/invoices/${inv.id}`)).body.invoice;
  assert.equal(after1.balance, 1_600_000);
  assert.equal(after1.credited, 800_000);
  assert.equal((await call(token, 'GET', `/clients/${client.id}`)).body.outstanding, 1_600_000);
  assert.equal((await call(token, 'GET', `/stock/${item.id}`)).body.item.onHand, 8000);
  const ledger = (await call(token, 'GET', `/clients/${client.id}/ledger`)).body;
  assert.equal(ledger.entries[ledger.entries.length - 1].balance, 1_600_000);
  const pnl = (await call(token, 'GET', `/reports/pnl?from=${day}&to=${day}`)).body;
  assert.equal(pnl.totalIncome, 1_600_000);
  // paying the rest settles the invoice
  await call(token, 'POST', '/payments', { clientId: client.id, businessId, amount: 1_600_000, date: day, method: 'cash', invoiceId: inv.id });
  assert.equal((await call(token, 'GET', `/invoices/${inv.id}`)).body.invoice.displayStatus, 'paid');
  // cancelling the note brings back the balance and takes the stock out again
  await call(token, 'POST', `/credit-notes/${cn.body.id}/cancel`);
  assert.equal((await call(token, 'GET', `/invoices/${inv.id}`)).body.invoice.balance, 800_000);
  assert.equal((await call(token, 'GET', `/stock/${item.id}`)).body.item.onHand, 7000);
});

test('debit notes are invoices numbered DN- that add to what the client owes', async () => {
  const { token, businessId, client } = await setup('col4@test.dev');
  const inv = (await invoice(token, businessId, client.id, 1_000_000, day)).body;
  const dn = await call(token, 'POST', '/invoices', { businessId, clientId: client.id, issueDate: day, dueDate: day, finalize: true, docType: 'debit_note', reference: inv.number, lines: [{ name: 'Extra freight', qty: 1000, unitPrice: 150_000 }] });
  assert.equal(dn.status, 201, JSON.stringify(dn.body));
  assert.equal(dn.body.number, 'DN-00001');
  assert.equal(dn.body.docType, 'debit_note');
  // the next normal invoice keeps its own sequence
  assert.equal((await invoice(token, businessId, client.id, 100, day)).body.number, 'INV-00002');
  assert.equal((await call(token, 'GET', `/clients/${client.id}`)).body.outstanding, 1_150_100);
  // a draft debit note keeps its type when edited without it
  const draft = (await call(token, 'POST', '/invoices', { businessId, clientId: client.id, issueDate: day, dueDate: day, docType: 'debit_note', lines: [{ name: 'X', qty: 1000, unitPrice: 100 }] })).body;
  const fin = (await call(token, 'PUT', `/invoices/${draft.id}`, { businessId, clientId: client.id, issueDate: day, dueDate: day, finalize: true, lines: [{ name: 'X', qty: 1000, unitPrice: 100 }] })).body;
  assert.equal(fin.number, 'DN-00002');
});

test('business document settings: QR mode, reminder text and Urdu documents', async () => {
  const { token, businessId } = await setup('col5@test.dev');
  const b = (await call(token, 'GET', '/businesses')).body[0];
  assert.equal(b.qrMode, 'none');
  assert.equal(b.docLanguage, 'en');
  const saved = await call(token, 'PUT', `/businesses/${businessId}`, { ...b, qrMode: 'portal', docLanguage: 'both', reminderTemplate: 'Hi {client}, {amount} due' });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.qrMode, 'portal');
  assert.equal(saved.body.docLanguage, 'both');
  assert.equal(saved.body.reminderTemplate, 'Hi {client}, {amount} due');
});
