import { createSign } from 'node:crypto';
import { z } from 'zod';
import { formatMoney } from '../../../packages/shared/src/index';
import { now, uid, type Db } from './core';
import { getSetting, setSetting } from './growth';
import { HttpError, type AuthContext } from './perm';

/**
 * Push notifications through Firebase Cloud Messaging (HTTP v1). The platform owner pastes the
 * Firebase service-account key once (SaaS admin); phones register their device token after sign-in.
 */

// ================================================================ platform setup (service account)

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri: string;
}

export const fcmSchema = z.object({ serviceAccount: z.string().min(50, 'Paste the whole service-account JSON').max(20_000) });

function account(db: Db): ServiceAccount | null {
  const r = db.get("select value from platform_setting where key = 'fcm'");
  if (!r) return null;
  try {
    return JSON.parse(r.value);
  } catch {
    return null;
  }
}

export function fcmStatus(db: Db) {
  const a = account(db);
  const c = clientConfig(db);
  return {
    ready: !!a,
    projectId: a?.project_id ?? '',
    clientEmail: a?.client_email ?? '',
    devices: db.get('select count(*) as n from push_device')!.n,
    // what phones use to connect to Firebase (from google-services.json); not secret
    client: c,
    clientReady: !!c,
    sameProject: !a || !c || a.project_id === c.projectId,
  };
}

// ================================================================ phone side (google-services.json values)

/** The Android package the values must belong to. */
export const ANDROID_PACKAGE = 'com.zhtrader.kaarobarly';

export interface ClientConfig {
  projectId: string;
  /** project number, a.k.a. sender ID */
  senderId: string;
  /** mobilesdk_app_id, e.g. 1:1234567890:android:abc123 */
  appId: string;
  apiKey: string;
  storageBucket: string;
}

export const clientSchema = z.object({
  googleServices: z.string().max(50_000).optional(),
  projectId: z.string().trim().max(100).optional(),
  senderId: z.string().trim().max(40).optional(),
  appId: z.string().trim().max(200).optional(),
  apiKey: z.string().trim().max(200).optional(),
  storageBucket: z.string().trim().max(200).optional(),
});

export function clientConfig(db: Db): ClientConfig | null {
  const r = db.get("select value from platform_setting where key = 'fcm_client'");
  if (!r) return null;
  try {
    return JSON.parse(r.value);
  } catch {
    return null;
  }
}

/** Save the phone-side Firebase values: either the whole google-services.json, or the four fields typed in. */
export function saveClient(db: Db, body: z.infer<typeof clientSchema>) {
  let c: ClientConfig;
  if (body.googleServices?.trim()) {
    let g: any;
    try {
      g = JSON.parse(body.googleServices);
    } catch {
      throw new HttpError(422, 'That is not valid JSON. Paste the whole google-services.json file.');
    }
    if (!g?.project_info || !Array.isArray(g.client)) throw new HttpError(422, 'This is not a google-services.json file.');
    const client = g.client.find((x: any) => x?.client_info?.android_client_info?.package_name === ANDROID_PACKAGE);
    if (!client) throw new HttpError(422, `This file has no Android app with package ${ANDROID_PACKAGE}. In Firebase add an Android app with that package name and download the file again.`);
    c = {
      projectId: String(g.project_info.project_id ?? ''),
      senderId: String(g.project_info.project_number ?? ''),
      appId: String(client.client_info?.mobilesdk_app_id ?? ''),
      apiKey: String(client.api_key?.[0]?.current_key ?? ''),
      storageBucket: String(g.project_info.storage_bucket ?? ''),
    };
  } else {
    c = { projectId: body.projectId ?? '', senderId: body.senderId ?? '', appId: body.appId ?? '', apiKey: body.apiKey ?? '', storageBucket: body.storageBucket ?? '' };
  }
  if (!/^[a-z0-9-]{4,}$/.test(c.projectId)) throw new HttpError(422, 'Project ID looks wrong (e.g. tijar-12345).');
  if (!/^\d{6,}$/.test(c.senderId)) throw new HttpError(422, 'Sender ID (project number) must be digits only.');
  if (!/^1:\d+:android:[0-9a-f]+$/.test(c.appId)) throw new HttpError(422, 'App ID must look like 1:123456789012:android:abc123def456.');
  if (!/^AIza[0-9A-Za-z_-]{20,}$/.test(c.apiKey)) throw new HttpError(422, 'API key must start with AIza.');
  db.run("insert into platform_setting (key, value, updated_at) values ('fcm_client', ?, ?) on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at", JSON.stringify(c), now());
  return fcmStatus(db);
}

