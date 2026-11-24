import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, PAYMENT_METHODS, formatMoney } from '../../../packages/shared/src/index';
import { balanceSheet, budgetReport, calendar, forecast } from './advanced';
import { profitLoss } from './accounts';
import { collections } from './collections';
import { now, type Db } from './core';
import { dashboard } from './domain';
import { HttpError } from './perm';
import { stockSummary } from './stock';

/**
 * AI features (server only): the assistant, bill scanning and quick entry from a sentence.
 * The SaaS owner sets one provider for the whole service in the admin area: Claude (Anthropic),
 * OpenAI or OpenRouter. Customers never see or set keys; their plan decides how much AI they get.
 */

export const AI_PROVIDERS = ['anthropic', 'openai', 'openrouter'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
const DEFAULT_MODEL: Record<AiProvider, string> = { anthropic: 'claude-opus-5-5', openai: '', openrouter: '' };
/** Claude models that accept the server-side refusal fallback. */
const FALLBACK_MODELS = ['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-fable-5-2', 'claude-fable-5-1'];

interface AiConfig {
  provider: AiProvider;
  apiKey: string;
  model: string;
}

export const aiConfigSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  /** empty keeps the key already saved */
  apiKey: z.string().trim().max(400).default(''),
  model: z.string().trim().max(120).default(''),
});

/** The one AI setup for the whole service, kept in platform_setting (never synced to phones). */
function platformRow(db: Db): { provider: AiProvider; apiKey: string; model: string; updatedBy: string; updatedAt: string } | null {
  const r = db.get("select value from platform_setting where key = 'ai'");
  if (!r) return null;
  try {
    return JSON.parse(r.value);
  } catch {
    return null;
  }
}

function storedConfig(db: Db): AiConfig | null {
  const r = platformRow(db);
  if (r?.apiKey) return { provider: r.provider, apiKey: r.apiKey, model: r.model || DEFAULT_MODEL[r.provider] };
  // a key in the server's .env works until the SaaS owner saves one in the admin area
  if (process.env.ANTHROPIC_API_KEY) return { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.AI_MODEL || DEFAULT_MODEL.anthropic };
  return null;
}

/** Whether customers can use AI at all (no details about the service). */
export const aiAvailable = (db: Db) => {
  const c = storedConfig(db);
  return !!c && !!c.model;
};

/** What the SaaS owner's AI screen shows: never the key itself. */
export function publicConfig(db: Db) {
  const r = platformRow(db);
  const effective = storedConfig(db);
  return {
    provider: (r?.provider ?? effective?.provider ?? 'anthropic') as AiProvider,
    model: r?.model || (r ? DEFAULT_MODEL[r.provider] : (effective?.model ?? DEFAULT_MODEL.anthropic)),
    hasKey: !!r?.apiKey,
    keyHint: r?.apiKey ? `…${String(r.apiKey).slice(-4)}` : '',
    serverKey: !r?.apiKey && !!process.env.ANTHROPIC_API_KEY,
    ready: !!effective && !!effective.model,
    updatedBy: r?.updatedBy ?? '',
    updatedAt: r?.updatedAt ?? '',
  };
}

export function saveConfig(db: Db, adminEmail: string, body: z.infer<typeof aiConfigSchema>) {
  const old = platformRow(db);
  const apiKey = body.apiKey || (old && old.provider === body.provider ? old.apiKey : '');
  if (body.provider !== 'anthropic' && !body.model) throw new HttpError(422, 'Enter the model name for this provider.');
  const value = JSON.stringify({ provider: body.provider, apiKey, model: body.model, updatedBy: adminEmail, updatedAt: now() });
  db.run("insert into platform_setting (key, value, updated_at) values ('ai', ?, ?) on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at", value, now());
  return publicConfig(db);
}

// ---------------------------------------------------------------- one call, any provider

interface Ask {
  system: string;
  text: string;
  /** data URI of a photo to read */
  image?: string;
  /** JSON schema the answer must follow */
  schema?: Record<string, unknown>;
  effort?: 'low' | 'medium' | 'high';
}

function splitDataUri(uri: string): { mediaType: string; data: string } {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/s.exec(uri);
  if (!m) throw new HttpError(422, 'Send the photo as a JPEG, PNG or WebP image.');
  return { mediaType: m[1], data: m[2] };
}

