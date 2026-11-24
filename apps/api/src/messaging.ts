import { createHash, randomInt } from 'node:crypto';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import { now, uid, type Db, type Row } from './core';
import { HttpError } from './perm';
import { rateLimit } from './saas';

/**
 * How Kaarobarly reaches people outside the app: email (any SMTP service) and WhatsApp
 * (Meta WhatsApp Business Cloud API). Set once by the SaaS owner; used for sign-up
 * verification, password resets and sign-in codes. Server only.
 */

// ================================================================ settings

export interface EmailSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
}
export interface WhatsAppSettings {
  phoneNumberId: string;
  accessToken: string;
  /** an approved "authentication" template with one {{1}} for the code */
  template: string;
  language: string;
  /** the template has a "copy code" button (Meta's authentication templates do) */
  copyButton: boolean;
}

const read = <T>(db: Db, key: string): T | null => {
  const r = db.get('select value from platform_setting where key = ?', key);
  try {
    return r ? (JSON.parse(r.value) as T) : null;
  } catch {
    return null;
  }
};
const write = (db: Db, key: string, value: unknown) =>
  db.run('insert into platform_setting (key, value, updated_at) values (?,?,?) on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at', key, JSON.stringify(value), now());

const emailOk = (e: EmailSettings | null): e is EmailSettings => !!e?.host && !!e.fromEmail;
const waOk = (w: WhatsAppSettings | null): w is WhatsAppSettings => !!w?.phoneNumberId && !!w.accessToken && !!w.template;

/** Which ways of sending codes are switched on (the app shows only these). */
export function channels(db: Db) {
  return { email: emailOk(read<EmailSettings>(db, 'email')), whatsapp: waOk(read<WhatsAppSettings>(db, 'whatsapp')) };
}

/** Settings for the admin screen; secrets are never sent back, only whether they are set. */
export function integrations(db: Db) {
  const e = read<EmailSettings>(db, 'email');
  const w = read<WhatsAppSettings>(db, 'whatsapp');
  return {
    email: e ? { host: e.host, port: e.port, secure: e.secure, user: e.user, fromName: e.fromName, fromEmail: e.fromEmail, hasPass: !!e.pass, ready: emailOk(e) } : null,
    whatsapp: w ? { phoneNumberId: w.phoneNumberId, template: w.template, language: w.language, copyButton: w.copyButton, hasToken: !!w.accessToken, ready: waOk(w) } : null,
  };
}

export const emailSchema = z.object({
  host: z.string().trim().min(3).max(200),
  port: z.number().int().min(1).max(65535).default(587),
  secure: z.boolean().default(false),
  user: z.string().trim().max(200).default(''),
  /** empty = keep the saved password */
  pass: z.string().max(500).default(''),
  fromName: z.string().trim().max(100).default('Kaarobarly'),
  fromEmail: z.string().trim().email('Enter the sender email'),
});
export function saveEmail(db: Db, body: z.infer<typeof emailSchema>) {
  const cur = read<EmailSettings>(db, 'email');
  write(db, 'email', { ...body, pass: body.pass || cur?.pass || '' });
  transport = null;
  return integrations(db);
}

export const whatsappSchema = z.object({
  phoneNumberId: z.string().trim().regex(/^\d{6,30}$/, 'The phone number ID is a long number from Meta'),
  /** empty = keep the saved token */
  accessToken: z.string().trim().max(1000).default(''),
  template: z.string().trim().regex(/^[a-z0-9_]{1,512}$/, 'Template names are lowercase with underscores'),
  language: z.string().trim().min(2).max(10).default('en'),
  copyButton: z.boolean().default(true),
});
export function saveWhatsApp(db: Db, body: z.infer<typeof whatsappSchema>) {
  const cur = read<WhatsAppSettings>(db, 'whatsapp');
  write(db, 'whatsapp', { ...body, accessToken: body.accessToken || cur?.accessToken || '' });
  return integrations(db);
}

// ================================================================ sending

let transport: nodemailer.Transporter | null = null;

export async function sendEmail(db: Db, to: string, subject: string, text: string, html?: string) {
  const e = read<EmailSettings>(db, 'email');
  if (!emailOk(e)) throw new HttpError(503, 'Email is not set up yet.');
  // tests and local development can point at a fake mail server
  transport ??= nodemailer.createTransport({ host: e.host, port: e.port, secure: e.secure, auth: e.user ? { user: e.user, pass: e.pass } : undefined, tls: process.env.SMTP_INSECURE === '1' ? { rejectUnauthorized: false } : undefined, connectionTimeout: 10_000 });
  try {
    await transport.sendMail({ from: `"${e.fromName.replace(/"/g, '')}" <${e.fromEmail}>`, to, subject, text, html });
  } catch (err: any) {
    transport = null;
    throw new HttpError(502, `The email could not be sent: ${err?.message ?? 'mail server error'}`);
  }
}

