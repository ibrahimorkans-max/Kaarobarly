import { z } from 'zod';
import { now, today, uid, type Db } from './core';
import { cashbook, getAccount } from './accounts';
import { inBase } from './fx';
import { HttpError, type AuthContext } from './perm';
import { assertDayOpen } from './daylock';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const days = (a: string, b: string) => Math.abs(Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000));
const biz = (db: Db, tenantId: string) => db.get('select id, currency, currency_precision from business where tenant_id = ? order by created_at limit 1', tenantId);

// ================================================================ tax centre

/**
 * Sales tax collected on invoices against tax paid on purchase bills, month by month, with what
 * was paid to the tax office, and taxable sales to customers without an NTN.
 */
export function taxSummary(db: Db, tenantId: string, from: string, to: string) {
  const months = new Map<string, { month: string; taxableSales: number; outputTax: number; purchases: number; inputTax: number; paid: number }>();
  const m = (k: string) => {
    if (!months.has(k)) months.set(k, { month: k, taxableSales: 0, outputTax: 0, purchases: 0, inputTax: 0, paid: 0 });
    return months.get(k)!;
  };
  for (const r of db.all("select issue_date, taxable_amount, tax_amount, fx_factor from invoice where tenant_id = ? and status = 'final' and issue_date between ? and ?", tenantId, from, to)) {
    const row = m(r.issue_date.slice(0, 7));
    if (r.tax_amount > 0) row.taxableSales += inBase(r.taxable_amount, r.fx_factor);
    row.outputTax += inBase(r.tax_amount, r.fx_factor);
  }
  for (const r of db.all('select date, total, tax_amount from purchase where tenant_id = ? and date between ? and ?', tenantId, from, to)) {
    const row = m(r.date.slice(0, 7));
    row.purchases += r.total;
    row.inputTax += r.tax_amount ?? 0;
  }
  for (const r of db.all("select date, amount from finance_entry where tenant_id = ? and type = 'expense' and category = 'Taxes & fees' and date between ? and ?", tenantId, from, to)) m(r.date.slice(0, 7)).paid += r.amount;
  const list = [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).map((x) => ({ ...x, payable: x.outputTax - x.inputTax }));
  const sum = (k: keyof (typeof list)[number]) => list.reduce((s, x) => s + (x[k] as number), 0);
  const noNtn = db
    .all(
      `select c.id, c.name, sum(i.taxable_amount * coalesce(i.fx_factor, 1000000) / 1000000) as sales, count(*) as invoices from invoice i join client c on c.id = i.client_id
       where i.tenant_id = ? and i.status = 'final' and i.tax_amount > 0 and c.ntn = '' and c.category <> 'Walk-in' and i.issue_date between ? and ? group by c.id order by sales desc limit 20`,
      tenantId, from, to,
    )
    .map((r) => ({ clientId: r.id, name: r.name, sales: Math.round(r.sales), invoices: r.invoices }));
  const b = biz(db, tenantId);
  return {
    from,
    to,
    months: list,
    totals: { taxableSales: sum('taxableSales'), outputTax: sum('outputTax'), inputTax: sum('inputTax'), payable: sum('payable'), paid: sum('paid') },
    noNtn,
    currency: b?.currency ?? 'PKR',
    currencyPrecision: b?.currency_precision ?? 2,
  };
}

// ================================================================ bank and wallet reconciliation

export const statementSchema = z.object({
  accountId: z.string().min(1),
  rows: z.array(z.object({ date: isoDate, description: z.string().trim().max(300).default(''), amount: z.number().int().min(-1e13).max(1e13).refine((v) => v !== 0, 'A row has no amount') })).min(1).max(2000),
});

/**
 * Match a bank or wallet statement against the account's recorded movements: same amount, within
 * 3 days, each movement used once. Already reconciled movements are skipped.
 */