async function callClaude(cfg: AiConfig, a: Ask): Promise<string> {
  const client = new Anthropic({ apiKey: cfg.apiKey, timeout: 120_000, maxRetries: 2 });
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (a.image) {
    const { mediaType, data } = splitDataUri(a.image);
    content.push({ type: 'image', source: { type: 'base64', media_type: mediaType as 'image/jpeg', data } });
  }
  content.push({ type: 'text', text: a.text });
  const fallback = FALLBACK_MODELS.includes(cfg.model);
  try {
    const res = await client.beta.messages.create({
      model: cfg.model,
      max_tokens: 16000,
      system: a.system,
      messages: [{ role: 'user', content }],
      output_config: { effort: a.effort ?? 'medium', ...(a.schema ? { format: { type: 'json_schema', schema: a.schema } } : {}) },
      ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    });
    if (res.stop_reason === 'refusal') throw new HttpError(422, 'The AI declined this request. Try rewording it.');
    if (res.stop_reason === 'max_tokens') throw new HttpError(502, 'The answer was too long. Ask something narrower.');
    return res.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new HttpError(422, 'The Claude API key was refused. Check it in AI settings.');
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, 'The AI is busy (rate limit). Try again in a minute.');
    if (e instanceof Anthropic.BadRequestError) throw new HttpError(422, `The AI could not take this request: ${e.message}`);
    if (e instanceof Anthropic.APIError) throw new HttpError(502, `The AI service failed (${e.status ?? 'network'}). Try again.`);
    throw e;
  }
}

