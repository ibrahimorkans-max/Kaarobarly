import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app';
import { today } from '../src/core';
import { Db } from '../src/db';

let server: Server;
let base = '';
let google: Server;
let googleUrl = '';
const sent: any[] = [];
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
let jwtOk = false;

before(async () => {
  // stands in for Google: the token exchange and FCM's send endpoint
  google = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.url === '/token') {
        const jwt = new URLSearchParams(body).get('assertion')!.split('.');
        jwtOk = createVerify('RSA-SHA256').update(`${jwt[0]}.${jwt[1]}`).verify(publicKey, jwt[2], 'base64url');
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }));
      }
      const m = JSON.parse(body).message;
      if (m.token === 'dead-token-1234567890') {
        res.statusCode = 404;
        return res.end('{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}');
      }
      sent.push({ auth: req.headers.authorization, url: req.url, message: m });
      res.end('{}');
    });
  }).listen(0);
  googleUrl = `http://127.0.0.1:${(google.address() as any).port}`;
  process.env.FCM_BASE_URL = googleUrl;
  process.env.PLATFORM_ADMINS = 'admin@push.dev';
  server = createApp(new Db(':memory:')).listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(() => {
  server.close();
  google.close();
});

async function call(token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: (await res.json()) as any };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('push: platform key, device tokens, event notifications, settings, dead tokens', async () => {
  const admin = (await call('', 'POST', '/auth/register', { businessName: 'Platform', name: 'Admin', email: 'admin@push.dev', password: 'test-pass-123' })).body.accessToken;
  const sa = { type: 'service_account', project_id: 'kb-test', client_email: 'push@kb-test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: `${googleUrl}/token` };
  assert.equal((await call(admin, 'PUT', '/platform/push', { serviceAccount: '{"nope":1}' })).status, 422);
  const st = await call(admin, 'PUT', '/platform/push', { serviceAccount: JSON.stringify(sa) });
  assert.equal(st.status, 200, JSON.stringify(st.body));
  assert.equal(st.body.ready, true);

  const owner = (await call('', 'POST', '/auth/register', { businessName: 'Shop', name: 'Owner', email: 'po@push.dev', password: 'test-pass-123' })).body.accessToken;
  const businessId = (await call(owner, 'GET', '/businesses')).body[0].id;
  assert.equal((await call(owner, 'POST', '/push/register', { token: 'device-token-abcdefghijklmnop', platform: 'android' })).body.ready, true);
  await call(owner, 'POST', '/push/register', { token: 'dead-token-1234567890', platform: 'android' });

  const t = await call(owner, 'POST', '/push/test');
  assert.equal(t.body.sent, 1);
  assert.ok(jwtOk, 'the JWT is signed with the service-account key');
  assert.equal(sent[0].auth, 'Bearer ya29.test');
  assert.equal(sent[0].url, '/v1/projects/kb-test/messages:send');
  assert.equal(sent[0].message.android.notification.channel_id, 'default');
  // the dead token was dropped
  sent.length = 0;
  assert.equal((await call(owner, 'POST', '/push/test')).body.sent, 1);

  // a payment tells the owner
  sent.length = 0;
  const c = (await call(owner, 'POST', '/clients', { name: 'Ali' })).body;
  await call(owner, 'POST', '/payments', { clientId: c.id, businessId, amount: 250_000, date: today(), method: 'cash' });
  await wait(300);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].message.notification.title, 'Payment received');
  assert.match(sent[0].message.notification.body, /2,500/);
  assert.equal(sent[0].message.data.url, '/payments');

  // switched off: nothing is sent
  await call(owner, 'PUT', '/push/settings', { off: ['payment'] });
  sent.length = 0;
  await call(owner, 'POST', '/payments', { clientId: c.id, businessId, amount: 1_000, date: today(), method: 'cash' });
  await wait(300);
  assert.equal(sent.length, 0);
  assert.deepEqual((await call(owner, 'GET', '/push/settings')).body.off, ['payment']);
});

test('push: phone-side Firebase values from google-services.json or typed fields', async () => {
  const admin = (await call('', 'POST', '/auth/login', { email: 'admin@push.dev', password: 'test-pass-123' })).body.accessToken;
  const gs = {
    project_info: { project_number: '123456789012', project_id: 'kb-test', storage_bucket: 'kb-test.appspot.com' },
    client: [
      { client_info: { mobilesdk_app_id: '1:123456789012:android:aaaa1111', android_client_info: { package_name: 'com.other.app' } }, api_key: [{ current_key: 'AIzaOtherOtherOtherOtherOther' }] },
      { client_info: { mobilesdk_app_id: '1:123456789012:android:bbbb2222', android_client_info: { package_name: 'com.zhtrader.kaarobarly' } }, api_key: [{ current_key: 'AIzaSyTestTestTestTestTestTest' }] },
    ],
  };
  assert.equal((await call(admin, 'GET', '/push/config')).body.client, null);
  const wrong = { ...gs, client: [gs.client[0]] };
  assert.equal((await call(admin, 'PUT', '/platform/push/client', { googleServices: JSON.stringify(wrong) })).status, 422);
  const ok = await call(admin, 'PUT', '/platform/push/client', { googleServices: JSON.stringify(gs) });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.clientReady, true);
  assert.equal(ok.body.sameProject, true);
  const cfg = (await call(admin, 'GET', '/push/config')).body.client;
  assert.deepEqual(cfg, { projectId: 'kb-test', senderId: '123456789012', appId: '1:123456789012:android:bbbb2222', apiKey: 'AIzaSyTestTestTestTestTestTest', storageBucket: 'kb-test.appspot.com' });
  // typed by hand, with a bad app ID first
  assert.equal((await call(admin, 'PUT', '/platform/push/client', { projectId: 'other-proj', senderId: '999999', appId: 'nope', apiKey: 'AIzaSyTestTestTestTestTestTest' })).status, 422);
  const typed = await call(admin, 'PUT', '/platform/push/client', { projectId: 'other-proj', senderId: '999999', appId: '1:999999:android:cafe01', apiKey: 'AIzaSyTestTestTestTestTestTest' });
  assert.equal(typed.status, 200);
  assert.equal(typed.body.sameProject, false);
  assert.equal((await call(admin, 'DELETE', '/platform/push/client')).body.clientReady, false);
});
