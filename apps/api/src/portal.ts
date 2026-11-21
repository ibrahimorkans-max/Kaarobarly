import { formatMoney, qtyToString, type Invoice } from '../../../packages/shared/src/index';
import type { Db } from './core';
import { INVOICE_SELECT, clientLedger, getInvoice, mapBusiness, ownedRow } from './domain';

/**
 * The client portal: a read-only web page a client opens from a link (or the QR code on an
 * invoice) to see what they owe, their invoices and payments. The token in the link is the
 * only key, so pages never show anything from other clients.
 */

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fd = (d: string) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
const STATUS: Record<string, string> = { paid: 'Paid', partially_paid: 'Part paid', unpaid: 'Unpaid', overdue: 'Overdue', cancelled: 'Cancelled', draft: 'Draft' };

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/><title>${esc(title)}</title>
<style>
:root{--ink:#0B1B4D;--sub:#5B6472;--line:#DCE3F1;--bg:#F3F6FC;--card:#fff;--ok:#11703A;--bad:#B42318;--warn:#9A5B00;--a:#1257E6}
@media (prefers-color-scheme:dark){:root{--ink:#E8EDF8;--sub:#9AA6BC;--line:#26324A;--bg:#0B1220;--card:#121B2E}}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink)}
.wrap{max-width:720px;margin:0 auto;padding:16px}.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px;margin-bottom:12px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:18px 0 8px}.sub{color:var(--sub);font-size:14px}.big{font-size:28px;font-weight:800}
.row{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)}.row:last-child{border:0}
.r{text-align:right}.tag{font-size:12px;font-weight:700;padding:2px 8px;border-radius:99px;background:var(--bg)}.overdue{color:var(--bad)}.paid{color:var(--ok)}.partially_paid{color:var(--warn)}
a{color:var(--a);text-decoration:none}table{width:100%;border-collapse:collapse;font-size:14px}td,th{padding:8px 4px;border-bottom:1px solid var(--line);text-align:left}th{color:var(--sub);font-weight:600}
.foot{color:var(--sub);font-size:12px;text-align:center;margin:20px 0}
</style></head><body><div class="wrap">${body}<div class="foot">Shared securely with Kaarobarly</div></div></body></html>`;
}

const clientByToken = (db: Db, token: string) => (/^[0-9a-f]{20,80}$/i.test(token) ? db.get('select * from client where portal_token = ?', token) : undefined);

export function portalPage(db: Db, token: string): string | null {
  const c = clientByToken(db, token);
  if (!c) return null;
  const ledger = clientLedger(db, c.tenant_id, c.id);
  const business = db.get('select * from business where tenant_id = ? order by created_at limit 1', c.tenant_id);
  const b = business ? mapBusiness(business) : null;
  const m = (v: number) => formatMoney(v, b?.currency ?? 'PKR', b?.currencyPrecision ?? 2);
  const invoices = ledger.invoices.filter((i) => i.status === 'final');
  const rows = invoices
    .map(
      (i) => `<a class="row" href="${esc(token)}/invoice/${esc(i.id)}"><div><b>${esc(i.number)}</b><div class="sub">${fd(i.issueDate)} · due ${fd(i.dueDate)}</div></div>
      <div class="r"><b>${m(i.balance > 0 ? i.balance : i.total)}</b><div><span class="tag ${i.displayStatus}">${STATUS[i.displayStatus] ?? ''}</span></div></div></a>`,
    )
    .join('');
  const pays = ledger.payments
    .filter((p) => p.verificationStatus !== 'rejected')
    .slice(0, 20)
    .map((p) => `<div class="row"><div><b>${esc(p.number)}</b><div class="sub">${fd(p.date)}</div></div><div class="r paid"><b>${formatMoney(p.amount, p.currency, p.currencyPrecision)}</b></div></div>`)
    .join('');
  const bank = b ? [b.bankDetails, b.iban && `IBAN: ${b.iban}`, b.paymentInstructions].filter(Boolean).map(esc).join('<br/>') : '';
  return page(
    `${b?.tradingName || b?.legalName || 'Statement'} · ${c.name}`,
    `<div class="card"><div class="sub">${esc(b?.tradingName || b?.legalName || '')}</div><h1>${esc(c.name)}</h1>
     <div class="sub" style="margin-top:10px">You owe</div><div class="big ${ledger.outstanding > 0 ? 'overdue' : 'paid'}">${m(Math.max(ledger.outstanding, 0))}</div>
     ${ledger.overdue > 0 ? `<div class="overdue">${m(ledger.overdue)} is overdue</div>` : ''}
     ${ledger.credit > 0 ? `<div class="paid">Advance with us: ${m(ledger.credit)}</div>` : ''}</div>
     ${bank ? `<div class="card"><b>How to pay</b><div class="sub" style="margin-top:6px">${bank}</div></div>` : ''}
     <h2>Invoices</h2><div class="card">${rows || '<div class="sub">No invoices yet.</div>'}</div>
     <h2>Payments received</h2><div class="card">${pays || '<div class="sub">No payments yet.</div>'}</div>
     ${b?.phone || b?.email ? `<div class="card sub">Questions? ${[b.phone && `<a href="tel:${esc(b.phone)}">${esc(b.phone)}</a>`, b.email && `<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>`].filter(Boolean).join(' · ')}</div>` : ''}`,
  );
}

export function portalInvoice(db: Db, token: string, invoiceId: string): string | null {
  const c = clientByToken(db, token);
  if (!c) return null;
  const row = db.get(`${INVOICE_SELECT} where i.tenant_id = ? and i.id = ? and i.client_id = ? and i.status = 'final'`, c.tenant_id, invoiceId, c.id);
  if (!row) return null;
  const i: Invoice = getInvoice(db, c.tenant_id, invoiceId);
  const b = mapBusiness(ownedRow(db, 'business', c.tenant_id, i.businessId));
  const m = (v: number) => formatMoney(v, i.currency, i.currencyPrecision);
  const lines = i.lines.map((l) => `<tr><td>${esc(l.name)}${l.description ? `<div class="sub">${esc(l.description)}</div>` : ''}</td><td class="r">${qtyToString(l.qty)} ${esc(l.unit)}</td><td class="r">${m(l.unitPrice)}</td><td class="r">${m(l.lineTotal ?? 0)}</td></tr>`).join('');
  const t = (k: string, v: string, cls = '') => `<div class="row ${cls}"><span>${k}</span><b>${v}</b></div>`;
  return page(
    `${i.number} · ${b.tradingName || b.legalName}`,
    `<div class="sub"><a href="../../${esc(token)}">← All invoices</a></div>
     <div class="card"><div class="sub">${esc(b.tradingName || b.legalName)}</div><h1>${i.docType === 'debit_note' ? 'Debit note' : 'Invoice'} ${esc(i.number)}</h1>
     <div class="sub">${fd(i.issueDate)} · due ${fd(i.dueDate)}${i.reference ? ` · ref ${esc(i.reference)}` : ''}</div>
     <div style="margin-top:8px"><span class="tag ${i.displayStatus}">${STATUS[i.displayStatus] ?? ''}</span></div></div>
     <div class="card"><table><tr><th>Item</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Total</th></tr>${lines}</table></div>
     <div class="card">${t('Total', m(i.total))}${i.paid ? t('Paid', m(i.paid), 'paid') : ''}${t('Balance due', m(i.balance), i.balance > 0 ? 'overdue' : 'paid')}</div>
     ${i.paymentTerms ? `<div class="card sub">${esc(i.paymentTerms)}</div>` : ''}`,
  );
}