export function clearClient(db: Db) {
  db.run("delete from platform_setting where key = 'fcm_client'");
  return fcmStatus(db);
}

export function saveFcm(db: Db, body: z.infer<typeof fcmSchema>) {
  let a: ServiceAccount;
  try {
    a = JSON.parse(body.serviceAccount);
  } catch {
    throw new HttpError(422, 'That is not valid JSON. Paste the file downloaded from Firebase → Project settings → Service accounts.');
  }
  if (!a.project_id || !a.client_email || !a.private_key?.includes('PRIVATE KEY')) throw new HttpError(422, 'This JSON is not a Firebase service-account key.');
  const keep = { project_id: a.project_id, client_email: a.client_email, private_key: a.private_key, token_uri: a.token_uri || 'https://oauth2.googleapis.com/token' };
  db.run("insert into platform_setting (key, value, updated_at) values ('fcm', ?, ?) on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at", JSON.stringify(keep), now());
  cached = null;
  return fcmStatus(db);
}

let cached: { token: string; until: number } | null = null;
const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url');

/** An OAuth access token from the service account (signed JWT exchange), kept for ~55 minutes. */
async function accessToken(a: ServiceAccount): Promise<string> {
  if (cached && cached.until > Date.now()) return cached.token;
  const iat = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: a.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: a.token_uri, iat, exp: iat + 3600 }));
  const sig = createSign('RSA-SHA256').update(`${head}.${claims}`).sign(a.private_key, 'base64url');
  const res = await fetch(a.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${sig}` }),
    signal: AbortSignal.timeout(10_000),
  });
  const j = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !j.access_token) throw new Error(j.error_description || `Google sign-in failed (${res.status})`);
  cached = { token: j.access_token, until: Date.now() + 55 * 60_000 };
  return j.access_token;
}

// ================================================================ devices

export const registerSchema = z.object({ token: z.string().min(20).max(4096), platform: z.enum(['android', 'ios']).default('android') });

export function registerDevice(db: Db, auth: AuthContext, body: z.infer<typeof registerSchema>) {
  db.run(
    `insert into push_device (id, tenant_id, user_id, token, platform, created_at, last_seen) values (?,?,?,?,?,?,?)
     on conflict (token) do update set tenant_id = excluded.tenant_id, user_id = excluded.user_id, last_seen = excluded.last_seen`,
    uid(), auth.tenantId, auth.userId, body.token, body.platform, now(), now(),
  );
  return { ok: true, ready: !!account(db) };
}

export function unregisterDevice(db: Db, auth: AuthContext, token: string) {
  db.run('delete from push_device where token = ? and user_id = ?', token, auth.userId);
  return { ok: true };
}

// ================================================================ what to notify

export const PUSH_EVENTS = ['payment', 'online_order', 'shift_variance', 'claim', 'purchase_request', 'daily_digest'] as const;
export type PushEvent = (typeof PUSH_EVENTS)[number];
export interface PushSettings {
  off: PushEvent[];
}
export const pushSettingsSchema = z.object({ off: z.array(z.enum(PUSH_EVENTS)).default([]) });
export const getPushSettings = (db: Db, tenantId: string): PushSettings => getSetting(db, tenantId, 'push', { off: [] as PushEvent[] });
export function savePushSettings(db: Db, auth: AuthContext, body: z.infer<typeof pushSettingsSchema>) {
  setSetting(db, auth.tenantId, 'push', body);
  return getPushSettings(db, auth.tenantId);
}

// ================================================================ sending

export interface PushMessage {
  title: string;
  body: string;
  /** screen to open when tapped, e.g. /restaurant */
  url?: string;
}

/** Send to every phone of the business's owners and managers (or the given users). Never throws. */
export async function notify(db: Db, tenantId: string, msg: PushMessage, users?: string[]): Promise<number> {
  const a = account(db);
  if (!a) return 0;
  const devices = users?.length
    ? db.all(`select id, token from push_device where tenant_id = ? and user_id in (${users.map(() => '?').join(',')})`, tenantId, ...users)
    : db.all("select d.id, d.token from push_device d join app_user u on u.id = d.user_id where d.tenant_id = ? and u.role in ('owner','manager')", tenantId);
  if (!devices.length) return 0;
  let sent = 0;
  try {
    const token = await accessToken(a);
    for (const d of devices) {
      const res = await fetch(`${process.env.FCM_BASE_URL || 'https://fcm.googleapis.com'}/v1/projects/${a.project_id}/messages:send`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            token: d.token,
            notification: { title: msg.title.slice(0, 120), body: msg.body.slice(0, 400) },
            data: { title: msg.title.slice(0, 120), body: msg.body.slice(0, 400), url: msg.url ?? '' },
            android: { priority: 'high', notification: { channel_id: 'default', color: '#19B892' } },
          },
        }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => null);
      if (res?.ok) sent++;
      // the app was uninstalled or the token replaced: forget it
      else if (res && (res.status === 404 || res.status === 400)) {
        const text = await res.text().catch(() => '');
        if (/UNREGISTERED|INVALID_ARGUMENT|registration-token-not-registered/.test(text)) db.run('delete from push_device where id = ?', d.id);
      }
    }
  } catch {
    // Google sign-in or network failed: nothing is sent this time
  }
  return sent;
}

/** Turn a recorded action into a notification for the owner (called after the action is saved). */
export function pushDispatcher(db: Db) {
  return (auditId: string, tenantId: string, action: string, _entity: string, _entityId: string | null, detail: any) => {
    const map: Record<string, PushEvent> = { 'payment.record': 'payment', 'order.online': 'online_order', 'pos.shift_close': 'shift_variance', 'claim.create': 'claim', 'request.save': 'purchase_request' };
    const ev = map[action];
    if (!ev) return;
    setTimeout(() => {
      try {
        if (!account(db) || !db.get('select 1 from audit_log where id = ?', auditId)) return;
        if (getPushSettings(db, tenantId).off.includes(ev)) return;
        const b = db.get('select currency, currency_precision from business where tenant_id = ? order by created_at limit 1', tenantId);
        const m = (v: number) => formatMoney(v ?? 0, b?.currency ?? 'PKR', b?.currency_precision ?? 2);
        let msg: PushMessage | null = null;
        if (ev === 'payment') msg = { title: 'Payment received', body: `${m(detail?.amount)} recorded`, url: '/payments' };
        else if (ev === 'online_order') msg = { title: `New online order ${detail?.number ?? ''}`, body: `${detail?.name ?? 'A customer'} · ${m(detail?.total)}`, url: '/shop' };
        else if (ev === 'shift_variance' && detail?.difference) msg = { title: `Drawer ${detail.difference < 0 ? 'short' : 'over'} by ${m(Math.abs(detail.difference))}`, body: 'A shift was closed with a cash difference.', url: '/pos/shifts' };
        else if (ev === 'claim') msg = { title: 'Expense claim to approve', body: detail?.amount ? m(detail.amount) : 'A new claim is waiting', url: '/approvals' };
        else if (ev === 'purchase_request') msg = { title: 'Purchase request', body: 'A request is waiting for approval', url: '/approvals' };
        if (msg) void notify(db, tenantId, msg);
      } catch {
        // database closed (tests, shutdown)
      }
    }, 0);
  };
}

/** Each morning: one summary per business of what needs attention today. */
export async function dailyDigest(db: Db, stockAlerts: (db: Db, tenantId: string) => { level: string }[]) {
  if (!account(db)) return;
  for (const t of db.all('select distinct tenant_id from push_device')) {
    const tenantId = t.tenant_id as string;
    if (getPushSettings(db, tenantId).off.includes('daily_digest')) continue;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const overdue = db.get("select count(*) as n from invoice i where i.tenant_id = ? and i.status = 'final' and i.due_date < ? and i.total > coalesce((select sum(a.amount) from payment_allocation a where a.invoice_id = i.id), 0)", tenantId, today)!.n;
      const stock = stockAlerts(db, tenantId).filter((a) => a.level !== 'info').length;
      if (!overdue && !stock) continue;
      const parts = [overdue ? `${overdue} overdue invoice${overdue === 1 ? '' : 's'}` : '', stock ? `${stock} stock alert${stock === 1 ? '' : 's'}` : ''].filter(Boolean);
      await notify(db, tenantId, { title: 'Good morning: today in your business', body: parts.join(' · '), url: stock ? '/stock/alerts' : '/collections' });
    } catch {}
  }
}
