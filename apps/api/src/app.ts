import cors from 'cors';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { ROLES, type User } from '../../../packages/shared/src/index';
import {
  HttpError,
  REFRESH_TTL_DAYS,
  can,
  hashPassword,
  hashToken,
  makeRequireAuth,
  need,
  newRefreshToken,
  permissionsFor,
  signAccess,
  verifyPassword,
} from './auth';
import { now, uid, type Db, type Row } from './db';
import * as d from './domain';
import * as acc from './accounts';
import { deleteAccount, exportAllData } from './account';
import { reportFileName, reportWorkbook } from './excel';
import { shopOrder, shopOrderSchema, shopPage } from './growth';
import * as saas2 from './saas2';
import * as push from './push';
import * as site from './website';
import * as msg from './messaging';
import { MiniApp } from './mini';
import { portalInvoice, portalPage } from './portal';
import * as ai from './ai';
import * as saas from './saas';
import { errorResponse } from './perm';
import { type ReportFilter } from './reports';
import { registerRoutes, upsert } from './routes';
import { applyOps, bumpSeq, pushSchema, snapshot, syncSeq } from './sync';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;


export function createApp(db: Db) {
  const app = express();
  app.set('trust proxy', 1); // behind Nginx: see the visitor's address, not the proxy's
  app.use(cors());
  // Public check for uptime monitors and deploy scripts.
  app.get('/health', (_req, res) => {
    db.get('select 1');
    res.json({ ok: true, service: 'kaarobarly-api', time: now() });
  });
  // basic hardening for a public service
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.use(express.json({ limit: '6mb' }));

  // Public client portal pages (the token in the link is the key); never cached by proxies.
  // Public online shop: the catalogue page and its order form
  app.get('/s/:token', (req, res) => {
    const html = shopPage(db, String(req.params.token));
    res.setHeader('Cache-Control', 'no-store');
    res.status(html ? 200 : 404).type('html').send(html ?? '<p style="font-family:sans-serif">This shop is closed right now.</p>');
  });
  app.post('/s/:token/order', (req, res, next) => {
    try {
      res.status(201).json(shopOrder(db, String(req.params.token), shopOrderSchema.parse(req.body)));
    } catch (e) {
      next(e);
    }
  });
  app.get('/p/:token', (req, res) => {
    const html = portalPage(db, String(req.params.token));
    res.setHeader('Cache-Control', 'no-store');
    res.status(html ? 200 : 404).type('html').send(html ?? '<p style="font-family:sans-serif">This link is no longer active. Ask the business for a new one.</p>');
  });
  app.get('/p/:token/invoice/:id', (req, res) => {
    const html = portalInvoice(db, String(req.params.token), String(req.params.id));
    res.setHeader('Cache-Control', 'no-store');
    res.status(html ? 200 : 404).type('html').send(html ?? '<p style="font-family:sans-serif">Not found.</p>');
  });

  // Public website: the page, its files, its content and the contact form
  app.get('/', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(site.sitePage(db, `${req.protocol}://${req.get('host')}`));
  });
  app.get('/site/content', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.json(site.publicContent(db));
  });
  app.post('/site/lead', (req, res, next) => {
    try {
      const r = site.addLead(db, req.body, req.ip ?? '');
      res.status(201).json(r);
      // tell the owner by email when that is connected
      const to = site.getSite(db).contact.email;
      if (r.id && to && msg.channels(db).email) {
        const b = req.body ?? {};
        void msg.sendEmail(db, to, `New website lead: ${String(b.name ?? '').slice(0, 80)}`, ['name', 'business', 'phone', 'email', 'plan', 'message'].map((k) => `${k}: ${String(b[k] ?? '').slice(0, 1000)}`).join('\n')).catch(() => {});
      }
    } catch (e) {
      next(e);
    }
  });
  app.use('/site', express.static(site.SITE_DIR + '/assets', { maxAge: '1h', index: false }));

  // The full web app (the phone app built for browsers; deploy/push-web.sh uploads it) at /app.
  // Its offline database needs a cross-origin-isolated page, hence the two headers.
  const WEB_APP = process.env.WEB_APP_DIR || resolve(import.meta.dirname, '../../../web-app');
  const isolate = (res: Response) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  };
  app.use('/app', (_req, res, next) => (isolate(res), next()), express.static(WEB_APP, { index: false, maxAge: '7d' }));
  app.get(/^\/app(\/.*)?$/, (_req, res) => {
    const page = resolve(WEB_APP, 'index.html');
    if (!existsSync(page)) return res.status(404).type('html').send('<p style="font-family:sans-serif">The web app is not installed on this server yet.</p>');
    isolate(res);
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(page);
  });

  const requireAuth = makeRequireAuth((sid) => !!db.get("select 1 from auth_session where id = ? and revoked_at is null and expires_at > ?", sid, now()));

  const page = (req: Request) => ({
    limit: Math.min(Math.max(Number(req.query.limit) || 30, 1), 100),
    offset: Math.max(Number(req.query.offset) || 0, 0),
    q: String(req.query.q ?? '').trim(),
  });

  function userDto(u: Row): User {
    const tenant = db.get('select name from tenant where id = ?', u.tenant_id)!;
    return { id: u.id, name: u.name, email: u.email, role: u.role, permissions: permissionsFor(u.role), tenantName: tenant.name, tenantId: u.tenant_id, isPlatformAdmin: saas.isPlatformAdmin(u.email), phone: u.phone ?? '', emailVerified: !!u.email_verified, phoneVerified: !!u.phone_verified };
  }

  function openSession(u: Row, deviceName: string) {
    const sessionId = uid();
    const refresh = newRefreshToken();
    const expires = new Date(Date.now() + REFRESH_TTL_DAYS * 86400_000).toISOString();
    db.run(
      'insert into auth_session (id, tenant_id, user_id, refresh_hash, device_name, expires_at, created_at, last_used_at) values (?,?,?,?,?,?,?,?)',
      sessionId, u.tenant_id, u.id, hashToken(refresh), deviceName, expires, now(), now(),
    );
    const accessToken = signAccess({ userId: u.id, tenantId: u.tenant_id, role: u.role, sessionId, name: u.name });
    return { accessToken, refreshToken: `${sessionId}.${refresh}`, user: userDto(u) };
  }


  // ------------------------------------------------------------ auth

  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.post('/auth/register', (req, res) => {
    saas.rateLimit(`register:${req.ip}`, 20, 60 * 60_000);
    const body = z
      .object({
        businessName: z.string().trim().min(2).max(200),
        name: z.string().trim().min(2).max(200),
        email: z.string().trim().email(),
        password: z.string().min(8, 'Password must be at least 8 characters').max(200),
        deviceName: z.string().max(100).default(''),
        referralCode: z.string().trim().max(20).default(''),
        phone: z.string().trim().max(30).default(''),
      })
      .parse(req.body);
    const phone = body.phone ? msg.normalizePhone(body.phone) : '';
    if (body.phone && phone.length < 10) throw new HttpError(422, 'Enter the WhatsApp number with the country code, e.g. 0300 1234567.');
    const out = db.tx(() => {
      if (db.get('select 1 from app_user where email = ?', body.email)) throw new HttpError(409, 'An account with this email already exists.');
      if (phone && db.get('select 1 from app_user where phone = ?', phone)) throw new HttpError(409, 'An account with this WhatsApp number already exists.');
      const tenantId = uid();
      const userId = uid();
      db.run('insert into tenant (id, name, created_at) values (?,?,?)', tenantId, body.businessName, now());
      db.run('insert into app_user (id, tenant_id, email, name, password_hash, role, created_at) values (?,?,?,?,?,?,?)', userId, tenantId, body.email, body.name, hashPassword(body.password), 'owner', now());
      const bizId = upsert(db, 'business', tenantId, d.businessSchema.parse({ legalName: body.businessName, ownerName: body.name, email: body.email }));
      acc.ensureAccounts(db, { businessId: bizId });
      saas.startTrial(db, tenantId);
      saas2.creditReferral(db, tenantId, body.referralCode);
      if (phone) db.run('update app_user set phone = ? where id = ?', phone, userId);
      db.audit(tenantId, userId, 'tenant.register', 'tenant', tenantId);
      return openSession(db.get('select * from app_user where id = ?', userId)!, body.deviceName);
    });
    const ch = msg.channels(db);
    res.status(201).json({ ...out, verify: ch });
  });

  app.post('/auth/login', (req, res) => {
    saas.rateLimit(`login:${req.ip}`, 30, 15 * 60_000);
    const body = z.object({ email: z.string().trim(), password: z.string(), deviceName: z.string().max(100).default('') }).parse(req.body);
    const u = body.email.includes('@') ? db.get('select * from app_user where email = ?', body.email) : msg.findUser(db, body.email);
    const fail = new HttpError(401, 'Incorrect email, number or password.');
    if (!u || u.status !== 'active') throw fail;
    if (u.locked_until && u.locked_until > now()) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
    if (!verifyPassword(body.password, u.password_hash)) {
      const fails = u.failed_logins + 1;
      const lock = fails >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null;
      db.run('update app_user set failed_logins = ?, locked_until = ? where id = ?', lock ? 0 : fails, lock, u.id);
      throw fail;
    }
    db.run('update app_user set failed_logins = 0, locked_until = null where id = ?', u.id);
    db.audit(u.tenant_id, u.id, 'auth.login', 'user', u.id, { device: body.deviceName });
    res.json(openSession(u, body.deviceName));
  });

  // ------------------------------------------------------------ codes by email or WhatsApp

  /** Which ways of receiving a code this service offers. */
  app.get('/auth/channels', (_req, res) => res.json({ ...msg.channels(db), trialDays: saas.trialSettings(db).days }));

  const loginOrPhone = z.string().trim().min(3, 'Enter your email or WhatsApp number').max(200);
  /** Forgot password or sign in with a code. The answer is the same whether or not the account exists. */
  app.post('/auth/code', async (req, res, next) => {
    try {
      saas.rateLimit(`code:${req.ip}`, 15, 60 * 60_000);
      const body = z.object({ login: loginOrPhone, purpose: z.enum(['reset', 'login']), channel: z.enum(['email', 'whatsapp']) }).parse(req.body);
      const u = msg.findUser(db, body.login);
      const ok = u && (body.channel === 'email' ? !!u.email : !!u.phone);
      if (!msg.channels(db)[body.channel]) throw new HttpError(503, body.channel === 'email' ? 'Email codes are not available yet.' : 'WhatsApp codes are not available yet.');
      if (ok) res.json(await msg.issueCode(db, u!, body.purpose, body.channel));
      else res.json({ sentTo: '' });
    } catch (e) {
      next(e);
    }
  });
  const byLogin = (login: string) => {
    const u = msg.findUser(db, login);
    if (!u) throw new HttpError(422, 'That code is not right.');
    return u;
  };
  /** Set a new password with the code; every other device is signed out. */
  app.post('/auth/reset', (req, res) => {
    saas.rateLimit(`reset:${req.ip}`, 20, 60 * 60_000);
    const body = z.object({ login: loginOrPhone, code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'), password: z.string().min(8, 'Password must be at least 8 characters').max(200), deviceName: z.string().max(100).default('') }).parse(req.body);
    const u = byLogin(body.login);
    const c = msg.checkCode(db, u.id, 'reset', body.code);
    db.tx(() => {
      db.run(`update app_user set password_hash = ?, failed_logins = 0, locked_until = null, ${c.channel === 'email' ? 'email_verified' : 'phone_verified'} = 1 where id = ?`, hashPassword(body.password), u.id);
      db.run('update auth_session set revoked_at = ? where user_id = ? and revoked_at is null', now(), u.id);
      db.audit(u.tenant_id, u.id, 'auth.reset', 'user', u.id, { channel: c.channel });
    });
    res.json(openSession(db.get('select * from app_user where id = ?', u.id)!, body.deviceName));
  });
  /** Sign in with a code instead of the password. */
  app.post('/auth/login-code', (req, res) => {
    saas.rateLimit(`login:${req.ip}`, 30, 15 * 60_000);
    const body = z.object({ login: loginOrPhone, code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'), deviceName: z.string().max(100).default('') }).parse(req.body);
    const u = byLogin(body.login);
    const c = msg.checkCode(db, u.id, 'login', body.code);
    db.run(`update app_user set failed_logins = 0, locked_until = null, ${c.channel === 'email' ? 'email_verified' : 'phone_verified'} = 1 where id = ?`, u.id);
    db.audit(u.tenant_id, u.id, 'auth.login', 'user', u.id, { device: body.deviceName, by: `code:${c.channel}` });
    res.json(openSession(db.get('select * from app_user where id = ?', u.id)!, body.deviceName));
  });

  app.post('/auth/refresh', (req, res) => {
    const { refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body);
    const [sessionId, secret] = refreshToken.split('.');
    const s = db.get('select * from auth_session where id = ?', sessionId ?? '');
    if (!s || s.revoked_at || s.expires_at < now() || s.refresh_hash !== hashToken(secret ?? '')) throw new HttpError(401, 'Session expired. Please sign in again.');
    const u = db.get("select * from app_user where id = ? and status = 'active'", s.user_id);
    if (!u) throw new HttpError(401, 'Session expired. Please sign in again.');
    const next = newRefreshToken();
    db.run('update auth_session set refresh_hash = ?, last_used_at = ? where id = ?', hashToken(next), now(), s.id);
    res.json({
      accessToken: signAccess({ userId: u.id, tenantId: u.tenant_id, role: u.role, sessionId: s.id, name: u.name }),
      refreshToken: `${s.id}.${next}`,
      user: userDto(u),
    });
  });

  // after each recorded action: webhooks for other software, and push notifications to owners
  const hooks = saas2.webhookDispatcher(db);
  const pushes = push.pushDispatcher(db);
  db.onAudit = (...a) => {
    hooks(...a);
    pushes(...a);
  };
  app.use(saas2.withApiKeys(db, requireAuth));
  const T = (req: Request) => req.auth.tenantId;

  app.post('/auth/logout', (req, res) => {
    db.run('update auth_session set revoked_at = ? where id = ? and tenant_id = ?', now(), req.auth.sessionId, T(req));
    res.json({ ok: true });
  });

  app.get('/me', (req, res) => res.json(userDto(db.get('select * from app_user where id = ? and tenant_id = ?', req.auth.userId, T(req))!)));

  app.get('/auth/sessions', (req, res) => {
    const rows = db.all(
      'select id, device_name, created_at, last_used_at from auth_session where tenant_id = ? and user_id = ? and revoked_at is null and expires_at > ? order by last_used_at desc',
      T(req), req.auth.userId, now(),
    );
    res.json(rows.map((r) => ({ id: r.id, deviceName: r.device_name, createdAt: r.created_at, lastUsedAt: r.last_used_at, current: r.id === req.auth.sessionId })));
  });

  app.delete('/auth/sessions/:id', (req, res) => {
    db.run('update auth_session set revoked_at = ? where id = ? and tenant_id = ? and user_id = ?', now(), req.params.id, T(req), req.auth.userId);
    res.json({ ok: true });
  });

  // Re-check the account password, e.g. to unlock the app when the PIN is forgotten.
  app.post('/auth/verify-password', (req, res) => {
    saas.rateLimit(`verify:${req.ip}`, 20, 15 * 60_000);
    const { password } = z.object({ password: z.string().max(200) }).parse(req.body);
    const u = db.get('select * from app_user where id = ? and tenant_id = ?', req.auth.userId, T(req))!;
    if (u.locked_until && u.locked_until > now()) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
    if (!verifyPassword(password, u.password_hash)) {
      const fails = u.failed_logins + 1;
      const lock = fails >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null;
      db.run('update app_user set failed_logins = ?, locked_until = ? where id = ?', lock ? 0 : fails, lock, u.id);
      throw new HttpError(403, 'Incorrect password.');
    }
    db.run('update app_user set failed_logins = 0, locked_until = null where id = ?', u.id);
    res.json({ ok: true });
  });

  // ------------------------------------------------------------ team

  app.get('/users', need('users.manage'), (req, res) => {
    res.json(db.all('select id, name, email, role, status from app_user where tenant_id = ? order by created_at', T(req)));
  });

  app.post('/users', need('users.manage'), (req, res) => {
    saas.assertLimit(db, T(req), 'user');
    const body = z.object({ name: z.string().trim().min(2), email: z.string().trim().email(), password: z.string().min(8), role: z.enum(ROLES) }).parse(req.body);
    if (db.get('select 1 from app_user where email = ?', body.email)) throw new HttpError(409, 'An account with this email already exists.');
    const id = uid();
    db.run('insert into app_user (id, tenant_id, email, name, password_hash, role, created_at) values (?,?,?,?,?,?,?)', id, T(req), body.email, body.name, hashPassword(body.password), body.role, now());
    db.audit(T(req), req.auth.userId, 'user.create', 'user', id, { role: body.role });
    res.status(201).json({ id, name: body.name, email: body.email, role: body.role, status: 'active' });
  });

  app.put('/users/:id', need('users.manage'), (req, res) => {
    const body = z.object({ name: z.string().trim().min(2).optional(), role: z.enum(ROLES).optional(), status: z.enum(['active', 'disabled']).optional() }).parse(req.body);
    const u = db.get('select * from app_user where id = ? and tenant_id = ?', req.params.id, T(req));
    if (!u) throw new HttpError(404, 'User not found.');
    if (u.id === req.auth.userId && (body.role && body.role !== u.role || body.status === 'disabled')) throw new HttpError(409, 'You cannot change your own role or turn off your own access.');
    const owners = db.get("select count(*) as n from app_user where tenant_id = ? and role = 'owner' and status = 'active'", T(req))!.n;
    if (u.role === 'owner' && owners <= 1 && ((body.role && body.role !== 'owner') || body.status === 'disabled')) throw new HttpError(409, 'The account needs at least one active owner.');
    db.run('update app_user set name = coalesce(?, name), role = coalesce(?, role), status = coalesce(?, status) where id = ?', body.name ?? null, body.role ?? null, body.status ?? null, u.id);
    // turning someone off signs them out everywhere
    if (body.status === 'disabled') db.run('update auth_session set revoked_at = ? where user_id = ? and revoked_at is null', now(), u.id);
    db.audit(T(req), req.auth.userId, 'user.update', 'user', u.id, body);
    res.json(db.get('select id, name, email, role, status from app_user where id = ?', u.id));
  });

  // ------------------------------------------------------------ server-only: AI (keys never leave the server)

  // what a customer's app needs to know: whether AI can be used, and how much is left this month
  app.get('/ai/status', (req, res) => {
    const p = saas.planState(db, T(req));
    res.json({ available: ai.aiAvailable(db) && p.limits.aiPerMonth > 0, allowance: p.limits.aiPerMonth, used: p.usage.aiThisMonth });
  });
  // every AI request counts towards the plan's monthly allowance (only when it succeeds)
  const aiRoute = (fn: (req: Request) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
    try {
      saas.assertLimit(db, T(req), 'ai');
    } catch (e) {
      return next(e);
    }
    fn(req).then((out) => {
      saas.countAi(db, T(req));
      res.json(out);
    }, next);
  };
  app.post('/ai/ask', need('reports.view'), aiRoute(async (req) => ({ answer: await ai.ask(db, T(req), z.object({ question: z.string().trim().min(2).max(1000) }).parse(req.body).question) })));
  app.post('/ai/scan-bill', aiRoute(async (req) => {
    if (!can(req, 'finance.manage') && !can(req, 'expenses.claim')) throw new HttpError(403, 'You do not have permission to do this.');
    return ai.scanBill(db, T(req), z.object({ image: z.string().min(20).max(1_500_000) }).parse(req.body).image);
  }));
  app.post('/ai/scan-product', aiRoute(async (req) => {
    if (!can(req, 'invoices.create')) throw new HttpError(403, 'You do not have permission to do this.');
    return ai.scanProduct(db, T(req), z.object({ image: z.string().min(20).max(1_500_000) }).parse(req.body).image);
  }));
  app.post('/ai/parse-entry', aiRoute(async (req) => ai.parseEntry(db, T(req), z.object({ text: z.string().trim().min(3).max(500) }).parse(req.body).text)));

  // ------------------------------------------------------------ server-only: plan & usage, platform admin

  app.get('/plan', (req, res) => res.json({ ...saas.planState(db, T(req)), request: saas.openRequest(db, T(req)), sales: process.env.SALES_CONTACT ?? '' }));
  app.post('/plan/request', need('businesses.manage'), (req, res) => res.status(201).json(saas.requestUpgrade(db, req.auth, saas.requestSchema.parse(req.body))));
  const platformOnly = (req: Request) => {
    const u = db.get('select email from app_user where id = ?', req.auth.userId);
    if (!u || !saas.isPlatformAdmin(u.email)) throw new HttpError(403, 'Only Tijar administrators can do this.');
    return u.email as string;
  };
  app.get('/platform/tenants', (req, res) => {
    platformOnly(req);
    res.json(saas.listTenants(db));
  });
  // SaaS owner: how long new accounts try Pro for free (0 = start on Free)
  app.get('/platform/trial', (req, res) => {
    platformOnly(req);
    res.json(saas.trialSettings(db));
  });
  app.put('/platform/trial', (req, res) => {
    platformOnly(req);
    res.json(saas.saveTrialSettings(db, saas.trialSchema.parse(req.body)));
  });
  app.get('/platform/overview', (req, res) => {
    platformOnly(req);
    res.json({ ...saas.platformOverview(db), ai: ai.publicConfig(db) });
  });
  app.get('/platform/ai', (req, res) => {
    platformOnly(req);
    res.json(ai.publicConfig(db));
  });
  app.put('/platform/ai', (req, res) => {
    const email = platformOnly(req);
    res.json(ai.saveConfig(db, email, ai.aiConfigSchema.parse(req.body)));
  });
  app.post('/platform/ai/test', (req, res, next) => {
    try {
      platformOnly(req);
    } catch (e) {
      return next(e);
    }
    ai.testConnection(db, T(req)).then((reply) => res.json({ reply }), next);
  });
  // developers: API keys and webhooks (owner only, server only)
  const devOwnerOnly = (req: Request) => {
    if (req.auth.role !== 'owner') throw new HttpError(403, 'Only the owner can manage API keys and webhooks.');
  };
  app.get('/developer/keys', (req, res) => (devOwnerOnly(req), res.json(saas2.listApiKeys(db, T(req)))));
  app.post('/developer/keys', (req, res) => (devOwnerOnly(req), res.status(201).json(saas2.createApiKey(db, req.auth, saas2.apiKeySchema.parse(req.body)))));
  app.delete('/developer/keys/:id', (req, res) => (devOwnerOnly(req), res.json(saas2.revokeApiKey(db, req.auth, String(req.params.id)))));
  app.get('/developer/webhooks', (req, res) => (devOwnerOnly(req), res.json(saas2.listWebhooks(db, T(req)))));
  app.post('/developer/webhooks', (req, res) => (devOwnerOnly(req), res.status(201).json(saas2.saveWebhook(db, req.auth, saas2.webhookSchema.parse(req.body)))));
  app.put('/developer/webhooks/:id', (req, res) => (devOwnerOnly(req), res.json(saas2.saveWebhook(db, req.auth, saas2.webhookSchema.parse(req.body), String(req.params.id)))));
  app.delete('/developer/webhooks/:id', (req, res) => (devOwnerOnly(req), res.json(saas2.deleteWebhook(db, req.auth, String(req.params.id)))));
  app.post('/developer/webhooks/:id/test', (req, res, next) => {
    try {
      devOwnerOnly(req);
      saas2.testWebhook(db, req.auth, String(req.params.id)).then((r) => res.json(r), next);
    } catch (e) {
      next(e);
    }
  });
  // push notifications: this phone's token, what the business is told about, and the platform's Firebase key
  // confirm the signed-in person's email or WhatsApp number
  app.post('/auth/verify/send', async (req, res, next) => {
    try {
      const { channel } = z.object({ channel: z.enum(['email', 'whatsapp']) }).parse(req.body);
      const u = db.get('select * from app_user where id = ?', req.auth.userId);
      if (!u) throw new HttpError(404, 'Account not found.');
      res.json(await msg.issueCode(db, u, 'verify', channel));
    } catch (e) {
      next(e);
    }
  });
  app.post('/auth/verify', (req, res) => {
    const { code } = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') }).parse(req.body);
    const c = msg.checkCode(db, req.auth.userId, 'verify', code);
    db.run(`update app_user set ${c.channel === 'email' ? 'email_verified' : 'phone_verified'} = 1 where id = ?`, req.auth.userId);
    res.json(userDto(db.get('select * from app_user where id = ?', req.auth.userId)!));
  });
  app.put('/auth/phone', (req, res) => {
    const phone = msg.normalizePhone(z.object({ phone: z.string().trim().min(7).max(30) }).parse(req.body).phone);
    if (phone.length < 10) throw new HttpError(422, 'Enter the WhatsApp number with the country code.');
    if (db.get('select 1 from app_user where phone = ? and id <> ?', phone, req.auth.userId)) throw new HttpError(409, 'Another account uses this number.');
    db.run('update app_user set phone = ?, phone_verified = 0 where id = ?', phone, req.auth.userId);
    res.json(userDto(db.get('select * from app_user where id = ?', req.auth.userId)!));
  });

  // SaaS owner: email, WhatsApp and Firebase connections
  app.get('/platform/integrations', (req, res) => {
    platformOnly(req);
    res.json({ ...msg.integrations(db), firebase: push.fcmStatus(db) });
  });
  app.put('/platform/integrations/email', (req, res) => {
    platformOnly(req);
    res.json(msg.saveEmail(db, msg.emailSchema.parse(req.body)));
  });
  app.put('/platform/integrations/whatsapp', (req, res) => {
    platformOnly(req);
    res.json(msg.saveWhatsApp(db, msg.whatsappSchema.parse(req.body)));
  });
  app.post('/platform/integrations/test', async (req, res, next) => {
    try {
      platformOnly(req);
      const b = z.object({ channel: z.enum(['email', 'whatsapp']), to: z.string().trim().min(5).max(200) }).parse(req.body);
      if (b.channel === 'email') await msg.sendEmail(db, b.to, 'Tijar email works', 'This test email from Tijar arrived, so codes and notices can be sent by email.');
      else await msg.sendWhatsAppCode(db, b.to, '123456');
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  // phones fetch the Firebase connection values here, so a new Firebase project needs no app rebuild
  app.get('/push/config', (_req, res) => res.json({ client: push.clientConfig(db) }));
  app.post('/push/register', (req, res) => res.json(push.registerDevice(db, req.auth, push.registerSchema.parse(req.body))));
  app.post('/push/unregister', (req, res) => res.json(push.unregisterDevice(db, req.auth, z.object({ token: z.string().min(1) }).parse(req.body).token)));
  app.get('/push/settings', (req, res) => res.json({ ...push.getPushSettings(db, T(req)), ready: push.fcmStatus(db).ready, devices: db.get('select count(*) as n from push_device where user_id = ?', req.auth.userId)!.n }));
  app.put('/push/settings', (req, res) => {
    devOwnerOnly(req);
    res.json(push.savePushSettings(db, req.auth, push.pushSettingsSchema.parse(req.body)));
  });
  app.post('/push/test', async (req, res, next) => {
    try {
      const n = await push.notify(db, T(req), { title: 'Tijar notifications work', body: 'You will be told about payments, orders and alerts here.', url: '/' }, [req.auth.userId]);
      res.json({ sent: n });
    } catch (e) {
      next(e);
    }
  });
  app.get('/platform/push', (req, res) => {
    platformOnly(req);
    res.json(push.fcmStatus(db));
  });
  app.put('/platform/push', (req, res) => {
    platformOnly(req);
    res.json(push.saveFcm(db, push.fcmSchema.parse(req.body)));
  });
  app.put('/platform/push/client', (req, res) => {
    platformOnly(req);
    res.json(push.saveClient(db, push.clientSchema.parse(req.body)));
  });
  app.delete('/platform/push/client', (req, res) => {
    platformOnly(req);
    res.json(push.clearClient(db));
  });
  // SaaS owner: the public website's words and the people who asked to be contacted
  app.get('/platform/site', (req, res) => {
    platformOnly(req);
    res.json({ content: site.getSite(db), icons: site.ICONS, leads: db.get("select count(*) as n from site_lead where status = 'new'")!.n });
  });
  app.put('/platform/site', (req, res) => {
    platformOnly(req);
    res.json(site.saveSite(db, req.body));
  });
  app.post('/platform/site/reset', (req, res) => {
    platformOnly(req);
    res.json(site.resetSite(db));
  });
  app.get('/platform/site/leads', (req, res) => {
    platformOnly(req);
    res.json(site.listLeads(db, typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined));
  });
  app.put('/platform/site/leads/:id', (req, res) => {
    platformOnly(req);
    res.json(site.setLeadStatus(db, String(req.params.id), site.leadStatusSchema.parse(req.body).status));
  });
  app.delete('/platform/site/leads/:id', (req, res) => {
    platformOnly(req);
    res.json(site.deleteLead(db, String(req.params.id)));
  });
  app.get('/platform/partners', (req, res) => {
    platformOnly(req);
    res.json(saas2.listPartners(db));
  });
  app.put('/platform/tenants/:id/partner', (req, res) => {
    platformOnly(req);
    res.json(saas2.setPartner(db, String(req.params.id), z.object({ partner: z.boolean() }).parse(req.body).partner));
  });
  app.put('/platform/tenants/:id/plan', (req, res) => {
    const email = platformOnly(req);
    res.json(saas.setPlan(db, email, String(req.params.id), saas.setPlanSchema.parse(req.body)));
  });

  // ------------------------------------------------------------ server-only: Excel and sync

  const reportFilter = (req: Request): ReportFilter => {
    const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
    const t = new Date().toISOString().slice(0, 10);
    const from = date.safeParse(req.query.from).success ? String(req.query.from) : `${t.slice(0, 7)}-01`;
    const to = date.safeParse(req.query.to).success ? String(req.query.to) : t;
    if (to < from) throw new HttpError(422, 'The end of the period is before its start.');
    return { from, to, businessId: req.query.businessId ? String(req.query.businessId) : undefined };
  };
  app.get('/reports/export.xlsx', need('reports.view'), async (req, res, next) => {
    try {
      const f = reportFilter(req);
      const tenant = db.get('select name from tenant where id = ?', T(req))!;
      const buf = await reportWorkbook(db, T(req), f, tenant.name);
      db.audit(T(req), req.auth.userId, 'report.export', 'report', null, { from: f.from, to: f.to, format: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${reportFileName(f)}"`);
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
      res.send(buf);
    } catch (e) {
      next(e);
    }
  });

  // ------------------------------------------------------------ server-only: whole account (owner)

  const ownerOnly = (req: Request) => {
    if (req.auth.role !== 'owner') throw new HttpError(403, 'Only the account owner can do this.');
  };
  app.get('/account/export.xlsx', async (req, res, next) => {
    try {
      ownerOnly(req);
      const buf = await exportAllData(db, T(req));
      db.audit(T(req), req.auth.userId, 'account.export', 'tenant', T(req));
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="tijar-all-data-${now().slice(0, 10)}.xlsx"`);
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
      res.send(buf);
    } catch (e) {
      next(e);
    }
  });
  app.post('/account/delete', (req, res) => {
    ownerOnly(req);
    const body = z.object({ password: z.string().min(1, 'Enter your password'), confirm: z.literal('DELETE', { message: 'Type DELETE to confirm' }) }).parse(req.body);
    const u = db.get('select * from app_user where id = ? and tenant_id = ?', req.auth.userId, T(req));
    if (!u || !verifyPassword(body.password, u.password_hash)) throw new HttpError(422, 'Incorrect password.');
    deleteAccount(db, T(req));
    res.json({ ok: true });
  });

  // the same routes, run in-process, replay operations queued on phones
  const engine = new MiniApp();
  registerRoutes(engine, db);

  app.get('/sync/pull', (req, res) => {
    const seq = syncSeq(db, T(req));
    const tag = `"${T(req)}:${seq}"`;
    if (req.headers['if-none-match'] === tag) return void res.status(304).end();
    res.setHeader('ETag', tag);
    res.setHeader('Access-Control-Expose-Headers', 'ETag');
    res.json(snapshot(db, T(req)));
  });
  app.post('/sync/push', (req, res) => {
    const { ops } = pushSchema.parse(req.body);
    res.json({ results: applyOps(db, engine, req.auth, ops), seq: syncSeq(db, T(req)) });
  });

  // phones know data changed elsewhere when this number moves
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET') res.on('finish', () => res.statusCode < 400 && bumpSeq(db, T(req)));
    next();
  });

  registerRoutes(app, db);

  // ------------------------------------------------------------ errors

  app.use((_req, _res, next) => next(new HttpError(404, 'Not found.')));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const r = errorResponse(err);
    res.status(r.status).json(r.body);
  });

  return app;
}