/** OpenAI and OpenRouter share the chat-completions format. */
async function callChatCompletions(cfg: AiConfig, a: Ask): Promise<string> {
  const base = cfg.provider === 'openai' ? 'https://api.openai.com/v1' : 'https://openrouter.ai/api/v1';
  const userContent: unknown[] = [{ type: 'text', text: a.text }];
  if (a.image) {
    splitDataUri(a.image);
    userContent.unshift({ type: 'image_url', image_url: { url: a.image } });
  }
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: [
      { role: 'system', content: a.system },
      { role: 'user', content: userContent },
    ],
  };
  if (a.schema) body.response_format = { type: 'json_schema', json_schema: { name: 'result', schema: a.schema, strict: true } };
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}`, ...(cfg.provider === 'openrouter' ? { 'X-Title': 'Kaarobarly' } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  }).catch(() => {
    throw new HttpError(502, 'Could not reach the AI service.');
  });
  const json = (await res.json().catch(() => null)) as any;
  if (res.status === 401 || res.status === 403) throw new HttpError(422, 'The API key was refused. Check it in AI settings.');
  if (res.status === 429) throw new HttpError(429, 'The AI is busy (rate limit). Try again in a minute.');
  if (!res.ok) throw new HttpError(502, `The AI service failed: ${json?.error?.message ?? res.status}`);
  return String(json?.choices?.[0]?.message?.content ?? '').trim();
}

async function complete(db: Db, _tenantId: string, a: Ask): Promise<string> {
  const cfg = storedConfig(db);
  if (!cfg || !cfg.model) throw new HttpError(503, 'AI is not available right now. Please try again later.');
  return cfg.provider === 'anthropic' ? callClaude(cfg, a) : callChatCompletions(cfg, a);
}

function parseJson<T>(text: string): T {
  // some providers wrap JSON in a code fence even when asked not to
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new HttpError(502, 'The AI answer could not be read. Try again.');
  }
}

// ---------------------------------------------------------------- assistant

/** A plain-text picture of the business today, so answers come from real numbers. */
export function businessBrief(db: Db, tenantId: string): string {
  const biz = db.get('select * from business where tenant_id = ? order by created_at limit 1', tenantId);
  if (!biz) return 'No business profile yet.';
  const m = (v: number) => formatMoney(v, biz.currency, biz.currency_precision);
  const t = new Date().toISOString().slice(0, 10);
  const monthStart = `${t.slice(0, 7)}-01`;
  const lines: string[] = [`Business: ${biz.trading_name || biz.legal_name}. Today: ${t}. Currency: ${biz.currency}.`];
  const d = dashboard(db, tenantId, {});
  lines.push(`All time: invoiced ${m(d.totalInvoiced)}, received ${m(d.totalReceived)}, outstanding ${m(d.outstanding)}, overdue ${m(d.overdue)}.`);
  const pl = profitLoss(db, tenantId, { from: monthStart, to: t, basis: 'accrual' });
  lines.push(`This month (${monthStart} to ${t}): income ${m(pl.totalIncome)}, expenses ${m(pl.totalExpenses)}, profit ${m(pl.netProfit)}.`);
  if (pl.expenses.length) lines.push(`Biggest costs this month: ${pl.expenses.slice(0, 6).map((e) => `${e.label} ${m(e.amount)}`).join('; ')}.`);
  const bs = balanceSheet(db, tenantId, biz.id);
  lines.push(`Balance sheet: assets ${bs.assets.map((a) => `${a.label} ${m(a.amount)}`).join('; ')}. Liabilities ${bs.liabilities.map((a) => `${a.label} ${m(a.amount)}`).join('; ') || 'none'}. Net worth ${m(bs.equity)}.`);
  const owing = collections(db, tenantId).slice(0, 10);
  if (owing.length) lines.push(`Who owes most: ${owing.map((c) => `${c.clientName} ${m(c.outstanding)}${c.daysOverdue ? ` (${c.daysOverdue} days late)` : ''}`).join('; ')}.`);
  const f = forecast(db, tenantId, biz.id, 30);
  lines.push(`Cash now ${m(f.opening)}; expected in 30 days ${m(f.weeks[f.weeks.length - 1]?.closing ?? f.opening)}; lowest ${m(f.lowest.balance)} around ${f.lowest.date}.`);
  const due = calendar(db, tenantId, biz.id, t, new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10)).filter((e) => !e.overdue).slice(0, 12);
  if (due.length) lines.push(`Due in the next 14 days: ${due.map((e) => `${e.date} ${e.direction === 'in' ? 'collect' : 'pay'} ${m(e.amount)} ${e.party}`).join('; ')}.`);
  const stock = stockSummary(db, tenantId);
  if (stock.items.length) {
    lines.push(`Stock value ${m(stock.totalValue)}; ${stock.lowCount} items low, ${stock.outCount} out of stock.`);
    const low = stock.items.filter((i) => i.low).slice(0, 10);
    if (low.length) lines.push(`Low or out: ${low.map((i) => `${i.name} ${i.onHand / 1000} ${i.unit}`).join('; ')}.`);
  }
  const budget = budgetReport(db, tenantId, biz.id, t.slice(0, 7));
  if (budget.lines.length) lines.push(`Budget this month: ${budget.lines.map((l) => `${l.category} spent ${m(l.actual)} of ${m(l.budget)}`).join('; ')}.`);
  return lines.join('\n');
}

const ASSISTANT_SYSTEM = `You are the assistant inside Kaarobarly, a business app for small and medium businesses in Pakistan.
Answer questions about this business using only the figures in the business summary you are given. If the summary does not contain what is needed, say what is missing and where in the app to look.
Keep answers short and practical: a direct answer first, then at most a few bullet points. Use the business's currency formatting as given.
Reply in the language of the question: English, Urdu, or Roman Urdu.
You cannot change records; when the user wants something done, tell them which screen to use.`;

export async function ask(db: Db, tenantId: string, question: string): Promise<string> {
  const brief = businessBrief(db, tenantId);
  return complete(db, tenantId, { system: ASSISTANT_SYSTEM, text: `Business summary:\n${brief}\n\nQuestion: ${question}`, effort: 'medium' });
}

// ---------------------------------------------------------------- bill scanning

const BILL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['supplier', 'billNo', 'date', 'currency', 'total', 'lines'],
  properties: {
    supplier: { type: 'string', description: 'Seller / shop name as printed, empty if not visible' },
    billNo: { type: 'string', description: 'Bill or invoice number, empty if none' },
    date: { type: 'string', description: 'Bill date as YYYY-MM-DD, empty if not readable' },
    currency: { type: 'string', description: 'Three-letter currency code, PKR if unclear' },
    total: { type: 'number', description: 'Grand total in normal units (e.g. 1250.50), 0 if not readable' },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'qty', 'unit', 'unitPrice'],
        properties: {
          name: { type: 'string' },
          qty: { type: 'number' },
          unit: { type: 'string', description: 'kg, pcs, bag… or empty' },
          unitPrice: { type: 'number', description: 'Price for one unit in normal units' },
        },
      },
    },
  },
};

export interface ScannedBill {
  supplier: string;
  billNo: string;
  date: string;
  currency: string;
  total: number;
  lines: { name: string; qty: number; unit: string; unitPrice: number }[];
}

export async function scanBill(db: Db, tenantId: string, image: string): Promise<ScannedBill> {
  const text = await complete(db, tenantId, {
    system: 'You read photos of purchase bills, receipts and invoices and copy their details exactly. Never invent values: use empty strings or 0 for anything you cannot read. If line items are unreadable but the total is clear, return one line named after the purchase with qty 1 and the total as its price.',
    text: 'Read this bill.',
    image,
    schema: BILL_SCHEMA,
    effort: 'low',
  });
  const bill = parseJson<ScannedBill>(text);
  bill.lines = (bill.lines ?? []).filter((l) => l.name && l.qty > 0);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bill.date ?? '')) bill.date = '';
  return bill;
}

// ---------------------------------------------------------------- product photo to catalogue item

const PRODUCT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'category', 'barcode', 'unit', 'description'],
  properties: {
    name: { type: 'string', description: 'Product name as sold, with brand and size, e.g. "Olpers Milk 1L"' },
    category: { type: 'string', description: 'A short shop category such as Dairy, Snacks, Beverages, Personal care' },
    barcode: { type: 'string', description: 'Digits of the barcode if clearly readable, else empty' },
    unit: { type: 'string', description: 'pcs, pack, kg, litre, box …' },
    description: { type: 'string', description: 'One short line, or empty' },
  },
};

export interface ScannedProduct {
  name: string;
  category: string;
  barcode: string;
  unit: string;
  description: string;
}

/** Read a photo of a product or its pack and suggest the catalogue entry. Nothing is saved. */
export async function scanProduct(db: Db, tenantId: string, image: string): Promise<ScannedProduct> {
  const cats = db.all("select distinct category from service where tenant_id = ? and category <> '' limit 40", tenantId).map((r) => r.category as string);
  const text = await complete(db, tenantId, {
    system: `You read product photos for a shop's catalogue. Copy what is printed; never invent a barcode.${cats.length ? ` Prefer one of these existing categories when it fits: ${cats.join(', ')}.` : ''}`,
    text: 'What product is this?',
    image,
    schema: PRODUCT_SCHEMA,
    effort: 'low',
  });
  const p = parseJson<ScannedProduct>(text);
  if (!/^\d{8,14}$/.test(p.barcode ?? '')) p.barcode = '';
  return p;
}

