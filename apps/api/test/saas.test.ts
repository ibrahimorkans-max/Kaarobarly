import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import { createApp } from '../src/app';
import { Db } from '../src/db';

let server: Server;
let base = '';
const db = new Db(':memory:');

before(() => {
  process.env.PLATFORM_ADMINS = 'admin@kaarobarly.test';
  delete process.env.ANTHROPIC_API_KEY;
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(() => server.close());

async function call(token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as any, headers: res.headers };
}

const day = new Date().toISOString().slice(0, 10);
const register = async (email: string, name = 'Plan Co') => {
  const r = await call('', 'POST', '/auth/register', { businessName: name, name: 'Owner', email, password: 'test-pass-123' });
  return { token: r.body.accessToken as string, tenantId: r.body.user.tenantId as string, user: r.body.user };
};

test('new accounts get a 30-day Pro trial; when it ends they fall back to Free limits', async () => {
  const { token, tenantId } = await register('plan1@test.dev');
  const p = (await call(token, 'GET', '/plan')).body;
  assert.equal(p.chosen, 'trial');
  assert.equal(p.plan, 'pro');
  assert.ok(p.daysLeft >= 29 && p.daysLeft <= 31);
  assert.equal(p.limits.users, 10);
  // end the trial
  db.run("update tenant set trial_ends_at = '2000-01-01' where id = ?", tenantId);
  const free = (await call(token, 'GET', '/plan')).body;
  assert.equal(free.plan, 'free');
  // Free: one person, one business, no payroll, no AI
  const u = await call(token, 'POST', '/users', { name: 'Helper', email: 'help1@test.dev', password: 'test-pass-123', role: 'staff' });
  assert.equal(u.status, 402);
  assert.match(u.body.error, /1 person/);
  assert.equal((await call(token, 'POST', '/businesses', { legalName: 'Second Shop' })).status, 402);
  assert.equal((await call(token, 'POST', '/payroll', { businessId: (await call(token, 'GET', '/businesses')).body[0].id, month: day.slice(0, 7) })).status, 402);
  const aiRes = await call(token, 'POST', '/ai/ask', { question: 'How are we doing?' });
  assert.equal(aiRes.status, 402);
  assert.match(aiRes.body.error, /not included in the Free plan/);
});

test('the monthly invoice allowance counts finalized invoices; drafts are always allowed', async () => {
  const { token, tenantId } = await register('plan2@test.dev');
  db.run("update tenant set plan = 'free', trial_ends_at = null where id = ?", tenantId);
  const businessId = (await call(token, 'GET', '/businesses')).body[0].id;
  const client = (await call(token, 'POST', '/clients', { name: 'C' })).body;
  const inv = { businessId, clientId: client.id, issueDate: day, dueDate: day, lines: [{ name: 'X', qty: 1000, unitPrice: 100 }] };
  for (let i = 0; i < 30; i++) assert.equal((await call(token, 'POST', '/invoices', { ...inv, finalize: true })).status, 201);
  const over = await call(token, 'POST', '/invoices', { ...inv, finalize: true });
  assert.equal(over.status, 402);
  assert.match(over.body.error, /30 invoices a month/);
  const draft = await call(token, 'POST', '/invoices', inv);
  assert.equal(draft.status, 201);
  assert.equal((await call(token, 'POST', `/invoices/${draft.body.id}/finalize`, {})).status, 402);
  assert.equal((await call(token, 'GET', '/plan')).body.usage.invoicesThisMonth, 30);
});

test('upgrade requests reach the platform admin, who sets the plan; others cannot see accounts', async () => {
  const { token, tenantId } = await register('plan3@test.dev', 'Wants Pro');
  db.run("update tenant set plan = 'free', trial_ends_at = null where id = ?", tenantId);
  const req = await call(token, 'POST', '/plan/request', { plan: 'pro', phone: '0300 1234567', note: 'Need payroll' });
  assert.equal(req.status, 201, JSON.stringify(req.body));
  assert.equal((await call(token, 'GET', '/plan')).body.request.plan, 'pro');
  assert.equal((await call(token, 'GET', '/platform/tenants')).status, 403);

  const admin = await register('admin@kaarobarly.test', 'Kaarobarly HQ');
  assert.equal(admin.user.isPlatformAdmin, true);
  const tenants = (await call(admin.token, 'GET', '/platform/tenants')).body;
  const row = tenants.find((t: any) => t.id === tenantId);
  assert.equal(row.ownerEmail, 'plan3@test.dev');
  assert.equal(row.request.plan, 'pro');
  // a paid plan needs a paid-until date
  assert.equal((await call(admin.token, 'PUT', `/platform/tenants/${tenantId}/plan`, { plan: 'pro' })).status, 422);
  const nextYear = `${Number(day.slice(0, 4)) + 1}${day.slice(4)}`;
  const set = await call(admin.token, 'PUT', `/platform/tenants/${tenantId}/plan`, { plan: 'pro', paidUntil: nextYear });
  assert.equal(set.body.plan, 'pro');
  assert.equal((await call(token, 'GET', '/plan')).body.request, null);
  assert.equal((await call(token, 'POST', '/users', { name: 'Helper', email: 'help3@test.dev', password: 'test-pass-123', role: 'staff' })).status, 201);
});

test('accounts from before plans keep Business limits; responses carry security headers', async () => {
  const { token, tenantId } = await register('plan4@test.dev');
  db.run("update tenant set plan = 'legacy' where id = ?", tenantId);
  const p = await call(token, 'GET', '/plan');
  assert.equal(p.body.plan, 'business');
  assert.equal(p.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(p.headers.get('x-powered-by'), null);
});

test('repeated sign-in attempts from one connection are slowed down', async () => {
  let last = 0;
  for (let i = 0; i < 35; i++) last = (await call('', 'POST', '/auth/login', { email: `nobody${i}@test.dev`, password: 'wrong-pass' })).status;
  assert.equal(last, 429);
});