export function reconcilePreview(db: Db, tenantId: string, body: z.infer<typeof statementSchema>) {
  getAccount(db, tenantId, body.accountId);
  const dates = body.rows.map((r) => r.date).sort();
  const book = cashbook(db, tenantId, { accountId: body.accountId, from: addDays(dates[0], -3), to: addDays(dates[dates.length - 1], 3) })
    .days.flatMap((d) => d.lines)
    .filter((l) => l.moneyIn || l.moneyOut);
  const done = new Set(db.all('select ref_key from recon_match where tenant_id = ? and account_id = ?', tenantId, body.accountId).map((r) => r.ref_key as string));
  const used = new Set<string>();
  const rows = body.rows.map((r, index) => {
    const candidates = book.filter((l) => !done.has(l.id) && !used.has(l.id) && l.moneyIn - l.moneyOut === r.amount && days(l.date, r.date) <= 3).sort((a, b) => days(a.date, r.date) - days(b.date, r.date));
    const hit = candidates[0];
    if (hit) used.add(hit.id);
    return { index, ...r, match: hit ? { key: hit.id, date: hit.date, label: hit.label, party: hit.party } : null };
  });
  const inRange = (d: string) => d >= dates[0] && d <= dates[dates.length - 1];
  const bookOnly = book.filter((l) => !done.has(l.id) && !used.has(l.id) && inRange(l.date)).map((l) => ({ key: l.id, date: l.date, label: l.label, party: l.party, amount: l.moneyIn - l.moneyOut }));
  return { rows, matched: rows.filter((r) => r.match).length, unmatched: rows.filter((r) => !r.match).length, bookOnly };
}

export const confirmSchema = z.object({
  accountId: z.string().min(1),
  matches: z.array(z.object({ key: z.string().min(1).max(120), date: isoDate, description: z.string().max(300).default(''), amount: z.number().int() })).max(2000),
  /** statement lines that were never recorded (bank charges, profit): add them now as money in/out */
  add: z.array(z.object({ date: isoDate, description: z.string().trim().max(300).default(''), amount: z.number().int().refine((v) => v !== 0), category: z.string().trim().min(1).max(60) })).max(500).default([]),
});

export function reconcileConfirm(db: Db, auth: AuthContext, body: z.infer<typeof confirmSchema>) {
  return db.tx(() => {
    const account = db.get('select * from money_account where id = ? and tenant_id = ?', body.accountId, auth.tenantId);
    if (!account) throw new HttpError(404, 'Account not found.');
    for (const mt of body.matches) {
      db.run('insert or ignore into recon_match (id, tenant_id, account_id, ref_key, statement_date, description, amount, created_by, created_at) values (?,?,?,?,?,?,?,?,?)', uid(), auth.tenantId, body.accountId, mt.key, mt.date, mt.description, mt.amount, auth.userId, now());
    }
    let added = 0;
    for (const a of body.add) {
      assertDayOpen(db, auth.tenantId, account.business_id, a.date);
      const id = uid();
      db.run(
        "insert into finance_entry (id, tenant_id, business_id, type, category, amount, date, method, party, notes, account_id, created_by, created_at) values (?,?,?,?,?,?,?,'bank_transfer',?,?,?,?,?)",
        id, auth.tenantId, account.business_id, a.amount > 0 ? 'income' : 'expense', a.category, Math.abs(a.amount), a.date, '', `From statement: ${a.description}`.slice(0, 500), body.accountId, auth.userId, now(),
      );
      db.run('insert or ignore into recon_match (id, tenant_id, account_id, ref_key, statement_date, description, amount, created_by, created_at) values (?,?,?,?,?,?,?,?,?)', uid(), auth.tenantId, body.accountId, `${a.amount > 0 ? 'income' : 'expense'}-${id}`, a.date, a.description, a.amount, auth.userId, now());
      added++;
    }
    db.audit(auth.tenantId, auth.userId, 'reconcile', 'money_account', body.accountId, { matched: body.matches.length, added });
    return reconcileStatus(db, auth.tenantId, body.accountId);
  });
}

/** How up to date an account's reconciliation is. */
export function reconcileStatus(db: Db, tenantId: string, accountId: string) {
  getAccount(db, tenantId, accountId);
  const last = db.get('select max(statement_date) as d, count(*) as n from recon_match where tenant_id = ? and account_id = ?', tenantId, accountId)!;
  const from = addDays(today(), -90);
  const done = new Set(db.all('select ref_key from recon_match where tenant_id = ? and account_id = ?', tenantId, accountId).map((r) => r.ref_key as string));
  const open = cashbook(db, tenantId, { accountId, from, to: today() })
    .days.flatMap((d) => d.lines)
    .filter((l) => (l.moneyIn || l.moneyOut) && !done.has(l.id));
  return { lastDate: last.d ?? '', matched: last.n, openLast90: open.length, openAmount: open.reduce((s, l) => s + l.moneyIn - l.moneyOut, 0) };
}

// ================================================================ profitability

