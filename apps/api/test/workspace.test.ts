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

async function register(email: string) {
  const r = await call('', 'POST', '/auth/register', { businessName: 'Any Biz', name: 'Owner', email, password: 'test-pass-123' });
  return r.body.accessToken as string;
}

test('a new account starts unconfigured with every module on', async () => {
  const token = await register('ws1@test.dev');
  const ws = (await call(token, 'GET', '/workspace')).body;
  assert.equal(ws.configured, false);
  assert.equal(ws.modules.inventory, true);
  assert.equal(ws.terms.client, 'Client');
});

test('a clinic preset renames things, switches modules and adds patient fields', async () => {
  const token = await register('ws2@test.dev');
  const ws = (await call(token, 'POST', '/workspace/preset', { businessType: 'clinic' })).body;
  assert.equal(ws.configured, true);
  assert.equal(ws.businessType, 'clinic');
  assert.equal(ws.terms.client, 'Patient');
  assert.equal(ws.terms.invoices, 'Bills');
  assert.equal(ws.modules.quotations, false);
  assert.equal(ws.modules.invoices, true);
  assert.ok(ws.customFields.some((f: any) => f.entity === 'client' && f.label === 'MR number'));
  // it is stored and comes back with the synced tenant row
  const pulled = (await call(token, 'GET', '/sync/pull')).body;
  assert.equal(JSON.parse(pulled.tables.tenant[0].settings).businessType, 'clinic');
});

test('owners edit wording, modules and fields; invoices and payments cannot be switched off', async () => {
  const token = await register('ws3@test.dev');
  const r = await call(token, 'PUT', '/workspace', {
    businessType: 'retail',
    modules: { invoices: false, quotations: false, inventory: true },
    terms: { client: 'Buyer', clients: 'Buyers' },
    customFields: [{ id: 'colour', entity: 'item', label: 'Colour', type: 'select', options: ['Red', 'Blue'] }],
    itemTypes: ['Product'],
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.modules.invoices, true);
  assert.equal(r.body.modules.quotations, false);
  assert.equal(r.body.terms.client, 'Buyer');
  assert.equal(r.body.terms.invoice, 'Invoice');
  // a choice list without choices is refused
  const bad = await call(token, 'PUT', '/workspace', { ...r.body, customFields: [{ id: 'x', entity: 'item', label: 'X', type: 'select', options: [] }] });
  assert.equal(bad.status, 422);
});

test('custom values are checked, stored and returned on clients, items, invoices and quotations', async () => {
  const token = await register('ws4@test.dev');
  await call(token, 'PUT', '/workspace', {
    businessType: 'clinic',
    modules: {},
    customFields: [
      { id: 'mr', entity: 'client', label: 'MR number', type: 'text', required: true },
      { id: 'dob', entity: 'client', label: 'Date of birth', type: 'date' },
      { id: 'grade', entity: 'item', label: 'Grade', type: 'select', options: ['A', 'B'] },
      { id: 'doctor', entity: 'invoice', label: 'Doctor', type: 'text', required: true, showOnPdf: true },
    ],
    itemTypes: ['Consultation', 'Test'],
  });
  // required client field
  const missing = await call(token, 'POST', '/clients', { name: 'Ayesha' });
  assert.equal(missing.status, 422);
  assert.match(missing.body.error, /MR number is required/);
  const badDate = await call(token, 'POST', '/clients', { name: 'Ayesha', custom: { mr: 'MR-1', dob: '12/01/1990' } });
  assert.equal(badDate.status, 422);
  const c = await call(token, 'POST', '/clients', { name: 'Ayesha', custom: { mr: 'MR-1', dob: '1990-01-12', unknown: 'dropped' } });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.deepEqual(c.body.custom, { mr: 'MR-1', dob: '1990-01-12' });

  const s = await call(token, 'POST', '/services', { name: 'Blood test', defaultPrice: 150_000, itemType: 'Test', custom: { grade: 'A' } });
  assert.equal(s.status, 201, JSON.stringify(s.body));
  assert.equal(s.body.itemType, 'Test');
  assert.deepEqual(s.body.custom, { grade: 'A' });
  assert.equal((await call(token, 'POST', '/services', { name: 'X', custom: { grade: 'C' } })).status, 422);

  const businessId = (await call(token, 'GET', '/businesses')).body[0].id;
  const line = { name: 'Blood test', qty: 1000, unitPrice: 150_000 };
  const draftBody = { businessId, clientId: c.body.id, issueDate: day, dueDate: day, lines: [line], custom: {} };
  // a draft may leave a required field empty; finalizing may not
  const draft = await call(token, 'POST', '/invoices', draftBody);
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  const fin = await call(token, 'POST', `/invoices/${draft.body.id}/finalize`, {});
  assert.equal(fin.status, 422);
  assert.match(fin.body.error, /Doctor is required/);
  const final = await call(token, 'POST', '/invoices', { ...draftBody, finalize: true, custom: { doctor: 'Dr. Sana' } });
  assert.equal(final.status, 201, JSON.stringify(final.body));
  assert.deepEqual(final.body.custom, { doctor: 'Dr. Sana' });

  // quotations keep their values and pass them on to the invoice
  const qt = await call(token, 'POST', '/quotations', { businessId, clientId: c.body.id, issueDate: day, validUntil: day, lines: [line], custom: { doctor: 'Dr. Ali' } });
  assert.equal(qt.status, 201, JSON.stringify(qt.body));
  assert.deepEqual(qt.body.custom, { doctor: 'Dr. Ali' });
  await call(token, 'POST', `/quotations/${qt.body.id}/status`, { status: 'sent' });
  const conv = await call(token, 'POST', `/quotations/${qt.body.id}/convert`, {});
  const inv = (await call(token, 'GET', `/invoices/${conv.body.invoiceId}`)).body.invoice;
  assert.deepEqual(inv.custom, { doctor: 'Dr. Ali' });
});

test('only owners can change the workspace', async () => {
  const token = await register('ws5@test.dev');
  await call(token, 'POST', '/users', { name: 'Staff One', email: 'staff5@test.dev', password: 'test-pass-123', role: 'staff' });
  const staff = (await call('', 'POST', '/auth/login', { email: 'staff5@test.dev', password: 'test-pass-123' })).body.accessToken;
  assert.equal((await call(staff, 'GET', '/workspace')).status, 200);
  assert.equal((await call(staff, 'POST', '/workspace/preset', { businessType: 'retail' })).status, 403);
});
