import { z } from 'zod';
import { PLANS, PLAN_IDS, TRIAL_DAYS, effectivePlan, type PlanId, type PlanState } from '../../../packages/shared/src/index';
import { now, today, uid, type Db } from './core';
import { HttpError, type AuthContext } from './perm';

/**
 * Subscriptions: each account (tenant) has a plan with limits. New accounts get a free
 * Pro trial; when a trial or paid period ends the account falls back to Free, keeping
 * all its data (only adding more is limited). Accounts that existed before plans
 * ('legacy') keep Business limits.
 */

const month = () => today().slice(0, 7);

function stored(db: Db, tenantId: string) {
  const t = db.get('select plan, trial_ends_at, paid_until from tenant where id = ?', tenantId);
  return { chosen: (t?.plan ?? 'legacy') as string, trialEndsAt: t?.trial_ends_at || null, paidUntil: t?.paid_until || null };
}

export function currentPlan(db: Db, tenantId: string): { plan: PlanId; daysLeft: number | null; chosen: string; trialEndsAt: string | null; paidUntil: string | null } {
  const s = stored(db, tenantId);
  if (s.chosen === 'legacy') return { ...s, plan: 'business', daysLeft: null };
  return { ...s, ...effectivePlan(s.chosen, s.trialEndsAt, s.paidUntil, today()) };
}

export function usage(db: Db, tenantId: string) {
  const m = month();
  return {
    users: db.get("select count(*) as n from app_user where tenant_id = ? and status = 'active'", tenantId)?.n ?? 0,
    businesses: db.get("select count(*) as n from business where tenant_id = ? and status = 'active'", tenantId)!.n,
    invoicesThisMonth: db.get("select count(*) as n from invoice where tenant_id = ? and status <> 'draft' and substr(coalesce(finalized_at, created_at), 1, 7) = ?", tenantId, m)!.n,
    aiThisMonth: db.get('select coalesce(sum(count), 0) as n from ai_usage where tenant_id = ? and month = ?', tenantId, m)?.n ?? 0,
  };
}

export function planState(db: Db, tenantId: string): PlanState {
  const c = currentPlan(db, tenantId);
  return { plan: c.plan, chosen: c.chosen === 'legacy' ? 'business' : (c.chosen as PlanId | 'trial'), trialEndsAt: c.trialEndsAt, paidUntil: c.paidUntil, daysLeft: c.daysLeft, limits: PLANS[c.plan].limits, usage: usage(db, tenantId) };
}

const LIMIT_TEXT = {
  business: (n: number) => `Your plan allows ${n} business profile${n === 1 ? '' : 's'}.`,
  user: (n: number) => `Your plan allows ${n} ${n === 1 ? 'person' : 'people'} on the account.`,
  invoice: (n: number) => `Your plan allows ${n} invoices a month. This month's limit is reached.`,
  ai: (n: number) => (n ? `Your plan allows ${n} AI requests a month. This month's limit is reached.` : 'AI is not included in the Free plan.'),
  payroll: () => 'Payroll is part of the Pro and Business plans.',
};

/** Refuse an action the plan does not allow (402 so apps can offer an upgrade). */
export function assertLimit(db: Db, tenantId: string, kind: keyof typeof LIMIT_TEXT) {
  const { plan } = currentPlan(db, tenantId);
  const l = PLANS[plan].limits;
  const u = usage(db, tenantId);
  const over =
    kind === 'business' ? u.businesses >= l.businesses
    : kind === 'user' ? u.users >= l.users
    : kind === 'invoice' ? u.invoicesThisMonth >= l.invoicesPerMonth
    : kind === 'ai' ? u.aiThisMonth >= l.aiPerMonth
    : !l.payroll;
  if (over) {
    const n = kind === 'business' ? l.businesses : kind === 'user' ? l.users : kind === 'invoice' ? l.invoicesPerMonth : kind === 'ai' ? l.aiPerMonth : 0;
    throw new HttpError(402, `${LIMIT_TEXT[kind](n)} Upgrade in More › Plan & usage.`);
  }
}

export function countAi(db: Db, tenantId: string) {
  db.run('insert into ai_usage (tenant_id, month, count) values (?,?,1) on conflict (tenant_id, month) do update set count = count + 1', tenantId, month());
}

/** How long new accounts try Pro for free; set by the SaaS owner. 0 = no trial, start on Free. */
export const trialSchema = z.object({ days: z.number().int().min(0).max(365) });
export function trialSettings(db: Db): { days: number } {
  const r = db.get("select value from platform_setting where key = 'trial'");
  try {
    return r ? trialSchema.parse(JSON.parse(r.value)) : { days: TRIAL_DAYS };
  } catch {
    return { days: TRIAL_DAYS };
  }
}
export function saveTrialSettings(db: Db, body: z.infer<typeof trialSchema>) {
  db.run("insert into platform_setting (key, value, updated_at) values ('trial', ?, ?) on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at", JSON.stringify(body), now());
  return trialSettings(db);
}

/** New accounts start a free Pro trial of the length the owner set (or on Free when it is 0). */
export function startTrial(db: Db, tenantId: string) {
  const { days } = trialSettings(db);
  if (days <= 0) {
    db.run("update tenant set plan = 'free', trial_ends_at = null where id = ?", tenantId);
    return;
  }
  const ends = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  db.run("update tenant set plan = 'trial', trial_ends_at = ? where id = ?", ends, tenantId);
}