export type ProfitBy = 'item' | 'client' | 'category' | 'cashier';

/**
 * Sales, cost and margin grouped by item, customer, category or cashier. Revenue is after all
 * discounts and before tax; cost is what the stock cost when it was sold (items without stock: no cost).
 */
export function profitability(db: Db, tenantId: string, by: ProfitBy, from: string, to: string) {
  const groups = new Map<string, { key: string; name: string; qty: number; revenue: number; cost: number }>();
  const g = (key: string, name: string) => {
    if (!groups.has(key)) groups.set(key, { key, name, qty: 0, revenue: 0, cost: 0 });
    return groups.get(key)!;
  };
  const invoices = db.all(
    `select i.id, i.lines, i.subtotal, i.item_discounts, i.overall_discount, i.fx_factor, i.client_id, i.created_by, c.name as client_name, coalesce(u.name, '') as user_name
     from invoice i join client c on c.id = i.client_id left join app_user u on u.id = i.created_by
     where i.tenant_id = ? and i.status = 'final' and i.issue_date between ? and ?`,
    tenantId, from, to,
  );
  const items = new Map(db.all('select id, name, category from service where tenant_id = ?', tenantId).map((s) => [s.id as string, s]));
  for (const inv of invoices) {
    const lines = JSON.parse(inv.lines) as { serviceId?: string | null; name: string; qty: number; lineTotal?: number; unitPrice: number }[];
    const net = inv.subtotal - inv.item_discounts;
    const share = net > 0 ? (net - inv.overall_discount) / net : 1;
    const costs = new Map<string, number>();
    for (const mv of db.all("select item_id, sum(-qty * unit_cost / 1000.0) as c from stock_move where tenant_id = ? and ref_type = 'invoice' and ref_id = ? and kind = 'sale' group by item_id", tenantId, inv.id)) costs.set(mv.item_id, mv.c);
    let invoiceCost = 0;
    for (const v of costs.values()) invoiceCost += v;
    if (by === 'client' || by === 'cashier') {
      const row = by === 'client' ? g(inv.client_id, inv.client_name) : g(inv.created_by ?? 'unknown', inv.user_name || 'Unknown');
      row.qty += 1;
      row.revenue += inBase(Math.round(net * share), inv.fx_factor);
      row.cost += Math.round(invoiceCost);
      continue;
    }
    for (const l of lines) {
      const it = l.serviceId ? items.get(l.serviceId) : undefined;
      const key = by === 'item' ? (l.serviceId ?? `name:${l.name}`) : it?.category || 'No category';
      const row = g(key, by === 'item' ? (it?.name ?? l.name) : key);
      row.qty += l.qty;
      row.revenue += inBase(Math.round((l.lineTotal ?? Math.round((l.qty * l.unitPrice) / 1000)) * share), inv.fx_factor);
      // the stock cost of this item on this invoice (a recipe's ingredients count against the dish's invoice)
      if (l.serviceId && costs.has(l.serviceId)) {
        row.cost += Math.round(costs.get(l.serviceId)!);
        costs.delete(l.serviceId);
      }
    }
    // ingredients and other stock with no matching line: charge them to the invoice's first line group
    const rest = [...costs.values()].reduce((s, v) => s + v, 0);
    if (rest && lines[0]) {
      const l = lines[0];
      const it = l.serviceId ? items.get(l.serviceId) : undefined;
      const key = by === 'item' ? (l.serviceId ?? `name:${l.name}`) : it?.category || 'No category';
      g(key, by === 'item' ? (it?.name ?? l.name) : key).cost += Math.round(rest);
    }
  }
  const rows = [...groups.values()].map((r) => ({ ...r, profit: r.revenue - r.cost, marginBp: r.revenue ? Math.round(((r.revenue - r.cost) * 10_000) / r.revenue) : 0 })).sort((a, b) => b.profit - a.profit);
  const b = biz(db, tenantId);
  const tot = rows.reduce((s, r) => ({ revenue: s.revenue + r.revenue, cost: s.cost + r.cost }), { revenue: 0, cost: 0 });
  return { by, from, to, rows, totals: { ...tot, profit: tot.revenue - tot.cost, marginBp: tot.revenue ? Math.round(((tot.revenue - tot.cost) * 10_000) / tot.revenue) : 0 }, currency: b?.currency ?? 'PKR', currencyPrecision: b?.currency_precision ?? 2 };
}