/** Pakistani numbers written 03xx… become 923xx…; others need the country code. */
export function normalizePhone(p: string): string {
  let d = p.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('03')) d = `92${d.slice(1)}`;
  if (d.length === 10 && d.startsWith('3')) d = `92${d}`;
  return d;
}

export async function sendWhatsAppCode(db: Db, phone: string, code: string) {
  const w = read<WhatsAppSettings>(db, 'whatsapp');
  if (!waOk(w)) throw new HttpError(503, 'WhatsApp is not set up yet.');
  const to = normalizePhone(phone);
  if (to.length < 10) throw new HttpError(422, 'Enter the WhatsApp number with the country code.');
  const components: object[] = [{ type: 'body', parameters: [{ type: 'text', text: code }] }];
  if (w.copyButton) components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] });
  const base = process.env.WHATSAPP_API_URL || 'https://graph.facebook.com/v21.0';
  const res = await fetch(`${base}/${w.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${w.accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'template', template: { name: w.template, language: { code: w.language }, components } }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res?.ok) {
    const j: any = res ? await res.json().catch(() => ({})) : {};
    throw new HttpError(502, `WhatsApp could not send the code${j?.error?.message ? `: ${j.error.message}` : ''}.`);
  }
}

// ================================================================ one-time codes

export type CodePurpose = 'verify' | 'reset' | 'login';
export type Channel = 'email' | 'whatsapp';

const hash = (id: string, code: string) => createHash('sha256').update(`${id}:${code}`).digest('hex');

const subject: Record<CodePurpose, string> = { verify: 'Confirm your email', reset: 'Reset your password', login: 'Your sign-in code' };

/** Make a 6-digit code (10 minutes, 5 tries) and send it. Earlier unused codes for the same purpose stop working. */
export async function issueCode(db: Db, user: Row, purpose: CodePurpose, channel: Channel) {
  const target = channel === 'email' ? user.email : user.phone;
  if (!target) throw new HttpError(422, channel === 'whatsapp' ? 'No WhatsApp number is saved for this account.' : 'No email is saved for this account.');
  rateLimit(`code:${channel}:${target}`, 5, 60 * 60_000);
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const id = uid();
  db.run("update auth_code set used_at = ? where user_id = ? and purpose = ? and used_at is null", now(), user.id, purpose);
  db.run('insert into auth_code (id, user_id, purpose, channel, target, code_hash, attempts, expires_at, created_at) values (?,?,?,?,?,?,0,?,?)', id, user.id, purpose, channel, target, hash(id, code), new Date(Date.now() + 10 * 60_000).toISOString(), now());
  if (channel === 'email') {
    const text = `Your Kaarobarly code is ${code}\n\nIt works for 10 minutes. If you did not ask for it, you can ignore this email.`;
    const html = `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px;border-radius:16px;background:#FFF6EE"><h2 style="color:#1A1D2E;margin:0 0 8px">${subject[purpose]}</h2><p style="color:#555">Your Kaarobarly code:</p><div style="font-size:34px;font-weight:800;letter-spacing:8px;color:#FF7A2F;margin:12px 0">${code}</div><p style="color:#888;font-size:13px">It works for 10 minutes. If you did not ask for it, ignore this email.</p></div>`;
    await sendEmail(db, target, `${subject[purpose]}: ${code}`, text, html);
  } else await sendWhatsAppCode(db, target, code);
  return { sentTo: mask(target, channel) };
}

/** Check a code; on success it is used up. */
export function checkCode(db: Db, userId: string, purpose: CodePurpose, code: string) {
  const r = db.get("select * from auth_code where user_id = ? and purpose = ? and used_at is null order by created_at desc limit 1", userId, purpose);
  if (!r || r.expires_at < now()) throw new HttpError(422, 'This code has expired. Ask for a new one.');
  if (r.attempts >= 5) throw new HttpError(429, 'Too many wrong tries. Ask for a new code.');
  if (hash(r.id, code.trim()) !== r.code_hash) {
    db.run('update auth_code set attempts = attempts + 1 where id = ?', r.id);
    throw new HttpError(422, `That code is not right. ${Math.max(0, 4 - r.attempts)} tries left.`);
  }
  db.run('update auth_code set used_at = ? where id = ?', now(), r.id);
  return r as Row;
}

/** The account for an email or a WhatsApp number (null when none). */
export function findUser(db: Db, login: string): Row | undefined {
  const v = login.trim();
  if (v.includes('@')) return db.get("select * from app_user where email = ? and status = 'active'", v);
  const p = normalizePhone(v);
  return p.length >= 10 ? db.get("select * from app_user where phone = ? and status = 'active'", p) : undefined;
}

export function mask(target: string, channel: Channel) {
  if (channel === 'email') {
    const [n, d] = target.split('@');
    return `${n.slice(0, 2)}${'•'.repeat(Math.max(n.length - 2, 1))}@${d}`;
  }
  return `+${target.slice(0, 4)}•••••${target.slice(-3)}`;
}
