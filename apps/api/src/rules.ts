import { z } from 'zod';
import { formatMoney } from '../../../packages/shared/src/index';
import { now, today, uid, type Db, type Row } from './core';
import { INVOICE_SELECT } from './domain';
import { inBase } from './fx';
import { HttpError, type AuthContext } from './perm';

/**
 * Automation rules, kept simple and predictable:
 * - categorize: money out/in whose party or note contains some words gets a category.
 * - alert: watch for overdue invoices, low stock, cheques coming up, bills due, big expenses.
 * Alerts are worked out when asked for (so they are always current, also offline);
 * dismissing one hides it until something changes.
 */

export const ALERT_TRIGGERS = ['invoice_overdue', 'stock_low', 'cheque_due', 'bill_due', 'big_expense', 'cash_drawer_high', 'shift_variance'] as const;
export type AlertTrigger = (typeof ALERT_TRIGGERS)[number];

export const ruleSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('categorize'),
    name: z.string().trim().max(100).default(''),
    enabled: z.boolean().default(true),
    config: z.object({
      type: z.enum(['expense', 'income']),
      /** words to look for, e.g. "petrol" or "PSO" */
      match: z.string().trim().min(2, 'Enter the words to look for').max(100),
      category: z.string().trim().min(1).max(60),
    }),
  }),
  z.object({
    kind: z.literal('alert'),
    name: z.string().trim().max(100).default(''),
    enabled: z.boolean().default(true),
    config: z.object({
      trigger: z.enum(ALERT_TRIGGERS),
      /** invoice_overdue: at least this many days late; cheque_due / bill_due: this many days ahead */
      days: z.number().int().min(0).max(365).default(0),
      /** big_expense: at or above this amount (minor units) */
      amount: z.number().int().min(0).max(1e13).default(0),
    }),
  }),
]);
export type RuleBody = z.infer<typeof ruleSchema>;

export interface Rule {
  id: string;
  kind: 'categorize' | 'alert';
  name: string;
  enabled: boolean;
  config: Record<string, any>;
  createdAt: string;
}

export interface Alert {
  key: string;
  ruleId: string;
  trigger: AlertTrigger;
  level: 'info' | 'warn' | 'danger';
  title: string;
  sub: string;
  date: string;
  refType: string;
  refId: string;
}

const mapRule = (r: Row): Rule => ({ id: r.id, kind: r.kind, name: r.name, enabled: !!r.enabled, config: JSON.parse(r.config), createdAt: r.created_at });

export function listRules(db: Db, tenantId: string): Rule[] {
  return db.all('select * from automation_rule where tenant_id = ? order by kind, created_at', tenantId).map(mapRule);
}

export function saveRule(db: Db, auth: AuthContext, body: RuleBody, id?: string): Rule {
  if (id) {
    if (!db.get('select 1 from automation_rule where id = ? and tenant_id = ?', id, auth.tenantId)) throw new HttpError(404, 'Rule not found.');
    db.run('update automation_rule set kind=?, name=?, enabled=?, config=? where id=?', body.kind, body.name, body.enabled ? 1 : 0, JSON.stringify(body.config), id);
  } else {
    id = uid();
    db.run('insert into automation_rule (id, tenant_id, kind, name, enabled, config, created_at) values (?,?,?,?,?,?,?)', id, auth.tenantId, body.kind, body.name, body.enabled ? 1 : 0, JSON.stringify(body.config), now());
  }
  db.audit(auth.tenantId, auth.userId, 'rule.save', 'automation_rule', id, { kind: body.kind });
  return mapRule(db.get('select * from automation_rule where id = ?', id)!);
}

export function deleteRule(db: Db, auth: AuthContext, id: string) {
  const r = db.run('delete from automation_rule where id = ? and tenant_id = ?', id, auth.tenantId);
  if (!r.changes) throw new HttpError(404, 'Rule not found.');
}

