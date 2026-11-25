import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app';
import { Db } from '../src/db';

let server: Server;
let base = '';
before(() => {
  process.env.PLATFORM_ADMINS = 'owner@site.dev';
  server = createApp(new Db(':memory:')).listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(() => server.close());

async function call(token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, body: json, text };
}

test('website: public page, content, leads; owner edits and manages leads', async () => {
  // the page is public, with its title and content filled in
  const page = await call('', 'GET', '/');
  assert.equal(page.status, 200);
  assert.match(page.text, /<title>Tijar · Every Business Move, Made Smarter<\/title>/);
  assert.doesNotMatch(page.text, /\{\{(TITLE|CONTENT|V)\}\}/);
  assert.equal((await call('', 'GET', '/site/site.css')).status, 200);
  const content = (await call('', 'GET', '/site/content')).body;
  assert.equal(content.plans.length, 4);
  assert.ok(content.features.length > 3);

  // contact form: needs a way to reach them; bots that fill the hidden field are dropped quietly
  assert.equal((await call('', 'POST', '/site/lead', { name: 'Ali' })).status, 422);
  assert.equal((await call('', 'POST', '/site/lead', { name: 'Ali', email: 'not-an-email' })).status, 422);
  assert.equal((await call('', 'POST', '/site/lead', { name: 'Bot', phone: '123', website: 'http://spam' })).status, 201);
  const lead = await call('', 'POST', '/site/lead', { name: 'Ali Khan', business: 'Khan Store', phone: '0300 1234567', plan: 'pro', message: 'Demo please' });
  assert.equal(lead.status, 201);

  const owner = (await call('', 'POST', '/auth/register', { businessName: 'Tijar', name: 'Owner', email: 'owner@site.dev', password: 'test-pass-123' })).body.accessToken;
  const other = (await call('', 'POST', '/auth/register', { businessName: 'Shop', name: 'Shopkeeper', email: 'shop@site.dev', password: 'test-pass-123' })).body.accessToken;
  assert.equal((await call(other, 'GET', '/platform/site')).status, 403);
  assert.equal((await call(other, 'GET', '/platform/site/leads')).status, 403);

  // edit the words; unsafe links are refused
  const cur = (await call(owner, 'GET', '/platform/site')).body;
  assert.equal(cur.leads, 1);
  const bad = structuredClone(cur.content);
  bad.hero.primary.href = 'javascript:alert(1)';
  assert.equal((await call(owner, 'PUT', '/platform/site', bad)).status, 422);
  const next = structuredClone(cur.content);
  next.hero.title = 'Sell <smarter>';
  next.seo.title = 'Tijar & friends';
  next.sections.pricing = false;
  next.contact.whatsapp = '0300 7654321';
  assert.equal((await call(owner, 'PUT', '/platform/site', next)).status, 200);
  const live = await call('', 'GET', '/');
  assert.match(live.text, /<title>Tijar &amp; friends<\/title>/);
  assert.ok(live.text.includes('Sell \\u003csmarter>')); // embedded JSON cannot close the script tag
  assert.ok(!live.text.includes('"Sell <smarter>'));
  assert.equal((await call('', 'GET', '/site/content')).body.sections.pricing, false);

  // leads: list, move along, delete
  const list = (await call(owner, 'GET', '/platform/site/leads')).body;
  assert.equal(list.leads.length, 1);
  assert.equal(list.leads[0].name, 'Ali Khan');
  const id = list.leads[0].id;
  assert.equal((await call(owner, 'PUT', `/platform/site/leads/${id}`, { status: 'contacted' })).status, 200);
  assert.equal((await call(owner, 'GET', '/platform/site/leads?status=contacted')).body.leads.length, 1);
  assert.equal((await call(owner, 'PUT', `/platform/site/leads/${id}`, { status: 'nope' })).status, 422);
  assert.equal((await call(owner, 'DELETE', `/platform/site/leads/${id}`)).status, 200);
  assert.equal((await call(owner, 'GET', '/platform/site/leads')).body.leads.length, 0);

  // back to the starting text
  assert.equal((await call(owner, 'POST', '/platform/site/reset', {})).body.seo.title, 'Tijar · Every Business Move, Made Smarter');
});

test('trial length is set by the SaaS owner and used for new accounts and on the website', async () => {
  const owner = (await call('', 'POST', '/auth/login', { email: 'owner@site.dev', password: 'test-pass-123' })).body.accessToken;
  const other = (await call('', 'POST', '/auth/login', { email: 'shop@site.dev', password: 'test-pass-123' })).body.accessToken;
  assert.equal((await call(owner, 'GET', '/platform/trial')).body.days, 30);
  assert.equal((await call(other, 'PUT', '/platform/trial', { days: 5 })).status, 403);
  assert.equal((await call(owner, 'PUT', '/platform/trial', { days: 400 })).status, 422);
  assert.equal((await call(owner, 'PUT', '/platform/trial', { days: 14 })).body.days, 14);
  assert.equal((await call('', 'GET', '/auth/channels')).body.trialDays, 14);
  const site = (await call('', 'GET', '/site/content')).body;
  assert.equal(site.trialDays, 14);
  assert.match(site.announcement.text, /14 days/);
  const reg14 = await call('', 'POST', '/auth/register', { businessName: 'Trial Co', name: 'Trial Owner', email: 't14@site.dev', password: 'test-pass-123' });
  assert.equal(reg14.status, 201, JSON.stringify(reg14.body));
  const t14 = reg14.body.accessToken;
  const plan14 = (await call(t14, 'GET', '/plan')).body;
  assert.equal(plan14.plan, 'pro');
  assert.ok(plan14.daysLeft >= 14 && plan14.daysLeft <= 15, String(plan14.daysLeft));
  // no trial: new accounts start on Free
  await call(owner, 'PUT', '/platform/trial', { days: 0 });
  const t0 = (await call('', 'POST', '/auth/register', { businessName: 'Free Co', name: 'Free Owner', email: 'f0@site.dev', password: 'test-pass-123' })).body.accessToken;
  assert.equal((await call(t0, 'GET', '/plan')).body.plan, 'free');
  await call(owner, 'PUT', '/platform/trial', { days: 30 });
});
