import { formatMoney } from '../../../packages/shared/src/index';
import { today, type Db } from './core';
import { profitLoss } from './accounts';
import { profitability } from './finance2';
import { inBase } from './fx';

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const monthEnd = (m: string) => `${m}-${String(new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate()).padStart(2, '0')}`;
const prevMonth = (m: string) => {
  const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export interface Anomaly {
  key: string;
  kind: 'duplicate_payment' | 'big_discount' | 'cash_variance' | 'many_returns' | 'many_voids' | 'big_withdrawal';
  level: 'warn' | 'danger';
  title: string;
  sub: string;
  refType: string;
  refId: string;
}

/** Things that look wrong in the last 14 days: possible mistakes or misuse, for the owner to check. */
export function anomalies(db: Db, tenantId: string): Anomaly[] {
  const since = addDays(today(), -14);
  const biz = db.get('select currency, currency_precision from business where tenant_id = ? order by created_at limit 1', tenantId);
  const m = (v: number) => formatMoney(v, biz?.currency ?? 'PKR', biz?.currency_precision ?? 2);
  const dismissed = new Set(db.all('select key from alert_dismissal where tenant_id = ?', tenantId).map((r) => r.key as string));
  const out: Anomaly[] = [];
  const push = (a: Anomaly) => !dismissed.has(a.key) && out.push(a);

  // the same customer paying the same amount twice within 2 days
  for (const r of db.all(
    `select p1.id as a, p2.id as b, p1.amount, p1.date, c.name from payment p1 join payment p2 on p2.tenant_id = p1.tenant_id and p2.client_id = p1.client_id and p2.amount = p1.amount and p2.id > p1.id
       and abs(julianday(p2.date) - julianday(p1.date)) <= 2 and p2.verification_status <> 'rejected' and coalesce(p2.notes, '') <> 'POS'
     join client c on c.id = p1.client_id
     where p1.tenant_id = ? and p1.date >= ? and p1.verification_status <> 'rejected' and coalesce(p1.notes, '') <> 'POS' and c.category <> 'Walk-in'`,
    tenantId, since,
  )) {
    push({ key: `dup:${r.a}:${r.b}`, kind: 'duplicate_payment', level: 'warn', title: `${r.name} paid ${m(r.amount)} twice`, sub: `Two payments of the same amount around ${r.date}. Was one entered twice?`, refType: 'payment', refId: r.b });
  }
  // a bill discounted by a fifth or more
  for (const r of db.all(
    `select i.id, i.number, i.subtotal, i.item_discounts + i.overall_discount as disc, coalesce(u.name, '') as who from invoice i left join app_user u on u.id = i.created_by
     where i.tenant_id = ? and i.status = 'final' and i.issue_date >= ? and i.subtotal > 0 and (i.item_discounts + i.overall_discount) * 5 >= i.subtotal and coalesce(i.notes, '') = ''`,
    tenantId, since,
  )) {
    push({ key: `disc:${r.id}`, kind: 'big_discount', level: 'warn', title: `${Math.round((r.disc * 100) / r.subtotal)}% off on ${r.number}`, sub: `${m(r.disc)} discount${r.who ? ` by ${r.who}` : ''}`, refType: 'invoice', refId: r.id });
  }
  // drawers short or over by more than 1% of the shift's cash
  for (const r of db.all("select id, opened_by_name, difference, expected, closed_at from pos_shift where tenant_id = ? and status = 'closed' and closed_at >= ? and difference <> 0", tenantId, since)) {
    if (Math.abs(r.difference) * 100 < Math.max(r.expected ?? 0, 1)) continue;
    push({ key: `var:${r.id}`, kind: 'cash_variance', level: r.difference < 0 ? 'danger' : 'warn', title: `${r.opened_by_name}'s drawer was ${r.difference < 0 ? 'short' : 'over'} by ${m(Math.abs(r.difference))}`, sub: `Shift closed ${String(r.closed_at).slice(0, 10)}`, refType: 'shift', refId: r.id });
  }
  // a cashier with many returns or cancelled orders
  for (const r of db.all("select user_id, count(*) as n, coalesce(u.name, '') as who from audit_log a left join app_user u on u.id = a.user_id where a.tenant_id = ? and a.action = 'pos.return' and a.at >= ? group by user_id having count(*) >= 4", tenantId, since)) {
    push({ key: `ret:${r.user_id}:${r.n}`, kind: 'many_returns', level: 'warn', title: `${r.who || 'A cashier'} took ${r.n} returns in 2 weeks`, sub: 'Check the returned goods are really back on the shelf.', refType: 'user', refId: r.user_id });
  }
  for (const r of db.all("select user_id, count(*) as n, coalesce(u.name, '') as who from audit_log a left join app_user u on u.id = a.user_id where a.tenant_id = ? and a.action = 'order.cancel' and a.at >= ? group by user_id having count(*) >= 3", tenantId, since)) {
    push({ key: `void:${r.user_id}:${r.n}`, kind: 'many_voids', level: 'warn', title: `${r.who || 'Someone'} cancelled ${r.n} orders in 2 weeks`, sub: 'Cancelled orders after the kitchen started cost money.', refType: 'user', refId: r.user_id });
  }
  // an owner withdrawal far above the usual
  const avg = db.get("select avg(amount) as a, count(*) as n from finance_entry where tenant_id = ? and category = 'Owner withdrawal' and date >= ?", tenantId, addDays(today(), -180))!;
  if (avg.n >= 3) {
    for (const r of db.all("select id, amount, date from finance_entry where tenant_id = ? and category = 'Owner withdrawal' and date >= ? and amount >= ?", tenantId, since, avg.a * 3)) {
      push({ key: `wd:${r.id}`, kind: 'big_withdrawal', level: 'warn', title: `Large owner withdrawal: ${m(r.amount)}`, sub: `On ${r.date}, about ${Math.round(r.amount / avg.a)}× the usual`, refType: 'finance', refId: r.id });
    }
  }
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'danger' ? -1 : 1));
}

