import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createServer as tcp, type Server as TcpServer } from 'node:net';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app';
import { Db } from '../src/db';

let server: Server;
let base = '';
let smtp: TcpServer;
let smtpPort = 0;
let meta: Server;
const mails: string[] = [];
const whatsapps: any[] = [];

before(async () => {
  // a tiny SMTP server: enough of the protocol for nodemailer to hand over a message
  smtp = tcp((s) => {
    let data = false;
    let buf = '';
    s.write('220 test ESMTP\r\n');
    s.on('data', (chunk) => {
      buf += chunk.toString();
      let i: number;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (data) {
          if (line === '.') {
            data = false;
            s.write('250 queued\r\n');
          } else mails[mails.length - 1] += `${line}\n`;
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO' || cmd === 'HELO') s.write('250 test\r\n');
        else if (cmd === 'DATA') {
          data = true;
          mails.push('');
          s.write('354 go\r\n');
        } else if (cmd === 'QUIT') s.end('221 bye\r\n');
        else s.write('250 ok\r\n');
      }
    });
  }).listen(0);
  smtpPort = (smtp.address() as any).port;
  meta = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      whatsapps.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body) });
      res.setHeader('content-type', 'application/json');
      res.end('{"messages":[{"id":"wamid.1"}]}');
    });
  }).listen(0);
  process.env.WHATSAPP_API_URL = `http://127.0.0.1:${(meta.address() as any).port}`;
  process.env.PLATFORM_ADMINS = 'boss@msg.dev';
  server = createApp(new Db(':memory:')).listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(() => {
  server.close();
  smtp.close();
  meta.close();
});

async function call(token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: (await res.json()) as any };
}
const codeIn = (s: string) => s.match(/code is (\d{6})/)?.[1] ?? s.match(/"text":"(\d{6})"/)?.[1] ?? '';

test('email and WhatsApp codes: verify, reset password, sign in with a code', async () => {
  const boss = (await call('', 'POST', '/auth/register', { businessName: 'Platform', name: 'Boss', email: 'boss@msg.dev', password: 'test-pass-123' })).body.accessToken;
  assert.deepEqual((await call('', 'GET', '/auth/channels')).body, { email: false, whatsapp: false });
  assert.equal((await call(boss, 'PUT', '/platform/integrations/email', { host: '127.0.0.1', port: smtpPort, secure: false, user: '', pass: '', fromName: 'Kaarobarly', fromEmail: 'no-reply@kaarobarly.test' })).status, 200);
  const wa = await call(boss, 'PUT', '/platform/integrations/whatsapp', { phoneNumberId: '1234567890', accessToken: 'EAAtoken', template: 'kaarobarly_code', language: 'en', copyButton: true });
  assert.equal(wa.status, 200, JSON.stringify(wa.body));
  assert.equal(wa.body.whatsapp.hasToken, true);
  assert.equal(wa.body.whatsapp.accessToken, undefined, 'secrets are never sent back');
  assert.deepEqual((await call('', 'GET', '/auth/channels')).body, { email: true, whatsapp: true });

  // sign up with a WhatsApp number written the local way
  const reg = await call('', 'POST', '/auth/register', { businessName: 'Shop', name: 'Sara', email: 'sara@msg.dev', password: 'test-pass-123', phone: '0300 1234567' });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  assert.equal(reg.body.user.phone, '923001234567');
  assert.equal(reg.body.user.emailVerified, false);
  const tok = reg.body.accessToken;

  // verify the email
  const sent = await call(tok, 'POST', '/auth/verify/send', { channel: 'email' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.match(sent.body.sentTo, /^sa•+@msg\.dev$/);
  const mailCode = codeIn(mails.at(-1)!);
  assert.match(mailCode, /^\d{6}$/);
  assert.equal((await call(tok, 'POST', '/auth/verify', { code: mailCode === '000000' ? '111111' : '000000' })).status, 422);
  assert.equal((await call(tok, 'POST', '/auth/verify', { code: mailCode })).body.emailVerified, true);

  // forgot password on WhatsApp: the template carries the code
  assert.equal((await call('', 'POST', '/auth/code', { login: '+92 300 1234567', purpose: 'reset', channel: 'whatsapp' })).status, 200);
  const w = whatsapps.at(-1);
  assert.equal(w.url, '/1234567890/messages');
  assert.equal(w.auth, 'Bearer EAAtoken');
  assert.equal(w.body.to, '923001234567');
  assert.equal(w.body.template.name, 'kaarobarly_code');
  const waCode = w.body.template.components[0].parameters[0].text;
  assert.equal(w.body.template.components[1].parameters[0].text, waCode, 'copy-code button');
  const reset = await call('', 'POST', '/auth/reset', { login: '03001234567', code: waCode, password: 'new-pass-456' });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  assert.equal(reset.body.user.phoneVerified, true);
  assert.equal((await call(tok, 'GET', '/me')).status, 401, 'old sessions are signed out');
  assert.equal((await call('', 'POST', '/auth/login', { email: 'sara@msg.dev', password: 'new-pass-456' })).status, 200);
  assert.equal((await call('', 'POST', '/auth/login', { email: '0300-1234567', password: 'new-pass-456' })).status, 200, 'sign in with the WhatsApp number');
  assert.equal((await call('', 'POST', '/auth/reset', { login: '03001234567', code: waCode, password: 'again-pass-789' })).status, 422, 'a code works once');

  // sign in with an email code; unknown accounts get the same answer
  assert.deepEqual((await call('', 'POST', '/auth/code', { login: 'nobody@msg.dev', purpose: 'login', channel: 'email' })).body, { sentTo: '' });
  await call('', 'POST', '/auth/code', { login: 'sara@msg.dev', purpose: 'login', channel: 'email' });
  const li = await call('', 'POST', '/auth/login-code', { login: 'sara@msg.dev', code: codeIn(mails.at(-1)!) });
  assert.equal(li.status, 200, JSON.stringify(li.body));
  assert.equal(li.body.user.email, 'sara@msg.dev');

  // five wrong tries lock the code
  await call('', 'POST', '/auth/code', { login: 'sara@msg.dev', purpose: 'login', channel: 'email' });
  for (let i = 0; i < 5; i++) await call('', 'POST', '/auth/login-code', { login: 'sara@msg.dev', code: '999999' === codeIn(mails.at(-1)!) ? '888888' : '999999' });
  assert.equal((await call('', 'POST', '/auth/login-code', { login: 'sara@msg.dev', code: codeIn(mails.at(-1)!) })).status, 429);
});