// ---------------------------------------------------------------- quick entry from a sentence

const ENTRY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'amount', 'party', 'category', 'method', 'date', 'note'],
  properties: {
    kind: { type: 'string', enum: ['payment', 'expense', 'income', 'none'], description: 'payment = money received from a client/customer against what they owe' },
    amount: { type: 'number', description: 'Amount in normal units, e.g. 5000' },
    party: { type: 'string', description: 'Client, supplier or person named, as written' },
    category: { type: 'string', description: 'For expense or income: one of the allowed categories' },
    method: { type: 'string', enum: [...PAYMENT_METHODS] },
    date: { type: 'string', description: 'YYYY-MM-DD; today when not said' },
    note: { type: 'string' },
  },
};

export interface ParsedEntry {
  kind: 'payment' | 'expense' | 'income' | 'none';
  amount: number;
  party: string;
  category: string;
  method: (typeof PAYMENT_METHODS)[number];
  date: string;
  note: string;
}

export async function parseEntry(db: Db, tenantId: string, sentence: string): Promise<ParsedEntry> {
  const t = new Date().toISOString().slice(0, 10);
  const clients = db.all("select name from client where tenant_id = ? and status = 'active' order by name limit 300", tenantId).map((r) => r.name);
  const text = await complete(db, tenantId, {
    system: `You turn one sentence (English, Urdu or Roman Urdu, often dictated) into one money record for a business app. Today is ${t}.
"Received / mila / wusool" from a client is a payment; spending is an expense; other money coming in is income. Use kind "none" if the sentence is not a money record.
Expense categories: ${EXPENSE_CATEGORIES.join(', ')}. Income categories: ${INCOME_CATEGORIES.join(', ')}.
Known clients (match spelling when one is clearly meant): ${clients.join(', ') || 'none'}.
Methods: cash unless a bank, cheque, Easypaisa, JazzCash or card is mentioned.`,
    text: sentence,
    schema: ENTRY_SCHEMA,
    effort: 'low',
  });
  const e = parseJson<ParsedEntry>(text);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date ?? '')) e.date = t;
  if (!PAYMENT_METHODS.includes(e.method)) e.method = 'cash';
  return e;
}

export async function testConnection(db: Db, tenantId: string): Promise<string> {
  return complete(db, tenantId, { system: 'Reply with exactly: OK', text: 'Say OK.', effort: 'low' });
}