/** A plain-language summary of a month, with the numbers behind it, ready to share on WhatsApp. */
export function monthlyReport(db: Db, tenantId: string, month: string, lang: 'en' | 'ur' = 'en') {
  const from = `${month}-01`;
  const to = monthEnd(month);
  const prev = prevMonth(month);
  const pnl = profitLoss(db, tenantId, { from, to, basis: 'accrual' }) as any;
  const pnlPrev = profitLoss(db, tenantId, { from: `${prev}-01`, to: monthEnd(prev), basis: 'accrual' }) as any;
  const income = pnl.totalIncome ?? 0;
  const expenses = pnl.totalExpenses ?? 0;
  const profit = pnl.netProfit ?? income - expenses;
  const prevProfit = pnlPrev.netProfit ?? (pnlPrev.totalIncome ?? 0) - (pnlPrev.totalExpenses ?? 0);
  const items = profitability(db, tenantId, 'item', from, to).rows.slice(0, 3);
  const clients = profitability(db, tenantId, 'client', from, to).rows.slice(0, 3);
  const collected = db.all("select amount, fx_factor from payment where tenant_id = ? and verification_status <> 'rejected' and date between ? and ?", tenantId, from, to).reduce((s, r) => s + inBase(r.amount, r.fx_factor), 0);
  const owed = db.all("select total - coalesce((select sum(a.amount) from payment_allocation a where a.invoice_id = i.id), 0) as due, fx_factor from invoice i where i.tenant_id = ? and i.status = 'final'", tenantId).reduce((s, r) => s + Math.max(inBase(r.due, r.fx_factor), 0), 0);
  const lowStock = db.get(
    `select count(*) as n from service s where s.tenant_id = ? and s.track_stock = 1 and s.status = 'active' and s.reorder_level > 0
     and coalesce((select sum(m.qty) from stock_move m where m.item_id = s.id), 0) <= s.reorder_level`,
    tenantId,
  )!.n;
  const biz = db.get('select currency, currency_precision, trading_name, legal_name from business where tenant_id = ? order by created_at limit 1', tenantId);
  const m = (v: number) => formatMoney(v, pnl.currency ?? biz?.currency ?? 'PKR', biz?.currency_precision ?? 2);
  const name = new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const change = prevProfit ? Math.round(((profit - prevProfit) / Math.abs(prevProfit)) * 100) : null;
  const lines =
    lang === 'ur'
      ? [
          `📊 ${biz?.trading_name || biz?.legal_name || ''} — ${name}`,
          `آمدن: ${m(income)}`,
          `اخراجات: ${m(expenses)}`,
          `${profit >= 0 ? 'منافع' : 'نقصان'}: ${m(Math.abs(profit))}${change !== null ? ` (پچھلے مہینے سے ${change >= 0 ? '+' : ''}${change}%)` : ''}`,
          `وصولی: ${m(collected)} · باقی واجب الادا: ${m(owed)}`,
          items.length ? `سب سے زیادہ منافع: ${items.map((i) => i.name).join('، ')}` : '',
          lowStock ? `${lowStock} اشیاء کا اسٹاک کم ہے` : '',
        ]
      : [
          `📊 ${biz?.trading_name || biz?.legal_name || 'Business'} — ${name}`,
          `Income ${m(income)}, expenses ${m(expenses)}.`,
          `${profit >= 0 ? 'Profit' : 'Loss'} ${m(Math.abs(profit))}${change !== null ? ` (${change >= 0 ? 'up' : 'down'} ${Math.abs(change)}% on last month)` : ''}.`,
          `Collected ${m(collected)}; customers still owe ${m(owed)}.`,
          items.length ? `Most profitable: ${items.map((i) => `${i.name} (${m(i.profit)})`).join(', ')}.` : '',
          clients.length ? `Best customers: ${clients.map((c) => c.name).join(', ')}.` : '',
          lowStock ? `${lowStock} item${lowStock === 1 ? ' is' : 's are'} low on stock.` : '',
        ];
  return {
    month,
    income,
    expenses,
    profit,
    prevProfit,
    changePct: change,
    collected,
    owed,
    lowStock,
    topItems: items.map((i) => ({ name: i.name, profit: i.profit })),
    topClients: clients.map((c) => ({ name: c.name, revenue: c.revenue })),
    text: lines.filter(Boolean).join('\n'),
    currency: pnl.currency ?? biz?.currency ?? 'PKR',
    currencyPrecision: biz?.currency_precision ?? 2,
  };
}
