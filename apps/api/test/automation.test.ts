import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import { createApp } from '../src/app';
import { Db } from '../src/db';
import { businessBrief } from '../src/ai';

let server: Server;
let base = '';
const db = new Db(':memory:');
const savedKey = process.env.ANTHROPIC_API_KEY;

before(() => {
  delete process.env.ANTHROPIC_API_KEY; // these tests never call a real AI service
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(() => {
  server.close();
  if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;
});

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
  const r = await call('', 'POST', '/auth/register', { businessName: 'Auto Co', name: 'Owner', email, password: 'test-pass-123' });
  const token = r.body.accessToken as string;
  const businessId = (await call(token, 'GET', '/businesses')).body[0].id as string;
  return { token, businessId, tenantId: r.body.user.tenantId as string };
}

test('AI is set up once by the SaaS owner; customers cannot see or change it', async () => {
  process.env.PLATFORM_ADMINS = 'owner-of-saas@test.dev';
  const { token } = await setup('ai1@test.dev');
  // a customer only learns whether AI can be used
  const status = (await call(token, 'GET', '/ai/status')).body;
  assert.equal(status.available, false);
  assert.equal(JSON.stringify(status).includes('provider'), false);
  const notReady = await call(token, 'POST', '/ai/ask', { question: 'How is business?' });
  assert.equal(notReady.status, 503);
  assert.match(notReady.body.error, /not available right now/);
  assert.doesNotMatch(notReady.body.error, /settings|key/i);
  // the old per-account settings are gone, and the platform ones are refused
  assert.equal((await call(token, 'PUT', '/ai/config', { provider: 'anthropic', apiKey: 'x' })).status, 404);
  assert.equal((await call(token, 'GET', '/platform/ai')).status, 403);
  assert.equal((await call(token, 'PUT', '/platform/ai', { provider: 'anthropic', apiKey: 'sk-ant-x' })).status, 403);
  assert.equal((await call(token, 'GET', '/platform/overview')).status, 403);

  const admin = await setup('owner-of-saas@test.dev');
  assert.equal((await call(admin.token, 'PUT', '/platform/ai', { provider: 'openrouter', apiKey: 'sk-or-test-12345678' })).status, 422);
  const saved = (await call(admin.token, 'PUT', '/platform/ai', { provider: 'anthropic', apiKey: 'sk-ant-test-abcd1234' })).body;
  assert.equal(saved.hasKey, true);
  assert.equal(saved.keyHint, '…1234');
  assert.equal(saved.model, 'claude-opus-5-5');
  assert.equal(saved.updatedBy, 'owner-of-saas@test.dev');
  assert.equal(JSON.stringify(saved).includes('sk-ant-test'), false);
  // saving again without a key keeps it
  assert.equal((await call(admin.token, 'PUT', '/platform/ai', { provider: 'anthropic', model: 'claude-sonnet-5-5' })).body.keyHint, '…1234');
  // one setup serves every account; the key never reaches phones
  assert.equal((await call(token, 'GET', '/ai/status')).body.available, true);
  assert.equal(JSON.stringify((await call(token, 'GET', '/sync/pull')).body).includes('sk-ant-test'), false);
  const overview = (await call(admin.token, 'GET', '/platform/overview')).body;
  assert.ok(overview.accounts >= 2);
  assert.equal(overview.ai.ready, true);
});

test('the assistant works from a plain summary of the real figures', async () => {
  const { token, businessId, tenantId } = await setup('ai2@test.dev');
  const client = (await call(token, 'POST', '/clients', { name: 'Big Buyer' })).body;
  await call(token, 'POST', '/invoices', { businessId, clientId: client.id, issueDate: ago(40), dueDate: ago(20), finalize: true, lines: [{ name: 'Work', qty: 1000, unitPrice: 1_234_500 }] });
  const brief = businessBrief(db, tenantId);
  assert.match(brief, /Business: Auto Co/);
  assert.match(brief, /Big Buyer Rs\.? ?12,345/);
  assert.match(brief, /20 days late/);
});

test('categorize rules file "Other" money out by its words, never overriding a chosen category', async () => {
  const { token, businessId } = await setup('rules1@test.dev');
  await call(token, 'POST', '/rules', { kind: 'categorize', name: 'Petrol', config: { type: 'expense', match: 'petrol', category: 'Fuel & transport' } });
  const e1 = (await call(token, 'POST', '/finance/entries', { businessId, type: 'expense', category: 'Other expense', amount: 500_000, date: day, method: 'cash', party: 'PSO', notes: 'Petrol for van' })).body;
  assert.equal(e1.category, 'Fuel & transport');
  const e2 = (await call(token, 'POST', '/finance/entries', { businessId, type: 'expense', category: 'Maintenance', amount: 500_000, date: day, method: 'cash', notes: 'petrol pump repair' })).body;
  assert.equal(e2.category, 'Maintenance');
  // income rules do not touch expenses
  await call(token, 'POST', '/rules', { kind: 'categorize', config: { type: 'income', match: 'van', category: 'Other income' } });
  assert.equal((await call(token, 'GET', '/rules')).body.length, 2);
});

test('alerts follow their rules, can be dismissed, and come back when something changes', async () => {
  const { token, businessId } = await setup('rules2@test.dev');
  for (const r of (await call(token, 'GET', '/rules/suggested')).body) await call(token, 'POST', '/rules', r);
  const client = (await call(token, 'POST', '/clients', { name: 'Late Payer' })).body;
  const inv = (await call(token, 'POST', '/invoices', { businessId, clientId: client.id, issueDate: ago(30), dueDate: ago(10), finalize: true, lines: [{ name: 'Work', qty: 1000, unitPrice: 1_000_000 }] })).body;
  await call(token, 'POST', '/invoices', { businessId, clientId: client.id, issueDate: ago(5), dueDate: ago(3), finalize: true, lines: [{ name: 'Small', qty: 1000, unitPrice: 100 }] });
  const item = (await call(token, 'POST', '/services', { name: 'Rice bag', trackStock: true, reorderLevel: 5_000 })).body;
  await call(token, 'POST', '/stock/adjust', { itemId: item.id, qty: 2_000, mode: 'opening' });
  let list = (await call(token, 'GET', '/alerts')).body;
  // only the invoice at least 7 days late
  assert.equal(list.filter((a: any) => a.trigger === 'invoice_overdue').length, 1);
  assert.match(list.find((a: any) => a.trigger === 'invoice_overdue').title, /Late Payer is 10 days late/);
  assert.ok(list.some((a: any) => a.trigger === 'stock_low' && a.refId === item.id));
  const overdue = list.find((a: any) => a.refId === inv.id);
  await call(token, 'POST', '/alerts/dismiss', { key: overdue.key });
  list = (await call(token, 'GET', '/alerts')).body;
  assert.equal(list.some((a: any) => a.refId === inv.id), false);
  // a part payment changes the situation, so the alert returns
  await call(token, 'POST', '/payments', { clientId: client.id, businessId, amount: 100_000, date: day, method: 'cash', invoiceId: inv.id });
  assert.ok((await call(token, 'GET', '/alerts')).body.some((a: any) => a.refId === inv.id));
  // switching the rule off removes its alerts
  const rule = (await call(token, 'GET', '/rules')).body.find((r: any) => r.config.trigger === 'stock_low');
  await call(token, 'PUT', `/rules/${rule.id}`, { kind: 'alert', name: rule.name, enabled: false, config: rule.config });
  assert.equal((await call(token, 'GET', '/alerts')).body.some((a: any) => a.trigger === 'stock_low'), false);
});
