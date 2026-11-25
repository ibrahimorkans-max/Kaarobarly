import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { now, uid, type Db, type Row } from './core';
import { HttpError, type AuthContext } from './perm';
import { rateLimit } from './saas';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

// ================================================================ API keys (REST API for other software)

export const API_ROLES = ['manager', 'accountant', 'staff', 'viewer'] as const;
export const apiKeySchema = z.object({ name: z.string().trim().min(1, 'Name the key').max(60), role: z.enum(API_ROLES).default('accountant') });

const mapKey = (r: Row) => ({ id: r.id, name: r.name, prefix: r.prefix, role: r.role, createdAt: r.created_at, lastUsedAt: r.last_used_at ?? '', revoked: !!r.revoked_at });

export function listApiKeys(db: Db, tenantId: string) {
  return db.all('select * from api_key where tenant_id = ? order by created_at desc', tenantId).map(mapKey);
}

/** A new key. The full key is shown once; only its hash is kept. */
export function createApiKey(db: Db, auth: AuthContext, body: z.infer<typeof apiKeySchema>) {
  if (db.get('select count(*) as n from api_key where tenant_id = ? and revoked_at is null', auth.tenantId)!.n >= 10) throw new HttpError(422, 'Keep at most 10 active keys.');
  const key = `kb_live_${randomBytes(24).toString('base64url')}`;
  const id = uid();
  db.run('insert into api_key (id, tenant_id, name, prefix, hash, role, created_by, created_at) values (?,?,?,?,?,?,?,?)', id, auth.tenantId, body.name, key.slice(0, 12), sha(key), body.role, auth.userId, now());
  db.audit(auth.tenantId, auth.userId, 'apikey.create', 'api_key', id, { name: body.name, role: body.role });
  return { ...mapKey(db.get('select * from api_key where id = ?', id)!), key };
}

export function revokeApiKey(db: Db, auth: AuthContext, id: string) {
  db.run('update api_key set revoked_at = ? where id = ? and tenant_id = ? and revoked_at is null', now(), id, auth.tenantId);
  db.audit(auth.tenantId, auth.userId, 'apikey.revoke', 'api_key', id);
  return { ok: true };
}

/** Requests with an X-Api-Key header act as that key's role; everything else needs a signed-in user. */
export function withApiKeys(db: Db, requireAuth: (req: Request, res: Response, next: NextFunction) => void) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.headers['x-api-key'];
    if (typeof key !== 'string' || !key) return requireAuth(req, res, next);
    try {
      const r = db.get('select * from api_key where hash = ? and revoked_at is null', sha(key));
      if (!r) throw new HttpError(401, 'This API key is not valid.');
      rateLimit(`api:${r.id}`, 600, 60_000);
      // keys never reach account, team or platform settings
      if (/^\/(auth|users|platform|plan|account|sync)\b/.test(req.path)) throw new HttpError(403, 'API keys cannot use this endpoint.');
      db.run('update api_key set last_used_at = ? where id = ?', now(), r.id);
      (req as any).auth = { userId: `api:${r.id}`, tenantId: r.tenant_id, role: r.role, sessionId: `api:${r.id}`, name: `API · ${r.name}` } as AuthContext;
      next();
    } catch (e) {
      next(e);
    }
  };
}

// ================================================================ webhooks

/** Events other software can follow; each is an action the app already records. */
export const WEBHOOK_EVENTS = ['invoice.finalize', 'invoice.cancel', 'payment.record', 'pos.sale', 'pos.return', 'order.online', 'stock.writeoff', 'giftcard.issue'] as const;
export const webhookSchema = z.object({
  url: z.string().trim().url('Enter the full https:// address').max(500).refine((u) => u.startsWith('https://') || u.startsWith('http://localhost'), 'Use an https:// address'),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, 'Choose at least one event'),
  active: z.boolean().default(true),
});

const mapHook = (r: Row) => ({ id: r.id, url: r.url, events: JSON.parse(r.events), active: !!r.active, secret: r.secret, lastStatus: r.last_status ?? '', lastAt: r.last_at ?? '', createdAt: r.created_at });

export const listWebhooks = (db: Db, tenantId: string) => db.all('select * from webhook where tenant_id = ? order by created_at', tenantId).map(mapHook);

