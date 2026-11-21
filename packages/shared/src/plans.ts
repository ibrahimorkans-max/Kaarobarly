/** SaaS plans: what each subscription allows. Prices are monthly, PKR (minor units). */

export const PLAN_IDS = ['free', 'starter', 'pro', 'business'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface PlanLimits {
  users: number;
  businesses: number;
  /** final invoices per calendar month */
  invoicesPerMonth: number;
  /** AI requests per calendar month (assistant, scans, quick entry) */
  aiPerMonth: number;
  payroll: boolean;
}

export const PLANS: Record<PlanId, { name: string; price: number; hint: string; limits: PlanLimits }> = {
  free: { name: 'Free', price: 0, hint: 'For trying Kaarobarly and very small shops', limits: { users: 1, businesses: 1, invoicesPerMonth: 30, aiPerMonth: 0, payroll: false } },
  starter: { name: 'Starter', price: 150_000, hint: 'A growing business with a helper', limits: { users: 3, businesses: 1, invoicesPerMonth: 300, aiPerMonth: 50, payroll: false } },
  pro: { name: 'Pro', price: 350_000, hint: 'Teams, stock, payroll and AI', limits: { users: 10, businesses: 3, invoicesPerMonth: 2000, aiPerMonth: 500, payroll: true } },
  business: { name: 'Business', price: 900_000, hint: 'Several branches and large teams', limits: { users: 50, businesses: 20, invoicesPerMonth: 100_000, aiPerMonth: 3000, payroll: true } },
};

export const TRIAL_DAYS = 30;

export interface PlanState {
  /** the plan in force now (a trial counts as Pro) */
  plan: PlanId;
  /** what was bought; 'trial' during the free trial */
  chosen: PlanId | 'trial';
  trialEndsAt: string | null;
  /** paid until (YYYY-MM-DD); after it the account falls back to Free */
  paidUntil: string | null;
  daysLeft: number | null;
  limits: PlanLimits;
  usage: { users: number; businesses: number; invoicesThisMonth: number; aiThisMonth: number };
}

/** Which plan is in force on a date, from what is stored on the account. */
export function effectivePlan(chosen: string, trialEndsAt: string | null, paidUntil: string | null, today: string): { plan: PlanId; daysLeft: number | null } {
  const days = (end: string) => Math.max(0, Math.ceil((Date.parse(`${end}T23:59:59Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000));
  if (chosen === 'trial') return trialEndsAt && trialEndsAt >= today ? { plan: 'pro', daysLeft: days(trialEndsAt) } : { plan: 'free', daysLeft: 0 };
  if (!PLAN_IDS.includes(chosen as PlanId)) return { plan: 'free', daysLeft: null };
  if (chosen === 'free') return { plan: 'free', daysLeft: null };
  return paidUntil && paidUntil >= today ? { plan: chosen as PlanId, daysLeft: days(paidUntil) } : { plan: 'free', daysLeft: 0 };
}
