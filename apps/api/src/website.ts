import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { PLANS, PLAN_IDS } from '../../../packages/shared/src/index';
import { trialSettings } from './saas';
import { now, uid, type Db } from './core';
import { HttpError } from './perm';

/**
 * The public Tijar website (served at "/"). The SaaS owner edits every word, link and section
 * from the app (SaaS admin → Website); visitors' contact requests land in Leads.
 */

export const SITE_DIR = resolve(import.meta.dirname, '../site');

const text = (max: number) => z.string().trim().max(max).default('');
/** Links: site paths, anchors, http(s), mailto and tel only (no javascript: and friends). */
const link = z
  .string()
  .trim()
  .max(500)
  .default('')
  .refine((v) => v === '' || /^(https?:\/\/|mailto:|tel:|\/|#)/i.test(v), 'Links must start with https://, /, #, mailto: or tel:');
const cta = z.object({ label: text(40), href: link });

export const ICONS = ['invoice', 'pos', 'stock', 'chart', 'team', 'cloud', 'shield', 'ai', 'print', 'whatsapp', 'shop', 'bell', 'wallet', 'globe', 'bolt', 'heart'] as const;

export const siteSchema = z.object({
  seo: z.object({ title: text(90), description: text(300) }),
  announcement: z.object({ show: z.boolean().default(false), text: text(140), href: link }),
  hero: z.object({ eyebrow: text(60), title: text(80), highlight: text(60), subtitle: text(300), primary: cta, secondary: cta }),
  stats: z.array(z.object({ value: text(20), label: text(40) })).max(6),
  features: z.array(z.object({ icon: z.enum(ICONS).default('bolt'), title: text(60), text: text(240) })).max(12),
  businessTypes: z.array(z.object({ name: text(40), text: text(140) })).max(12),
  steps: z.array(z.object({ title: text(60), text: text(200) })).max(5),
  pricing: z.object({ title: text(80), subtitle: text(200), note: text(200), highlight: z.enum(PLAN_IDS).default('pro') }),
  testimonials: z.array(z.object({ name: text(60), role: text(80), quote: text(400) })).max(12),
  faq: z.array(z.object({ q: text(160), a: text(800) })).max(20),
  download: z.object({ title: text(80), subtitle: text(200), android: link, windows: link, web: link }),
  contact: z.object({ title: text(80), subtitle: text(200), email: text(120), phone: text(40), whatsapp: text(40), address: text(200) }),
  social: z.object({ facebook: link, instagram: link, linkedin: link, youtube: link, x: link, tiktok: link }),
  sections: z.object({
    stats: z.boolean().default(true),
    features: z.boolean().default(true),
    showcase: z.boolean().default(true),
    businessTypes: z.boolean().default(true),
    steps: z.boolean().default(true),
    pricing: z.boolean().default(true),
    testimonials: z.boolean().default(true),
    faq: z.boolean().default(true),
    download: z.boolean().default(true),
    contact: z.boolean().default(true),
  }),
});
export type SiteContent = z.infer<typeof siteSchema>;

export const DEFAULT_SITE: SiteContent = {
  seo: {
    title: 'Tijar · Every Business Move, Made Smarter',
    description: 'Invoices, point of sale, stock, payments, staff and reports in one app for Pakistani businesses. Works offline, prints to any printer, and grows with you.',
  },
  announcement: { show: true, text: `New: restaurant POS, loyalty and Bluetooth label printing. Try Pro free for {trialDays} days.`, href: '#pricing' },
  hero: {
    eyebrow: 'Business app for Pakistan',
    title: 'Every business move,',
    highlight: 'made smarter.',
    subtitle: 'Bill customers, run the counter, track stock and staff, and see your profit, all in one app that keeps working without internet.',
    primary: { label: 'Start free trial', href: '#signup' },
    secondary: { label: 'See features', href: '#features' },
  },
  stats: [
    { value: '30+', label: 'Modules in one app' },
    { value: '100%', label: 'Works offline' },
    { value: '2', label: 'Languages: English and Urdu' },
    { value: '{trialDays} days', label: 'Free Pro trial' },
  ],
  features: [
    { icon: 'invoice', title: 'Invoices and quotations', text: 'Professional invoices, quotes and receipts with your logo. Share as PDF or WhatsApp in a tap.' },
    { icon: 'pos', title: 'Point of sale', text: 'Scan, bill and print at the counter. Shifts, cash drawer, holds, returns and split payments.' },
    { icon: 'stock', title: 'Stock that counts itself', text: 'Batches, expiry, reorder slips, stock counts and alerts before you run out.' },
    { icon: 'wallet', title: 'Payments and collections', text: 'Installments, cheques, reminders and a client portal so customers can see and pay what they owe.' },
    { icon: 'team', title: 'Staff and payroll', text: 'Attendance by QR, commissions, payroll runs and roles that control who sees what.' },
    { icon: 'chart', title: 'Reports and profit', text: 'Profit and loss, tax summaries, cash book and insights that spot anything unusual.' },
    { icon: 'print', title: 'Print anywhere', text: 'Thermal receipts, kitchen tickets and barcode labels over Bluetooth, USB or Windows printers.' },
    { icon: 'ai', title: 'Smart assistant', text: 'Type “paid 3,500 for petrol” and Tijar fills in the record. Ask questions in English or Urdu.' },
    { icon: 'cloud', title: 'Offline first, synced', text: 'Keep selling when the internet drops. Everything syncs safely when you are back online.' },
  ],
  businessTypes: [
    { name: 'Retail shops', text: 'Grocery, pharmacy, garments, electronics' },
    { name: 'Restaurants', text: 'Tables, kitchen tickets, deals and delivery' },
    { name: 'Wholesale', text: 'Routes, credit limits and bulk orders' },
    { name: 'Services', text: 'Salons, clinics, repairs and appointments' },
    { name: 'Manufacturing', text: 'Raw material, recipes and finished goods' },
    { name: 'Freelancers', text: 'Projects, quotes and recurring invoices' },
  ],
  steps: [
    { title: 'Create your account', text: 'Sign up in a minute with email or WhatsApp. No card needed.' },
    { title: 'Pick your business type', text: 'Tijar switches on the right modules and uses your words.' },
    { title: 'Sell, track and grow', text: 'Bill your first customer today and watch the reports fill in.' },
  ],
  pricing: { title: 'Simple plans that grow with you', subtitle: 'Start with {trialDays} days of Pro, free. Change plans any time.', note: 'Prices in Pakistani rupees per month.', highlight: 'pro' },
  testimonials: [
    { name: 'Ahmed R.', role: 'Grocery store, Lahore', quote: 'Billing at the counter went from minutes to seconds, and I finally know my real profit every evening.' },
    { name: 'Sana K.', role: 'Boutique owner, Karachi', quote: 'Stock alerts and WhatsApp invoices changed how we work. My staff learned it in one day.' },
    { name: 'Bilal M.', role: 'Restaurant, Islamabad', quote: 'Kitchen tickets print by themselves and the tables screen keeps everyone in sync.' },
  ],
  faq: [
    { q: 'Does Tijar work without internet?', a: 'Yes. The app keeps working offline on your phone or computer and syncs automatically when you are back online.' },
    { q: 'Which printers can I use?', a: 'Bluetooth thermal and label printers (ESC/POS, TSPL, ZPL), and any printer on Windows through the desktop app.' },
    { q: 'Is my data safe?', a: 'Your data is stored on secure servers with daily backups. Each business only ever sees its own records.' },
    { q: 'Can I use it in Urdu?', a: 'Yes, you can switch between English and Urdu at any time.' },
    { q: 'How do I pay for a plan?', a: 'Choose a plan inside the app and pay by bank transfer, JazzCash or Easypaisa. We switch it on as soon as payment arrives.' },
  ],
  download: { title: 'Get Tijar on every screen', subtitle: 'Android phone, Windows counter and the web, all with the same account.', android: '', windows: '', web: '' },
  contact: { title: 'Talk to us', subtitle: 'Want a demo, or help moving from another system? Leave your details and we will call you.', email: '', phone: '', whatsapp: '', address: '' },
  social: { facebook: '', instagram: '', linkedin: '', youtube: '', x: '', tiktok: '' },
  sections: { stats: true, features: true, showcase: true, businessTypes: true, steps: true, pricing: true, testimonials: true, faq: true, download: true, contact: true },
};

// ---------------------------------------------------------------- content

export function getSite(db: Db): SiteContent {
  const r = db.get("select value from platform_setting where key = 'site'");
  if (!r) return DEFAULT_SITE;
  try {
    // fill in anything added to the schema since it was saved
    return siteSchema.parse({ ...DEFAULT_SITE, ...JSON.parse(r.value) });
  } catch {
    return DEFAULT_SITE;
  }
}

export function saveSite(db: Db, body: unknown): SiteContent {
  const c = siteSchema.parse(body);
  db.run("insert into platform_setting (key, value, updated_at) values ('site', ?, ?) on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at", JSON.stringify(c), now());
  return c;
}

export function resetSite(db: Db): SiteContent {
  db.run("delete from platform_setting where key = 'site'");
  return DEFAULT_SITE;
}

/** What the page needs: the editable content plus the live plan prices. */
export function publicContent(db: Db) {
  const trialDays = trialSettings(db).days;
  // "{trialDays}" anywhere in the words becomes the trial length the owner set
  const site = JSON.parse(JSON.stringify(getSite(db)).replace(/\{trialDays\}/g, String(trialDays))) as SiteContent;
  return {
    ...site,
    plans: PLAN_IDS.map((id) => ({ id, name: PLANS[id].name, price: PLANS[id].price, hint: PLANS[id].hint, limits: PLANS[id].limits })),
    trialDays,
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

let template: string | null = null;
/** Changes whenever the script or styles change, so browsers fetch the new files. */
const assetVersion = () => ['site.js', 'site.css'].map((f) => Math.round(statSync(resolve(SITE_DIR, 'assets', f)).mtimeMs).toString(36)).join('');
/** The page with its title, description and content filled in (so it also reads well without JavaScript and for search engines). */
export function sitePage(db: Db, origin: string): string {
  if (!template || process.env.NODE_ENV !== 'production') template = readFileSync(resolve(SITE_DIR, 'index.html'), 'utf8');
  const c = publicContent(db);
  return template
    .replaceAll('{{TITLE}}', esc(c.seo.title))
    .replaceAll('{{DESCRIPTION}}', esc(c.seo.description))
    .replaceAll('{{ORIGIN}}', esc(origin))
    .replaceAll('{{V}}', assetVersion())
    .replace('{{CONTENT}}', JSON.stringify(c).replace(/</g, '\\u003c'));
}

// ---------------------------------------------------------------- leads

export const leadSchema = z.object({
  name: z.string().trim().min(2, 'Please enter your name').max(80),
  business: text(120),
  phone: text(40),
  email: z.union([z.literal(''), z.string().trim().email('That email does not look right').max(120)]).default(''),
  plan: text(20),
  message: text(1000),
  /** honeypot: people never fill it */
  website: z.string().max(200).optional(),
});

const recent = new Map<string, number[]>();
/** Save a contact request. A few per visitor every 10 minutes; bots that fill the hidden field are ignored. */
export function addLead(db: Db, body: unknown, ip: string) {
  const b = leadSchema.parse(body);
  if (!b.phone && !b.email) throw new HttpError(422, 'Enter a phone number or an email so we can reach you.');
  if (b.website) return { ok: true };
  const t = Date.now();
  const hits = (recent.get(ip) ?? []).filter((x) => t - x < 10 * 60_000);
  if (hits.length >= 5) throw new HttpError(429, 'Thanks, we already have your details. Please try again a little later.');
  recent.set(ip, [...hits, t]);
  const id = uid();
  db.run('insert into site_lead (id, name, business, phone, email, plan, message, status, ip, created_at) values (?,?,?,?,?,?,?,?,?,?)', id, b.name, b.business, b.phone, b.email, b.plan, b.message, 'new', ip, now());
  return { ok: true, id };
}

export const leadStatusSchema = z.object({ status: z.enum(['new', 'contacted', 'won', 'closed']) });

export function listLeads(db: Db, status?: string) {
  const rows = status ? db.all('select * from site_lead where status = ? order by created_at desc limit 500', status) : db.all('select * from site_lead order by created_at desc limit 500');
  const counts = Object.fromEntries(db.all('select status, count(*) as n from site_lead group by status').map((r) => [r.status, r.n]));
  return {
    leads: rows.map((r) => ({ id: r.id, name: r.name, business: r.business, phone: r.phone, email: r.email, plan: r.plan, message: r.message, status: r.status, createdAt: r.created_at })),
    counts,
  };
}

export function setLeadStatus(db: Db, id: string, status: string) {
  if (!db.get('select 1 from site_lead where id = ?', id)) throw new HttpError(404, 'Lead not found');
  db.run('update site_lead set status = ? where id = ?', status, id);
  return { ok: true };
}

export function deleteLead(db: Db, id: string) {
  db.run('delete from site_lead where id = ?', id);
  return { ok: true };
}