/** Rules a new business gets with one tap. */
export function suggestedRules(): RuleBody[] {
  return [
    { kind: 'alert', name: 'Invoices 7+ days late', enabled: true, config: { trigger: 'invoice_overdue', days: 7, amount: 0 } },
    { kind: 'alert', name: 'Stock running low', enabled: true, config: { trigger: 'stock_low', days: 0, amount: 0 } },
    { kind: 'alert', name: 'Cheques in the next 3 days', enabled: true, config: { trigger: 'cheque_due', days: 3, amount: 0 } },
    { kind: 'alert', name: 'Supplier bills due within 3 days', enabled: true, config: { trigger: 'bill_due', days: 3, amount: 0 } },
    { kind: 'categorize', name: 'Petrol is fuel', enabled: true, config: { type: 'expense', match: 'petrol', category: 'Fuel & transport' } },
    { kind: 'categorize', name: 'Electricity bill is utilities', enabled: true, config: { type: 'expense', match: 'electricity', category: 'Utilities' } },
  ];
}

/**
 * The category a categorize rule gives a record, or null. Only used when the record was left in
 * a general category, so a category someone picked on purpose is never overridden.
 */
export function categoryFor(db: Db, tenantId: string, type: 'expense' | 'income', category: string, text: string): string | null {
  if (category && !/^other (expense|income)$/i.test(category)) return null;
  const hay = text.toLowerCase();
  for (const r of listRules(db, tenantId)) {
    if (!r.enabled || r.kind !== 'categorize' || r.config.type !== type) continue;
    if (hay.includes(String(r.config.match).toLowerCase())) return r.config.category;
  }
  return null;
}

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Alerts from the enabled alert rules, minus those dismissed. */
export function alerts(db: Db, tenantId: string): Alert[] {
  const t = today();
  const dismissed = new Set(db.all('select key from alert_dismissal where tenant_id = ?', tenantId).map((r) => r.key as string));
  const out: Alert[] = [];
  const biz = db.get('select currency, currency_precision from business where tenant_id = ? order by created_at limit 1', tenantId);
  const money = (v: number, _r?: Row) => formatMoney(v, biz?.currency ?? 'PKR', biz?.currency_precision ?? 2);
  for (const rule of listRules(db, tenantId).filter((r) => r.enabled && r.kind === 'alert')) {
    const c = rule.config;
    if (c.trigger === 'invoice_overdue') {
      for (const r of db.all(`select * from (${INVOICE_SELECT} where i.tenant_id = ? and i.status = 'final') where paid < total and due_date <= ?`, tenantId, addDays(t, -c.days))) {
        const late = Math.round((Date.parse(t) - Date.parse(r.due_date)) / 86_400_000);
        if (late <= 0) continue;
        out.push({ key: `${rule.id}:inv:${r.id}:${r.paid}`, ruleId: rule.id, trigger: c.trigger, level: late > 30 ? 'danger' : 'warn', title: `${r.client_name} is ${late} days late`, sub: `${r.number} · ${money(inBase(r.total - r.paid, r.fx_factor), r)} unpaid`, date: r.due_date, refType: 'invoice', refId: r.id });
      }
    } else if (c.trigger === 'stock_low') {
      for (const r of db.all(`select s.*, coalesce((select sum(m.qty) from stock_move m where m.item_id = s.id), 0) as on_hand from service s where s.tenant_id = ? and s.track_stock = 1 and s.status = 'active'`, tenantId)) {
        if (r.on_hand > r.reorder_level) continue;
        out.push({ key: `${rule.id}:stock:${r.id}:${r.on_hand}`, ruleId: rule.id, trigger: c.trigger, level: r.on_hand <= 0 ? 'danger' : 'warn', title: r.on_hand <= 0 ? `${r.name} is out of stock` : `${r.name} is running low`, sub: `${r.on_hand / 1000} ${r.unit} left · reorder at ${r.reorder_level / 1000}`, date: t, refType: 'stock', refId: r.id });
      }
    } else if (c.trigger === 'cheque_due') {
      for (const r of db.all("select * from cheque where tenant_id = ? and status in ('pending','deposited') and cheque_date <= ?", tenantId, addDays(t, c.days))) {
        out.push({ key: `${rule.id}:chq:${r.id}:${r.status}`, ruleId: rule.id, trigger: c.trigger, level: r.cheque_date < t ? 'warn' : 'info', title: r.direction === 'in' ? `Deposit cheque from ${r.party}` : `Cheque to ${r.party} will be presented`, sub: `#${r.number} · ${money(r.amount)} · dated ${r.cheque_date}`, date: r.cheque_date, refType: 'cheque', refId: r.id });
      }
    } else if (c.trigger === 'bill_due') {
      for (const p of db.all('select * from purchase where tenant_id = ?', tenantId)) {
        (JSON.parse(p.installments || '[]') as { dueDate: string; amount: number; paid: boolean }[]).forEach((x, i) => {
          if (x.paid || x.dueDate > addDays(t, c.days)) return;
          out.push({ key: `${rule.id}:bill:${p.id}:${i}`, ruleId: rule.id, trigger: c.trigger, level: x.dueDate < t ? 'danger' : 'warn', title: `Pay ${p.supplier}${x.dueDate < t ? ' (overdue)' : ''}`, sub: `${p.number} · ${money(x.amount)} due ${x.dueDate}`, date: x.dueDate, refType: 'purchase', refId: p.id });
        });
      }
    } else if (c.trigger === 'big_expense' && c.amount > 0) {
      for (const e of db.all("select * from finance_entry where tenant_id = ? and type = 'expense' and amount >= ? and date >= ?", tenantId, c.amount, addDays(t, -7))) {
        out.push({ key: `${rule.id}:exp:${e.id}`, ruleId: rule.id, trigger: c.trigger, level: 'info', title: `Large money out: ${e.category}`, sub: `${money(e.amount)} on ${e.date}${e.party ? ` · ${e.party}` : ''}`, date: e.date, refType: 'finance', refId: e.id });
      }
    } else if (c.trigger === 'cash_drawer_high' && c.amount > 0) {
      // an open drawer holding more cash than set: time to deposit
      for (const s of db.all("select id, opened_by_name, opening_float, opened_at from pos_shift where tenant_id = ? and status = 'open'", tenantId)) {
        const cash =
          s.opening_float +
          db.get("select coalesce(sum(p.amount), 0) as v from payment p where p.pos_shift_id = ? and p.method = 'cash'", s.id)!.v +
          db.get("select coalesce(sum(case when kind = 'in' then amount else -amount end), 0) as v from pos_cash_move where shift_id = ?", s.id)!.v;
        if (cash >= c.amount) out.push({ key: `${rule.id}:drawer:${s.id}`, ruleId: rule.id, trigger: c.trigger, level: 'warn', title: `Drawer has ${money(cash)}: deposit some`, sub: `${s.opened_by_name}'s shift since ${String(s.opened_at).slice(11, 16)}`, date: t, refType: 'shift', refId: s.id });
      }
    } else if (c.trigger === 'shift_variance' && c.amount > 0) {
      for (const s of db.all("select id, opened_by_name, difference, closed_at from pos_shift where tenant_id = ? and status = 'closed' and closed_at >= ? and abs(difference) >= ?", tenantId, addDays(t, -7), c.amount)) {
        out.push({ key: `${rule.id}:var:${s.id}`, ruleId: rule.id, trigger: c.trigger, level: s.difference < 0 ? 'danger' : 'warn', title: `${s.opened_by_name}'s drawer ${s.difference < 0 ? 'short' : 'over'} by ${money(Math.abs(s.difference))}`, sub: `Shift closed ${String(s.closed_at).slice(0, 10)}`, date: String(s.closed_at).slice(0, 10), refType: 'shift', refId: s.id });
      }
    }
  }
  const order = { danger: 0, warn: 1, info: 2 };
  return out.filter((a) => !dismissed.has(a.key)).sort((a, b) => order[a.level] - order[b.level] || a.date.localeCompare(b.date));
}

export function dismissAlert(db: Db, auth: AuthContext, key: string) {
  db.run('insert into alert_dismissal (tenant_id, key, dismissed_at) values (?,?,?) on conflict (tenant_id, key) do nothing', auth.tenantId, key.slice(0, 300), now());
}
