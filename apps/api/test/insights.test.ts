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

test('anomalies, drawer rules and the monthly report', async () => {
  const token = (await call('', 'POST', '/auth/register', { businessName: 'Kiryana', name: 'Owner', email: 'in1@test.dev', password: 'test-pass-123' })).body.accessToken as string;
  const businessId = (await call(token, 'GET', '/businesses')).body[0].id;
  const c = (await call(token, 'POST', '/clients', { name: 'Ahmed Traders' })).body;
  const inv = (await call(token, 'POST', '/invoices', { businessId, clientId: c.id, issueDate: today(), dueDate: today(), lines: [{ name: 'Goods', qty: 1000, unitPrice: 200_000 }], finalize: true })).body;
  // the same payment entered twice
  for (let i = 0; i < 2; i++) await call(token, 'POST', '/payments', { clientId: c.id, businessId, invoiceId: inv.id, amount: 50_000, date: today(), method: 'cash' });
  // a 50% discount
  await call(token, 'POST', '/invoices', { businessId, clientId: c.id, issueDate: today(), dueDate: today(), lines: [{ name: 'Goods', qty: 1000, unitPrice: 100_000 }], overallDiscountType: 'percent', overallDiscountValue: 5000, finalize: true });
  // a short drawer and a full one
  const soap = (await call(token, 'POST', '/services', { name: 'Soap', defaultPrice: 100_000 })).body;
  const s1 = (await call(token, 'POST', '/pos/shifts', { businessId, openingFloat: 0 })).body;
  await call(token, 'POST', '/pos/sales', { shiftId: s1.id, lines: [{ serviceId: soap.id, name: 'Soap', qty: 1000, unitPrice: 100_000 }], tenders: [{ tender: 'cash', amount: 100_000 }] });
  await call(token, 'POST', `/pos/shifts/${s1.id}/close`, { counted: 90_000 });

  const kinds = (await call(token, 'GET', '/insights/anomalies')).body.map((a: any) => a.kind);
  assert.ok(kinds.includes('duplicate_payment'), JSON.stringify(kinds));
  assert.ok(kinds.includes('big_discount'));
  assert.ok(kinds.includes('cash_variance'));

  const s2 = (await call(token, 'POST', '/pos/shifts', { businessId, openingFloat: 500_000 })).body;
  await call(token, 'POST', '/pos/sales', { shiftId: s2.id, lines: [{ serviceId: soap.id, name: 'Soap', qty: 1000, unitPrice: 100_000 }], tenders: [{ tender: 'cash', amount: 100_000 }] });
  await call(token, 'POST', '/rules', { kind: 'alert', name: 'Deposit', config: { trigger: 'cash_drawer_high', amount: 600_000 } });
  await call(token, 'POST', '/rules', { kind: 'alert', name: 'Short', config: { trigger: 'shift_variance', amount: 5_000 } });
  const alerts = (await call(token, 'GET', '/alerts')).body;
  assert.ok(alerts.some((a: any) => a.trigger === 'cash_drawer_high' && a.title.includes('6,000')), JSON.stringify(alerts));
  assert.ok(alerts.some((a: any) => a.trigger === 'shift_variance'));

  const rep = (await call(token, 'GET', `/insights/monthly?month=${today().slice(0, 7)}`)).body;
  assert.ok(rep.income > 0);
  assert.match(rep.text, /Kiryana/);
  assert.match(rep.text, /owe/);
  const ur = (await call(token, 'GET', `/insights/monthly?month=${today().slice(0, 7)}&lang=ur`)).body;
  assert.match(ur.text, /آمدن/);
});