export function saveWebhook(db: Db, auth: AuthContext, body: z.infer<typeof webhookSchema>, id?: string) {
  if (id) {
    if (!db.get('select 1 from webhook where id = ? and tenant_id = ?', id, auth.tenantId)) throw new HttpError(404, 'Webhook not found.');
    db.run('update webhook set url = ?, events = ?, active = ? where id = ?', body.url, JSON.stringify(body.events), body.active ? 1 : 0, id);
  } else {
    if (db.get('select count(*) as n from webhook where tenant_id = ?', auth.tenantId)!.n >= 10) throw new HttpError(422, 'Keep at most 10 webhooks.');
    id = uid();
    db.run('insert into webhook (id, tenant_id, url, events, secret, active, created_at) values (?,?,?,?,?,?,?)', id, auth.tenantId, body.url, JSON.stringify(body.events), `whsec_${randomBytes(18).toString('base64url')}`, body.active ? 1 : 0, now());
  }
  return mapHook(db.get('select * from webhook where id = ?', id)!);
}

export function deleteWebhook(db: Db, auth: AuthContext, id: string) {
  db.run('delete from webhook where id = ? and tenant_id = ?', id, auth.tenantId);
  return { ok: true };
}

async function deliver(db: Db, hook: Row, payload: object) {
  const body = JSON.stringify(payload);
  const sig = createHmac('sha256', hook.secret).update(body).digest('hex');
  let status = '';
  try {
    const res = await fetch(hook.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-kaarobarly-signature': `sha256=${sig}`, 'user-agent': 'Tijar-Webhooks/1' }, body, signal: AbortSignal.timeout(5000) });
    status = String(res.status);
  } catch (e: any) {
    status = e?.name === 'TimeoutError' ? 'timeout' : 'failed';
  }
  db.run('update webhook set last_status = ?, last_at = ? where id = ?', status, now(), hook.id);
  return status;
}

/**
 * Called after each recorded action (server only). Sends the event once the database has
 * committed: an action rolled back leaves no audit row, so nothing is sent for it.
 */
export function webhookDispatcher(db: Db) {
  return (auditId: string, tenantId: string, action: string, entity: string, entityId: string | null, detail: unknown) => {
    if (!(WEBHOOK_EVENTS as readonly string[]).includes(action)) return;
    setTimeout(() => {
      try {
        if (!db.get('select 1 from audit_log where id = ?', auditId)) return;
        for (const h of db.all('select * from webhook where tenant_id = ? and active = 1', tenantId)) {
          if (!JSON.parse(h.events).includes(action)) continue;
          void deliver(db, h, { event: action, entity, id: entityId, detail, at: new Date().toISOString() });
        }
      } catch {
        // a closed database (tests, shutdown) just means nothing is sent
      }
    }, 0);
  };
}

export async function testWebhook(db: Db, auth: AuthContext, id: string) {
  const h = db.get('select * from webhook where id = ? and tenant_id = ?', id, auth.tenantId);
  if (!h) throw new HttpError(404, 'Webhook not found.');
  return { status: await deliver(db, h, { event: 'test', entity: 'webhook', id, detail: { hello: 'from Tijar' }, at: new Date().toISOString() }) };
}

// ================================================================ partners (resellers)

export function setPartner(db: Db, tenantId: string, partner: boolean) {
  const t = db.get('select id, name, referral_code from tenant where id = ?', tenantId);
  if (!t) throw new HttpError(404, 'Business not found.');
  const code = partner ? t.referral_code || `P${uid().replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase()}` : null;
  db.run('update tenant set referral_code = ? where id = ?', code, tenantId);
  return { tenantId, partner, referralCode: code };
}

export function listPartners(db: Db) {
  return db.all(
    `select p.id, p.name, p.referral_code, (select count(*) from tenant t where t.referred_by = p.id) as signups,
       (select count(*) from tenant t where t.referred_by = p.id and coalesce(t.plan, 'free') not in ('free', 'legacy', 'trial')) as paying
     from tenant p where p.referral_code is not null order by signups desc`,
  ).map((r) => ({ tenantId: r.id, name: r.name, referralCode: r.referral_code, signups: r.signups, paying: r.paying }));
}

/** A sign-up with a partner's code is credited to that partner. */
export function creditReferral(db: Db, tenantId: string, code: string) {
  const p = code ? db.get('select id from tenant where referral_code = ?', code.trim().toUpperCase()) : null;
  if (p && p.id !== tenantId) db.run('update tenant set referred_by = ? where id = ?', p.id, tenantId);
}

