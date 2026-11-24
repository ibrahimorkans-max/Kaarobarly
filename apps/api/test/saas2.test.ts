import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createHmac } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app';
import { today } from '../src/core';
import { Db } from '../src/db';

let server: Server;
let base = '';
let sink: Server;
let sinkUrl = '';
const received: { body: string; sig: string }[] = [];

before(async () => {
  server = createApp(new Db(':memory:')).listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  sink = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ body, sig: String(req.headers['x-kaarobarly-signature'] ?? '') });
      res.end('ok');
    });
  }).listen(0);
  sinkUrl = `http://localhost:${(sink.address() as any).port}/hook`;
});
after(() => {
  server.close();
  sink.close();
});

async function call(token: string, method: string, path: string, body?: unknown, apiKey?: string) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(apiKey ? { 'x-api-key': apiKey } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as any };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('API keys act with their role; webhooks are signed and follow chosen events', async () => {
  const token = (await call('', 'POST', '/auth/register', { businessName: 'Api Co', name: 'Owner', email: 'sa1@test.dev', password: 'test-pass-123' })).body.accessToken as string;
  const businessId = (await call(token, 'GET', '/businesses')).body[0].id;
  const k = await call(token, 'POST', '/developer/keys', { name: 'Website', role: 'accountant' });
  assert.equal(k.status, 201, JSON.stringify(k.body));
  assert.match(k.body.key, /^kb_live_/);
  assert.equal((await call(token, 'GET', '/developer/keys')).body[0].key, undefined, 'the full key is shown once');

  assert.equal((await call('', 'GET', '/clients', undefined, k.body.key)).status, 200);
  assert.equal((await call('', 'GET', '/users', undefined, k.body.key)).status, 403);
  assert.equal((await call('', 'GET', '/clients', undefined, 'kb_live_wrong')).status, 401);

  const hook = await call(token, 'POST', '/developer/webhooks', { url: sinkUrl, events: ['invoice.finalize'] });
  assert.equal(hook.status, 201, JSON.stringify(hook.body));
  const c = (await call('', 'POST', '/clients', { name: 'From API' }, k.body.key)).body;
  const inv = await call('', 'POST', '/invoices', { businessId, clientId: c.id, issueDate: today(), dueDate: today(), lines: [{ name: 'Item', qty: 1000, unitPrice: 5_000 }], finalize: true }, k.body.key);
  assert.equal(inv.status, 201, JSON.stringify(inv.body));
  await wait(400);
  assert.equal(received.length, 1);
  const payload = JSON.parse(received[0].body);
  assert.equal(payload.event, 'invoice.finalize');
  assert.equal(received[0].sig, `sha256=${createHmac('sha256', hook.body.secret).update(received[0].body).digest('hex')}`);
  // a client added is not a followed event
  await call(token, 'POST', '/clients', { name: 'No hook' });
  await wait(200);
  assert.equal(received.length, 1);

  await call(token, 'DELETE', `/developer/keys/${k.body.id}`);
  assert.equal((await call('', 'GET', '/clients', undefined, k.body.key)).status, 401);
});

test('sample data fills an empty business only', async () => {
  const token = (await call('', 'POST', '/auth/register', { businessName: 'New Cafe', name: 'Owner', email: 'sa2@test.dev', password: 'test-pass-123' })).body.accessToken as string;
  const r = await call(token, 'POST', '/workspace/sample-data', { type: 'restaurant' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok((await call(token, 'GET', '/services')).body.some((s: any) => s.name.includes('Karahi')));
  assert.equal((await call(token, 'POST', '/workspace/sample-data', { type: 'restaurant' })).status, 409);
});