// ---------------------------------------------------------------- upgrade requests

export const requestSchema = z.object({ plan: z.enum(PLAN_IDS), note: z.string().trim().max(1000).default(''), phone: z.string().trim().max(50).default('') });

export function requestUpgrade(db: Db, auth: AuthContext, body: z.infer<typeof requestSchema>) {
  const id = uid();
  db.run("insert into plan_request (id, tenant_id, plan, note, phone, by_name, status, created_at) values (?,?,?,?,?,?,'open',?)", id, auth.tenantId, body.plan, body.note, body.phone, auth.name, now());
  db.audit(auth.tenantId, auth.userId, 'plan.request', 'tenant', auth.tenantId, { plan: body.plan });
  return { id, plan: body.plan, status: 'open' };
}

export function openRequest(db: Db, tenantId: string) {
  return db.get("select id, plan, created_at from plan_request where tenant_id = ? and status = 'open' order by created_at desc limit 1", tenantId) ?? null;
}

// ---------------------------------------------------------------- platform admin (the people running Tijar)

export const isPlatformAdmin = (email: string) =>
  (process.env.PLATFORM_ADMINS ?? '')
    .split(',')
    .map((s: string) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());

export function listTenants(db: Db) {
  return db.all('select * from tenant order by created_at desc limit 1000').map((t) => {
    const owner = db.get("select name, email from app_user where tenant_id = ? and role = 'owner' order by created_at limit 1", t.id);
    const last = db.get('select max(last_used_at) as at from auth_session where tenant_id = ?', t.id)?.at ?? null;
    const state = planState(db, t.id);
    return {
      id: t.id,
      name: t.name,
      ownerName: owner?.name ?? '',
      ownerEmail: owner?.email ?? '',
      createdAt: t.created_at,
      lastActive: last,
      ...state,
      invoicesTotal: db.get('select count(*) as n from invoice where tenant_id = ?', t.id)!.n,
      request: openRequest(db, t.id),
    };
  });
}

export const setPlanSchema = z.object({
  plan: z.enum([...PLAN_IDS, 'trial'] as [string, ...string[]]),
  /** paid plans: paid until this date */
  paidUntil: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).default(''),
  /** trial: number of days from today */
  trialDays: z.number().int().min(1).max(365).default(TRIAL_DAYS),
});

export function setPlan(db: Db, adminEmail: string, tenantId: string, body: z.infer<typeof setPlanSchema>) {
  if (!db.get('select 1 from tenant where id = ?', tenantId)) throw new HttpError(404, 'Account not found.');
  if (body.plan !== 'trial' && body.plan !== 'free' && !body.paidUntil) throw new HttpError(422, 'Enter the date the plan is paid until.');
  const trialEnds = body.plan === 'trial' ? new Date(Date.now() + body.trialDays * 86_400_000).toISOString().slice(0, 10) : null;
  db.run('update tenant set plan = ?, trial_ends_at = coalesce(?, trial_ends_at), paid_until = ? where id = ?', body.plan, trialEnds, body.plan === 'trial' || body.plan === 'free' ? null : body.paidUntil, tenantId);
  db.run("update plan_request set status = 'done' where tenant_id = ? and status = 'open'", tenantId);
  db.audit(tenantId, null, 'plan.set', 'tenant', tenantId, { by: adminEmail, ...body });
  return planState(db, tenantId);
}

/** Figures for the SaaS owner's dashboard. */
export function platformOverview(db: Db) {
  const m = month();
  const tenants = db.all('select id, created_at from tenant');
  const byPlan: Record<string, number> = { free: 0, starter: 0, pro: 0, business: 0 };
  let trials = 0;
  let paying = 0;
  let mrr = 0;
  for (const t of tenants) {
    const c = currentPlan(db, t.id);
    byPlan[c.plan] = (byPlan[c.plan] ?? 0) + 1;
    if (c.chosen === 'trial' && c.plan !== 'free') trials++;
    if (c.chosen !== 'trial' && c.chosen !== 'legacy' && c.plan !== 'free') {
      paying++;
      mrr += PLANS[c.plan].price;
    }
  }
  return {
    accounts: tenants.length,
    newThisMonth: tenants.filter((t) => String(t.created_at).slice(0, 7) === m).length,
    byPlan,
    trials,
    paying,
    /** monthly revenue from paid plans, PKR minor units */
    mrr,
    openRequests: db.get("select count(*) as n from plan_request where status = 'open'")!.n,
    invoicesThisMonth: db.get("select count(*) as n from invoice where status <> 'draft' and substr(coalesce(finalized_at, created_at), 1, 7) = ?", m)!.n,
    aiThisMonth: db.get('select coalesce(sum(count), 0) as n from ai_usage where month = ?', m)!.n,
    users: db.get("select count(*) as n from app_user where status = 'active'")!.n,
  };
}

// ---------------------------------------------------------------- simple rate limiting

const hits = new Map<string, number[]>();
/** At most `max` calls per `windowMs` for a key (e.g. sign-in attempts per address). */
export function rateLimit(key: string, max: number, windowMs: number) {
  const t = Date.now();
  const recent = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
  if (recent.length >= max) throw new HttpError(429, 'Too many attempts from this connection. Wait a few minutes and try again.');
  recent.push(t);
  hits.set(key, recent);
  if (hits.size > 10_000) for (const [k, v] of hits) if (!v.some((x) => t - x < windowMs)) hits.delete(k);
}
