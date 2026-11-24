import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { API_URL } from './api';
import { qrSvg } from './qr';
import {
  PAYMENT_METHOD_LABELS,
  customValueText,
  formatMoney,
  percentToString,
  qtyToString,
  type BusinessProfile,
  type Client,
  type ClientLedger,
  type CreditNote,
  type CustomField,
  type DocLanguage,
  type CustomValues,
  type Invoice,
  type InvoiceTemplate,
  type Payment,
  type PayrollRun,
  type ZReport,
  POS_TENDER_LABELS,
  type Payslip,
  type Purchase,
  type Quotation,
  type ReportData,
} from './shared';

export type Paper = 'A4' | 'A5' | 'thermal' | 'thermal58';
export const PAPERS: { value: Paper; label: string }[] = [
  { value: 'A4', label: 'A4' },
  { value: 'A5', label: 'A5' },
  { value: 'thermal', label: 'Thermal 80mm' },
  { value: 'thermal58', label: 'Thermal 58mm' },
];
/** Page size in PostScript points (for PDF) and CSS pixels (for on-screen preview and images). */
export const PAPER_SIZE: Record<Paper, { width: number; height: number; css: string; px: number; pxHeight: number; mm: number }> = {
  A4: { width: 595, height: 842, css: 'A4', px: 794, pxHeight: 1123, mm: 296 },
  A5: { width: 420, height: 595, css: 'A5', px: 559, pxHeight: 794, mm: 209 },
  thermal: { width: 226, height: 800, css: '80mm auto', px: 302, pxHeight: 0, mm: 0 },
  thermal58: { width: 164, height: 800, css: '58mm auto', px: 219, pxHeight: 0, mm: 0 },
};

/** Default accent and dark colour of each design. */
export const TEMPLATE_COLORS: Record<InvoiceTemplate, { accent: string; dark: string }> = {
  amber: { accent: '#E9A23B', dark: '#4A4A4D' },
  ocean: { accent: '#1F3A8A', dark: '#14275F' },
  violet: { accent: '#4B3F9E', dark: '#2A2360' },
  crimson: { accent: '#E0483E', dark: '#2B2B2E' },
  classic: { accent: '#111111', dark: '#111111' },
};

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const nl = (s: string) => esc(s).replace(/\n/g, '<br/>');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fd = (d: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? '');
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
};
const STATUS: Record<string, string> = {
  draft: 'DRAFT', unpaid: 'UNPAID', partially_paid: 'PARTIALLY PAID', paid: 'PAID', overdue: 'OVERDUE', cancelled: 'CANCELLED',
  sent: 'SENT', accepted: 'ACCEPTED', rejected: 'REJECTED', expired: 'EXPIRED', converted: 'ACCEPTED',
};

const LABELS = {
  invoice: { title: 'INVOICE', to: 'Invoice to', short: 'Invoice', due: 'Due date', dueLower: 'due' },
  quotation: { title: 'QUOTATION', to: 'Quotation for', short: 'Quote', due: 'Valid until', dueLower: 'valid until' },
  purchase: { title: 'PURCHASE', to: 'Bought from', short: 'Purchase', due: 'Recorded', dueLower: 'recorded' },
  order: { title: 'PURCHASE ORDER', to: 'Supplier', short: 'PO', due: 'Deliver by', dueLower: 'deliver by' },
  debitNote: { title: 'DEBIT NOTE', to: 'Debit to', short: 'Debit note', due: 'Due date', dueLower: 'due' },
  creditNote: { title: 'CREDIT NOTE', to: 'Credit to', short: 'Credit note', due: 'Against', dueLower: 'against' },
  receipt: { title: 'GOODS RECEIVED', to: 'Received from', short: 'GRN', due: 'Received', dueLower: 'received' },
};

export const DEFAULT_DISCLAIMER =
  'This is a computer-generated document. Please check all details on receipt; errors and omissions excepted (E&OE). Goods once sold are subject to the terms agreed between both parties.';

/** "Cash" for cash; otherwise the bank / wallet transaction ID, or a dash when none was entered. */
export const txnId = (method: string, reference: string) => (method === 'cash' ? 'Cash' : reference || '—');

/** Notes and Disclaimer, printed at the end of every invoice, quotation and purchase slip. */
function tailHtml(notes: string, b: BusinessProfile) {
  const disc = nl(b.invoiceDisclaimer || DEFAULT_DISCLAIMER);
  return `<div class="tail"><div><div class="label">Notes</div><div class="muted">${notes ? nl(notes) : '—'}</div></div>
    <div><div class="label">Disclaimer</div><div class="muted" style="font-size:.9em">${disc}</div></div></div>`;
}

/** Mix a hex colour with white: tint('#1F3A8A', 0.9) is a very light blue. */
function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) + (255 - ((n >> shift) & 255)) * amount);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

const BASE_CSS = `
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1c1c1e; line-height: 1.45; }
h1, h2, h3, p { margin: 0; }
.muted { color: #666; overflow-wrap: anywhere; }
.r { text-align: right; white-space: nowrap; }
.page { position: relative; display: flex; flex-direction: column; overflow: hidden; }
.grow { flex: 1; }
table { width: 100%; border-collapse: collapse; }
.label { font-size: .78em; text-transform: uppercase; letter-spacing: .8px; font-weight: 700; margin-bottom: 3px; }
.items td, .items th { padding: 9px 10px; vertical-align: top; }
.items th { text-align: left; font-size: .82em; text-transform: uppercase; letter-spacing: .5px; }
.items th.r { text-align: right; }
.items small { display: block; color: #666; font-size: .86em; margin-top: 1px; }
.tot td { padding: 4px 10px; }
.tot .grand td { font-weight: 800; font-size: 1.12em; }
.tot .due td { font-weight: 700; }
.badge { display: inline-block; padding: 2px 9px; border-radius: 20px; font-weight: 700; font-size: .72em; letter-spacing: .7px; border: 1.5px solid currentColor; }
.logo { max-height: 62px; max-width: 170px; object-fit: contain; display: block; }
.sig img { max-height: 58px; max-width: 170px; object-fit: contain; display: block; }
.sig .stamp { max-height: 74px; }
.sig .name { font-weight: 700; }
.extra { margin-top: 14px; }
.extra table td, .extra table th { padding: 5px 8px; border-bottom: 1px solid #e3e3e6; text-align: left; font-size: .93em; }
.extra table th { font-size: .78em; text-transform: uppercase; letter-spacing: .5px; color: #555; }
.extra .r { text-align: right; }
.two { display: flex; gap: 22px; align-items: flex-start; }
.two > * { flex: 1; min-width: 0; }
.tail { display: flex; gap: 22px; margin-top: 16px; padding-top: 10px; border-top: 1px dashed #c9c9cf; }
.tail > * { flex: 1; min-width: 0; }
`;

function shell(title: string, paper: Paper, css: string, body: string, vars = ''): string {
  const s = PAPER_SIZE[paper];
  const thermal = paper === 'thermal' || paper === 'thermal58';
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=${s.px}"/><title>${esc(title)}</title>
<style>
@page { size: ${s.css}; margin: ${thermal ? '3mm' : '0'}; }
:root { ${vars} }
body { font-size: ${thermal ? 10 : paper === 'A5' ? 9 : 12}px; }
.page { ${thermal ? 'padding: 6px;' : `min-height: ${s.mm}mm;`} }
${BASE_CSS}${css}
</style></head><body>${body}</body></html>`;
}

// ---------------------------------------------------------------- Urdu documents

/** Urdu for the fixed words printed on documents. Business names, items and notes are left as typed. */
const UR: Record<string, string> = {
  INVOICE: 'انوائس', QUOTATION: 'کوٹیشن', PURCHASE: 'خریداری', 'PURCHASE ORDER': 'خریداری آرڈر', 'GOODS RECEIVED': 'وصول شدہ مال',
  'DEBIT NOTE': 'ڈیبٹ نوٹ', 'CREDIT NOTE': 'کریڈٹ نوٹ', RECEIPT: 'رسید', 'PAYMENT RECEIPT': 'ادائیگی کی رسید',
  'Invoice to': 'بنام', 'Quotation for': 'برائے', 'Bought from': 'خریدا از', Supplier: 'سپلائر', 'Received from': 'وصول از', 'Debit to': 'بنام', 'Credit to': 'بنام',
  Invoice: 'انوائس', Quote: 'کوٹیشن', Purchase: 'خریداری', PO: 'آرڈر', GRN: 'وصولی', 'Debit note': 'ڈیبٹ نوٹ', 'Credit note': 'کریڈٹ نوٹ',
  No: 'نمبر', 'No.': 'نمبر', 'Item description': 'تفصیل', Items: 'اشیاء', Price: 'قیمت', Qty: 'مقدار', 'Disc.': 'رعایت', Tax: 'ٹیکس', 'Tax (included)': 'ٹیکس (شامل)',
  Total: 'کل', 'Sub total': 'ذیلی کل', 'Grand total': 'کل رقم', 'Item discounts': 'اشیاء پر رعایت', Discount: 'رعایت', Rounding: 'راؤنڈنگ',
  Paid: 'ادا شدہ', 'Balance due': 'بقایا رقم', Date: 'تاریخ', 'Due date': 'آخری تاریخ', 'Valid until': 'کارآمد تا', 'Deliver by': 'ترسیل تا', Received: 'وصول', Recorded: 'درج', Against: 'بمقابلہ',
  Notes: 'نوٹس', Disclaimer: 'اعلان', 'Payment details': 'ادائیگی کی تفصیل', 'Installment schedule': 'اقساط کا شیڈول', 'Payments received': 'وصول شدہ ادائیگیاں',
  'Authorized signature': 'مجاز دستخط', Reference: 'حوالہ', Ref: 'حوالہ', Method: 'طریقہ', 'Transaction ID': 'ٹرانزیکشن آئی ڈی', Amount: 'رقم', Receipt: 'رسید', Due: 'واجب',
  Status: 'حالت', Details: 'تفصیلات', 'Payment method': 'ادائیگی کا طریقہ', 'Received by': 'وصول کنندہ', 'This payment': 'یہ ادائیگی', 'Bank details': 'بینک کی تفصیل',
  'Thank you for your business!': 'آپ کے کاروبار کا شکریہ!', 'Scan to pay': 'ادائیگی کے لیے اسکین کریں', 'Scan to view online': 'آن لائن دیکھنے کے لیے اسکین کریں',
  'Bank information': 'بینک کی معلومات', 'Terms and conditions': 'شرائط و ضوابط', 'Payment terms': 'ادائیگی کی شرائط', 'Office address': 'دفتر کا پتہ',
  'Amount received': 'وصول شدہ رقم', 'Applied to': 'برائے', 'Bill to': 'بنام', Client: 'کلائنٹ', 'Payment info': 'ادائیگی کی معلومات',
  PAID: 'ادا شدہ', UNPAID: 'غیر ادا شدہ', OVERDUE: 'واجب الادا', 'PARTIALLY PAID': 'جزوی ادا', DRAFT: 'مسودہ', To: 'بنام',
};
const UR_CSS = `.ur { font-family: 'Noto Nastaliq Urdu', 'Jameel Noori Nastaleeq', 'Noto Naskh Arabic', serif; direction: rtl; unicode-bidi: isolate; }`;

/** Put Urdu next to (or instead of) the fixed English words of a finished document. */
export function localize(html: string, lang: DocLanguage): string {
  if (lang === 'en') return html;
  const swapped = html.replace(/>([^<>]{1,40})</g, (m, raw: string) => {
    const text = raw.trim();
    const colon = text.endsWith(':') ? ':' : '';
    const ur = UR[text] ?? UR[text.replace(/[:#]\s*$/, '').trim()];
    if (!ur) return m;
    return lang === 'ur' ? `><span class="ur">${ur}${colon}</span><` : `>${raw} <span class="ur">${ur}${colon}</span><`;
  });
  return swapped.replace('</style>', `${UR_CSS}</style>`);
}

// ---------------------------------------------------------------- QR code on invoices

const QR_CSS = '.qrbox { display: flex; gap: 12px; align-items: center; } .qrbox svg { width: 92px; height: 92px; display: block; }';

function qrFor(d: InvoiceDoc): { svg: string; label: string; hint: string } | null {
  const b = d.business;
  const mode = b.qrMode ?? 'none';
  if (mode === 'none' || (d.docType && d.docType !== 'invoice' && d.docType !== 'debitNote')) return null;
  if (mode === 'portal') {
    if (!d.client.portalToken) return null;
    const url = `${API_URL}/p/${d.client.portalToken}`;
    return { svg: qrSvg(url), label: 'Scan to view online', hint: url };
  }
  const lines = [b.tradingName || b.legalName, b.iban && `IBAN: ${b.iban}`, b.bankDetails, d.invoice.number && `Ref: ${d.invoice.number}`, `Amount: ${formatMoney(d.invoice.balance || d.invoice.total, d.invoice.currency, d.invoice.currencyPrecision)}`].filter(Boolean);
  if (!b.iban && !b.bankDetails) return null;
  return { svg: qrSvg(lines.join('\n')), label: 'Scan to pay', hint: b.iban ? `IBAN ${b.iban}` : 'Bank details' };
}

/** A credit note, printed with the invoice designs. */
export function creditNoteHtml(n: CreditNote, client: Client, b: BusinessProfile, paper: Paper = 'A5', template?: InvoiceTemplate): string {
  const invoice = {
    id: n.id, number: n.number, businessId: n.businessId, clientId: n.clientId, clientName: n.clientName, businessName: b.tradingName || b.legalName,
    issueDate: n.date, dueDate: n.date, reference: `Against ${n.invoiceNumber}`, billingAddress: '',
    lines: n.lines.map((l) => ({ serviceId: null, name: l.name, description: '', qty: l.qty, unit: l.unit, unitPrice: l.unitPrice, discountType: 'percent', discountValue: 0, taxRateBp: 0, lineTotal: l.amount })),
    overallDiscountType: 'percent', overallDiscountValue: 0, charges: [], notes: n.reason, paymentTerms: '', installments: [], status: 'final', displayStatus: n.status === 'cancelled' ? 'cancelled' : '',
    currency: n.currency, currencyPrecision: n.currencyPrecision, taxInclusive: false, rounding: 'none', subtotal: n.total, itemDiscounts: 0, overallDiscount: 0, taxableAmount: n.total, taxAmount: 0,
    chargesTotal: 0, roundingAdjustment: 0, total: n.total, paid: 0, balance: 0, createdAt: n.createdAt, finalizedAt: n.createdAt,
  } as unknown as Invoice;
  return invoiceHtml({ docType: 'creditNote', invoice, business: b, client, payments: [] }, paper, template);
}

// ---------------------------------------------------------------- shared invoice pieces

/** Custom fields marked "print on invoices", kept current by the workspace store. */
let printFields: CustomField[] = [];
export function setPrintFields(fields: CustomField[]) {
  printFields = fields.filter((f) => f.showOnPdf);
}
function printedValues(entity: 'client' | 'invoice', values: CustomValues | undefined): [string, string][] {
  return printFields
    .filter((f) => f.entity === entity)
    .map((f): [string, string] => {
      const v = customValueText(f, values?.[f.id]);
      return [f.label, f.type === 'date' && /^d{4}-d{2}-d{2}$/.test(v) ? fd(v) : v];
    })
    .filter(([, v]) => !!v);
}

interface InvoiceDoc {
  /** what the document is; quotations and purchases reuse the invoice designs with their own wording */
  docType?: 'invoice' | 'quotation' | 'purchase' | 'order' | 'receipt' | 'debitNote' | 'creditNote';
  invoice: Invoice;
  business: BusinessProfile;
  client: Client;
  payments: Payment[];
  /** extra label/value rows printed as "Payment details" (purchases) */
  info?: [string, string][];
}

function parts(d: InvoiceDoc) {
  const { invoice: i, business: b, client: c } = d;
  const m = (v: number) => formatMoney(v, i.currency, i.currencyPrecision);
  const hasDisc = i.lines.some((l) => l.discountValue > 0);
  const hasTax = i.lines.some((l) => l.taxRateBp > 0);
  const head = `<tr><th>No</th><th>Item description</th><th class="r">Price</th><th class="r">Qty</th>${hasDisc ? '<th class="r">Disc.</th>' : ''}${hasTax ? '<th class="r">Tax</th>' : ''}<th class="r">Total</th></tr>`;
  const rows = i.lines
    .map((l, n) => {
      const disc = l.discountValue > 0 ? (l.discountType === 'percent' ? `${percentToString(l.discountValue)}%` : m(l.discountValue)) : '';
      return `<tr><td>${String(n + 1).padStart(2, '0')}.</td><td><b>${esc(l.name)}</b>${l.description ? `<small>${nl(l.description)}</small>` : ''}</td>
        <td class="r">${m(l.unitPrice)}</td><td class="r">${qtyToString(l.qty)} ${esc(l.unit)}</td>${hasDisc ? `<td class="r">${disc}</td>` : ''}${hasTax ? `<td class="r">${l.taxRateBp ? percentToString(l.taxRateBp) + '%' : ''}</td>` : ''}
        <td class="r">${m(l.lineTotal ?? 0)}</td></tr>`;
    })
    .join('');
  const t = (k: string, v: string, cls = '') => `<tr class="${cls}"><td>${k}</td><td class="r">${v}</td></tr>`;
  const sub = [
    t('Sub total', m(i.subtotal)),
    i.itemDiscounts ? t('Item discounts', `− ${m(i.itemDiscounts)}`) : '',
    i.overallDiscount ? t(`Discount${i.overallDiscountType === 'percent' ? ` ${percentToString(i.overallDiscountValue)}%` : ''}`, `− ${m(i.overallDiscount)}`) : '',
    i.taxAmount ? t(i.taxInclusive ? 'Tax (included)' : 'Tax', m(i.taxAmount)) : '',
    ...i.charges.map((ch) => t(esc(ch.label), m(ch.amount))),
    i.roundingAdjustment ? t('Rounding', m(i.roundingAdjustment)) : '',
  ].join('');
  const grand = t(i.status === 'final' && i.paid > 0 ? 'Total' : 'Grand total', m(i.total), 'grand');
  const paidRows = i.status === 'final' && i.paid > 0 ? t('Paid', m(i.paid)) + t('Balance due', m(i.balance), 'due') : '';

  const paid = d.payments.filter((p) => p.verificationStatus !== 'rejected');
  const paymentRows = paid
    .map((p) => `<tr><td>${fd(p.date)}</td><td>${esc(p.number)}</td><td>${PAYMENT_METHOD_LABELS[p.method]}</td><td>${esc(txnId(p.method, p.reference))}</td><td class="r">${m(p.allocations.find((x) => x.invoiceId === i.id)?.amount ?? 0)}</td></tr>`)
    .join('');
  const info = (d.info ?? []).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${esc(v)}</td></tr>`).join('');
  const details = printedValues('invoice', i.custom).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${esc(v)}</td></tr>`).join('');
  const schedule = i.installments
    .map((s, n) => `<tr><td>${n + 1}</td><td>${fd(s.dueDate)}</td><td>${s.status === 'paid' ? 'Paid' : s.status === 'partial' ? `Part paid ${m(s.paid ?? 0)}` : s.status === 'overdue' ? 'Overdue (unpaid)' : 'Unpaid'}</td><td class="r">${m(s.amount)}</td></tr>`)
    .join('');
  const qr = qrFor(d);
  const extras = `${qr ? `<div class="extra qrbox"><div>${qr.svg}</div><div><div class="label">${qr.label}</div><div class="muted">${esc(qr.hint)}</div></div></div>` : ''}${details ? `<div class="extra"><div class="label">Details</div><table>${details}</table></div>` : ''}${info ? `<div class="extra"><div class="label">Payment details</div><table>${info}</table></div>` : ''}${schedule ?`<div class="extra"><div class="label">Installment schedule</div><table><tr><th>#</th><th>Due</th><th>Status</th><th class="r">Amount</th></tr>${schedule}</table></div>` : ''}
    ${paymentRows ? `<div class="extra"><div class="label">Payments received</div><table><tr><th>Date</th><th>Receipt</th><th>Method</th><th>Transaction ID</th><th class="r">Amount</th></tr>${paymentRows}</table></div>` : ''}
    ${tailHtml(i.notes, b)}`;

  const purchase = d.docType === 'purchase' || d.docType === 'order' || d.docType === 'receipt';
  const bank = purchase ? '' : [b.bankDetails && nl(b.bankDetails), b.iban && `IBAN: ${esc(b.iban)}`, b.paymentInstructions && nl(b.paymentInstructions)].filter(Boolean).join('<br/>');
  const name = esc(b.tradingName || b.legalName);
  const clientLines = [esc(c.contactPerson), nl(i.billingAddress || [c.address, c.city, c.province, c.country].filter(Boolean).join(', ')), esc(c.phone), esc(c.email), c.ntn && `NTN: ${esc(c.ntn)}`, ...printedValues('client', c.custom).map(([k, v]) => `${esc(k)}: ${esc(v)}`)].filter(Boolean).join('<br/>');
  const issuerLines = [nl(b.address), b.ntn && `NTN: ${esc(b.ntn)}`, b.registrationNo && `Reg: ${esc(b.registrationNo)}`].filter(Boolean).join('<br/>');
  const logo = b.logo ? `<img class="logo" src="${esc(b.logo)}" alt=""/>` : '';
  const sig = `<div class="sig">${b.stamp ? `<img class="stamp" src="${esc(b.stamp)}" alt=""/>` : ''}${b.signature ? `<img src="${esc(b.signature)}" alt=""/>` : '<div style="height:44px"></div>'}
    <div class="name">${esc(b.ownerName || b.tradingName || b.legalName)}</div><div class="muted">Authorized signature</div></div>`;
  const contacts = [b.phone, b.email, b.website].filter(Boolean).map(esc);
  return {
    L: LABELS[d.docType ?? (i.docType === 'debit_note' ? 'debitNote' : 'invoice')],
    i, b, c, m, head, rows, sub, grand, paidRows, extras, bank, name, clientLines, issuerLines, logo, sig, contacts,
    number: esc(i.number ?? 'DRAFT'),
    status: STATUS[i.displayStatus] ?? '',
    terms: i.paymentTerms ? nl(i.paymentTerms) : '',
    // notes are printed once, in the Notes / Disclaimer section at the end
    notes: '',
    payFallback: purchase ? (d.info ?? []).map(([k, v]) => `${esc(k)}: ${esc(v)}`).join('<br/>') : 'Cash or bank transfer',
    footer: b.invoiceFooter ? nl(b.invoiceFooter) : 'Thank you for your business!',
    initial: esc((b.tradingName || b.legalName || '?').trim().charAt(0).toUpperCase()),
  };
}
type Parts = ReturnType<typeof parts>;

const block = (label: string, html: string) => (html ? `<div style="margin-bottom:12px"><div class="label">${label}</div><div class="muted">${html}</div></div>` : '');

// ---------------------------------------------------------------- the four designs

function amber(p: Parts): [string, string] {
  const css = `
.page { padding: 0 44px 0 34px; }
.stripe { position: absolute; top: 0; right: 0; bottom: 0; width: 16px; background: var(--d); }
.band { margin-left: -34px; width: 66%; background: var(--a); color: #fff; padding: 20px 34px; font-size: 1.5em; font-weight: 300; letter-spacing: 3px; text-transform: uppercase; clip-path: polygon(0 0, 100% 0, 90% 100%, 0 100%); display: flex; align-items: center; gap: 12px; }
.band .logo { max-height: 44px; }
.top { display: flex; justify-content: space-between; align-items: flex-end; margin: 26px 0 18px; }
.top h1 { font-size: 2.6em; letter-spacing: 3px; color: var(--d); font-weight: 800; line-height: 1; }
.label { color: var(--a); }
.items th { background: var(--a); color: #fff; }
.items th:first-child, .items th:nth-child(2) { background: var(--d); }
.items tr:nth-child(even) td { background: #f1f1f2; }
.tot { width: 100%; }
.tot td { background: #f1f1f2; border-bottom: 2px solid #fff; }
.tot td:first-child { background: var(--a); color: #fff; font-weight: 700; width: 46%; }
.tot .grand td { background: var(--a); color: #fff; }
.tot .due td:last-child { background: var(--d); color: #fff; }
.foot { margin: 22px -44px 0 -34px; background: var(--d); color: #fff; padding: 12px 34px; display: flex; gap: 22px; flex-wrap: wrap; font-size: .88em; }
.thanks { color: var(--a); font-style: italic; margin-top: 14px; }`;
  const body = `<div class="page"><div class="stripe"></div>
    <div class="band">${p.logo}<span>${p.name}</span></div>
    <div class="top"><div><div class="label">${p.L.to}</div><b style="font-size:1.15em">${esc(p.c.name)}</b><div class="muted">${p.clientLines}</div></div>
      <div class="r"><h1>${p.L.title}</h1><div style="margin-top:8px"><span class="muted">${p.L.short} #</span> <b>${p.number}</b><br/><span class="muted">Date</span> ${fd(p.i.issueDate)}<br/><span class="muted">${p.L.due}</span> ${fd(p.i.dueDate)}${p.i.reference ? `<br/><span class="muted">Ref</span> ${esc(p.i.reference)}` : ''}</div><div class="badge" style="color:var(--a);margin-top:5px">${p.status}</div></div></div>
    <table class="items">${p.head}${p.rows}</table>
    <div class="two" style="margin-top:18px"><div>${block('Terms and conditions', p.terms)}${block('Bank information', p.bank)}${block('Notes', p.notes)}</div>
      <div><table class="tot">${p.sub}${p.grand}${p.paidRows}</table><div style="margin-top:22px">${p.sig}</div></div></div>
    ${p.extras}
    <div class="grow"></div><div class="thanks">${p.footer}</div>
    <div class="foot">${p.issuerLines ? `<span>${p.issuerLines.replace(/<br\/>/g, ' · ')}</span>` : ''}${p.contacts.map((c) => `<span>${c}</span>`).join('')}</div></div>`;
  return [css, body];
}

function ocean(p: Parts): [string, string] {
  const shapes = `<i class="s s1"></i><i class="s s2"></i><i class="s s3"></i><i class="s s4"></i>`;
  const css = `
.hd { display: flex; align-items: stretch; height: 120px; }
.hd .brand { width: 30%; padding: 0 0 0 36px; display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 1.15em; color: var(--d); }
.hd .title { flex: 1; background: var(--a); border-bottom-left-radius: 34px; color: #fff; display: flex; align-items: center; padding-left: 40px; position: relative; overflow: hidden; }
.hd h1 { font-size: 2.7em; font-weight: 800; letter-spacing: 2px; }
.s { position: absolute; display: block; }
.s1 { right: -30px; top: -30px; width: 120px; height: 120px; border-radius: 50%; background: var(--l2); }
.s2 { right: 96px; top: 0; width: 60px; height: 60px; border-bottom-left-radius: 60px; background: var(--l1); }
.s3 { right: 60px; bottom: 0; width: 70px; height: 70px; border-top-right-radius: 70px; background: var(--l2); opacity: .85; }
.s4 { right: 150px; bottom: 16px; width: 20px; height: 20px; border-radius: 50%; background: var(--l1); }
.meta { display: flex; justify-content: space-between; padding: 26px 36px 18px; }
.label { color: var(--a); }
.cols { display: flex; padding: 0 36px 0 0; gap: 22px; border-top: 2px solid var(--a); border-bottom: 2px solid var(--a); margin-left: 0; }
.side { width: 27%; background: #e9ebef; border-radius: 0 26px 26px 0; padding: 22px 16px 22px 36px; }
.side .label { color: #1c1c1e; }
.main { flex: 1; padding: 10px 0 16px; min-width: 0; }
.items th { border-bottom: 2px solid var(--a); padding-top: 12px; padding-bottom: 12px; }
.tot { width: 62%; margin-left: auto; margin-top: 8px; }
.tot td:first-child { font-weight: 700; text-transform: uppercase; font-size: .9em; }
.tot .grand td { border-top: 2px solid var(--a); color: var(--a); }
.under { padding: 6px 36px; }
.sigwrap { display: flex; justify-content: flex-end; padding: 18px 60px 10px; }
.ft { background: var(--a); color: #fff; height: 96px; margin-top: 16px; display: flex; flex-direction: column; justify-content: center; padding-left: 36%; position: relative; overflow: hidden; font-size: 1.02em; }
.ft b { font-size: 1.1em; }
.ft .s1 { right: -40px; top: 16px; width: 150px; height: 150px; }
.ft .s2 { left: 0; right: auto; top: 0; width: 130px; height: 96px; border-radius: 0 0 96px 0; }
.ft .s3 { left: 140px; right: auto; bottom: auto; top: 30px; width: 26px; height: 26px; border-radius: 50%; }`;
  const body = `<div class="page">
    <div class="hd"><div class="brand">${p.logo || ''}<span>${p.name}</span></div><div class="title"><h1>${p.L.title}</h1>${shapes}</div></div>
    <div class="meta"><div><span class="label">${p.L.to}:</span> <b style="font-size:1.25em">${esc(p.c.name)}</b><div class="muted" style="margin-top:4px">${p.clientLines}</div></div>
      <div><b>${p.L.short} No:</b> ${p.number}<br/><b>Date:</b> ${fd(p.i.issueDate)}<br/><b>${p.L.due}:</b> ${fd(p.i.dueDate)}${p.i.reference ? `<br/><b>Reference:</b> ${esc(p.i.reference)}` : ''}<br/><span class="badge" style="color:var(--a);margin-top:4px">${p.status}</span></div></div>
    <div class="cols"><div class="side">${block('Payment method', p.bank || p.payFallback)}${block('Terms &amp; conditions', p.terms)}${block('Notes', p.notes)}</div>
      <div class="main"><table class="items">${p.head}${p.rows}</table><table class="tot">${p.sub}${p.grand}${p.paidRows}</table></div></div>
    <div class="under">${p.extras}</div>
    <div class="sigwrap">${p.sig}</div>
    <div class="grow"></div>
    <div class="ft"><i class="s s1" style="background:var(--l2)"></i><i class="s s2"></i><i class="s s3"></i>${p.contacts.map((c, n) => (n === 0 ? `<b>${c}</b>` : `<span>${c}</span>`)).join('') || `<b>${p.footer}</b>`}</div></div>`;
  return [css, body];
}

function violet(p: Parts): [string, string] {
  const css = `
.page { padding: 46px 48px 34px; }
.hd { display: flex; justify-content: space-between; align-items: flex-start; }
.hd .brand { font-size: 1.7em; font-weight: 800; line-height: 1.1; }
.hd .brand .logo { margin-bottom: 8px; }
.hd h1 { font-size: 2.6em; color: var(--a); letter-spacing: 3px; font-weight: 800; line-height: 1; }
.addr { display: flex; justify-content: space-between; margin: 30px 0 26px; }
.items th { background: var(--a); color: #fff; padding: 12px 14px; text-transform: none; font-size: .95em; letter-spacing: 0; }
.items td { padding: 13px 14px; border-bottom: 1.5px solid #222; }
.tot { width: 52%; margin-left: auto; margin-top: 12px; }
.tot td:first-child { color: var(--a); font-weight: 700; text-transform: uppercase; text-align: right; }
.tot .grand td { background: var(--a); color: #fff !important; padding: 12px 14px; font-size: 1.2em; }
.tot .due td { color: var(--a); }
.thanks { color: var(--a); font-weight: 800; font-size: 1.15em; margin-top: 26px; }
.ft { border-top: 1.5px solid var(--a); margin-top: 18px; padding-top: 14px; display: flex; gap: 22px; }
.ft > div { flex: 1; font-size: .9em; }
.label { color: var(--a); text-transform: none; font-size: 1em; letter-spacing: 0; }`;
  const body = `<div class="page">
    <div class="hd"><div class="brand">${p.logo}${p.name}<span style="color:var(--a)">.</span></div>
      <div class="r"><h1>${p.L.title}</h1><div style="font-weight:700;margin-top:6px">${fd(p.i.issueDate)}</div><div class="muted">${p.number} · ${p.L.dueLower} ${fd(p.i.dueDate)}</div><span class="badge" style="color:var(--a);margin-top:4px">${p.status}</span></div></div>
    <div class="addr"><div><b>Office address</b><div class="muted">${p.issuerLines || '&#160;'}</div>${p.b.phone ? `<div style="margin-top:8px;font-weight:700">${esc(p.b.phone)}</div>` : ''}</div>
      <div style="min-width:36%"><b>To:</b><br/><b>${esc(p.c.name)}</b><div class="muted">${p.clientLines}</div>${p.i.reference ? `<div class="muted">Ref: ${esc(p.i.reference)}</div>` : ''}</div></div>
    <table class="items">${p.head}${p.rows}</table>
    <div class="two" style="margin-top:6px"><div style="padding-top:18px">${block('Note:', p.notes)}</div><div><table class="tot" style="width:100%">${p.sub}${p.grand}${p.paidRows}</table></div></div>
    ${p.extras}
    <div class="two" style="margin-top:20px;align-items:flex-end"><div class="thanks">${p.footer}</div><div style="display:flex;justify-content:flex-end">${p.sig}</div></div>
    <div class="grow"></div>
    <div class="ft"><div><div class="label">Questions?</div><span class="muted">${p.contacts.join('<br/>') || '&#160;'}</span></div>
      <div><div class="label">Payment info:</div><span class="muted">${p.bank || '&#160;'}</span></div>
      <div><div class="label">Terms &amp; conditions:</div><span class="muted">${p.terms || '&#160;'}</span></div></div></div>`;
  return [css, body];
}

function crimson(p: Parts): [string, string] {
  const css = `
.page { padding: 44px 42px 36px; }
.hd { display: flex; justify-content: space-between; align-items: flex-start; }
.brand { display: flex; gap: 10px; align-items: center; }
.mark { width: 40px; height: 40px; background: var(--a); color: #fff; font-weight: 800; font-size: 1.6em; display: flex; align-items: center; justify-content: center; }
.brand b { font-size: 1.15em; letter-spacing: .5px; text-transform: uppercase; display: block; }
.hd h1 { font-size: 2.7em; font-weight: 800; color: var(--d); letter-spacing: 1px; line-height: 1; }
.info { display: flex; justify-content: space-between; gap: 24px; margin: 30px 0 24px; align-items: flex-start; }
.box { background: #e9ebec; border-left: 8px solid var(--a); padding: 16px 22px; display: flex; gap: 30px; min-width: 46%; }
.items th { background: var(--a); color: #fff; padding: 11px 14px; font-size: .95em; }
.items td { padding: 13px 14px; background: #e3e6e7; }
.items tr:nth-child(odd) td { background: #d4d8d9; }
.tot { width: 100%; }
.tot td:first-child { text-align: right; font-weight: 700; }
.tot .grand td { background: var(--a); color: #fff; padding: 10px 14px; }
.thanks { color: var(--a); font-weight: 800; font-size: 1.25em; }
.label { color: var(--d); text-transform: none; font-size: 1em; letter-spacing: 0; }`;
  const body = `<div class="page">
    <div class="hd"><div><div class="brand">${p.logo || `<div class="mark">${p.initial}</div>`}<div><b>${p.name}</b></div></div><div class="muted" style="margin-top:8px">${p.issuerLines}</div></div>
      <div><h1>${p.L.title}</h1><div class="muted" style="margin-top:4px">#${p.number} <span class="badge" style="color:var(--a);margin-left:6px">${p.status}</span></div></div></div>
    <div class="info"><div><div class="label" style="text-transform:uppercase">${p.L.to}:</div><b>${esc(p.c.name)}</b><div class="muted">${p.clientLines}</div></div>
      <div class="box"><div><b>${p.L.short} number</b><div class="muted">${p.number}</div></div><div><b>Date</b><div class="muted">${fd(p.i.issueDate)}</div></div><div><b>${p.L.due}</b><div class="muted">${fd(p.i.dueDate)}</div></div></div></div>
    <table class="items">${p.head}${p.rows}</table>
    <div class="two" style="margin-top:20px"><div><div class="two" style="gap:14px"><div>${block('Payment method', p.bank || p.payFallback)}</div><div>${block('Terms &amp; condition', p.terms)}</div></div>${p.notes ? `<div class="muted">${p.notes}</div>` : ''}</div>
      <div><table class="tot">${p.sub}${p.grand}${p.paidRows}</table></div></div>
    ${p.extras}
    <div class="two" style="margin-top:26px;align-items:flex-end"><div>${p.sig}</div><div class="r" style="white-space:normal"><div class="thanks">${p.footer}</div><div class="muted" style="margin-top:6px">${p.contacts.join(' &#160;·&#160; ')}</div></div></div>
    <div class="grow"></div></div>`;
  return [css, body];
}

function classic(p: Parts): [string, string] {
  const css = `
.page { padding: 40px 44px; }
.hd { display: flex; justify-content: space-between; gap: 16px; }
.hd h1 { font-size: 2em; letter-spacing: 1px; }
.rule { border: 0; border-top: 1.5px solid #111; margin: 12px 0; }
.items th { border-bottom: 1.5px solid #111; }
.items td { border-bottom: 1px solid #ddd; }
.tot { width: 55%; margin-left: auto; margin-top: 10px; }
.tot .grand td { border-top: 1.5px solid #111; }
.label { color: #555; }`;
  const body = `<div class="page"><div class="hd"><div>${p.logo}<h2>${p.name}</h2><div class="muted">${p.issuerLines}${p.contacts.length ? `<br/>${p.contacts.join(' · ')}` : ''}</div></div>
      <div class="r"><h1>${p.L.title}</h1><b>${p.number}</b><br/><span class="badge">${p.status}</span></div></div><hr class="rule"/>
    <div class="two"><div><div class="label">Bill to</div><b>${esc(p.c.name)}</b><div class="muted">${p.clientLines}</div></div>
      <div class="r"><span class="muted">Date:</span> ${fd(p.i.issueDate)}<br/><span class="muted">${p.L.due}:</span> ${fd(p.i.dueDate)}${p.i.reference ? `<br/><span class="muted">Reference:</span> ${esc(p.i.reference)}` : ''}</div></div>
    <table class="items" style="margin-top:12px">${p.head}${p.rows}</table><table class="tot">${p.sub}${p.grand}${p.paidRows}</table>
    ${p.extras}<div style="margin-top:14px">${block('Payment terms', p.terms)}${block('Payment details', p.bank)}${block('Notes', p.notes)}</div>
    <div style="display:flex;justify-content:flex-end;margin-top:18px">${p.sig}</div><div class="grow"></div><div class="muted" style="text-align:center;margin-top:16px">${p.footer}</div></div>`;
  return [css, body];
}

const DESIGNS: Record<InvoiceTemplate, (p: Parts) => [string, string]> = { amber, ocean, violet, crimson, classic };

function colorVars(template: InvoiceTemplate, accentOverride: string): string {
  const base = TEMPLATE_COLORS[template];
  const a = accentOverride || base.accent;
  return `--a: ${a}; --d: ${base.dark}; --l1: ${tint(a, 0.55)}; --l2: ${tint(a, 0.3)};`;
}

export function invoiceHtml(d: InvoiceDoc, paper: Paper = 'A4', template?: InvoiceTemplate): string {
  // narrow receipt rolls always use the plain layout
  const chosen: InvoiceTemplate = paper === 'thermal' || paper === 'thermal58' ? 'classic' : (template ?? d.business.invoiceTemplate ?? 'amber');
  const [css, body] = DESIGNS[chosen](parts(d));
  const html = shell(`${d.docType === 'quotation' ? 'Quotation' : d.docType === 'purchase' ? 'Purchase' : 'Invoice'} ${d.invoice.number ?? 'Draft'}`, paper, css + QR_CSS, body, colorVars(chosen, chosen === (d.business.invoiceTemplate ?? 'amber') ? d.business.accentColor : ''));
  return localize(html, d.business.docLanguage ?? 'en');
}

// ---------------------------------------------------------------- receipt and statement

const SIMPLE_CSS = `
.page { padding: 0 0 30px; }
.bar { background: var(--a); color: #fff; padding: 26px 40px; display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.bar h1 { font-size: 1.7em; letter-spacing: 1.5px; }
.bar .logo { max-height: 46px; background: #fff; border-radius: 6px; padding: 3px; }
.in { padding: 22px 40px 0; }
.label { color: var(--a); }
.amount { font-size: 2.1em; font-weight: 800; color: var(--a); }
.kv td { padding: 7px 4px; border-bottom: 1px solid #e3e3e6; }
.items th { background: var(--a); color: #fff; }
.items td { border-bottom: 1px solid #e3e3e6; }`;

function simpleHead(b: BusinessProfile, title: string, right: string) {
  return `<div class="bar"><div style="display:flex;gap:12px;align-items:center">${b.logo ? `<img class="logo" src="${esc(b.logo)}" alt=""/>` : ''}<div><b style="font-size:1.25em">${esc(b.tradingName || b.legalName)}</b><div style="opacity:.85;font-size:.9em">${[b.phone, b.email].filter(Boolean).map(esc).join(' · ')}</div></div></div>
    <div class="r"><h1>${title}</h1>${right}</div></div>`;
}
function simpleSig(b: BusinessProfile) {
  return `<div style="display:flex;justify-content:flex-end;margin-top:26px"><div class="sig">${b.stamp ? `<img class="stamp" src="${esc(b.stamp)}" alt=""/>` : ''}${b.signature ? `<img src="${esc(b.signature)}" alt=""/>` : '<div style="height:44px"></div>'}<div class="name">${esc(b.ownerName || b.tradingName || b.legalName)}</div><div class="muted">Authorized signature</div></div></div>`;
}
const simpleVars = (b: BusinessProfile) => colorVars(b.invoiceTemplate === 'classic' ? 'classic' : (b.invoiceTemplate ?? 'amber'), b.accentColor);

export function receiptHtml(d: { payment: Payment; business: BusinessProfile; client: Client; invoices: Invoice[] }, paper: Paper = 'A5'): string {
  const { payment: p, business: b, client: c, invoices } = d;
  const m = (v: number) => formatMoney(v, p.currency, p.currencyPrecision);
  const installment = invoices.some((i) => i.installments.length > 0);
  const applied = p.allocations
    .map((a) => {
      const inv = invoices.find((i) => i.id === a.invoiceId);
      return `<tr><td>${esc(a.invoiceNumber ?? '')}</td><td class="r">${inv ? m(inv.total) : ''}</td><td class="r">${m(a.amount)}</td><td class="r">${inv ? m(inv.balance) : ''}</td></tr>`;
    })
    .join('');
  const state = p.verificationStatus === 'rejected' ? '<span class="badge">REJECTED</span>' : p.verificationStatus === 'pending' ? '<span class="badge">PENDING VERIFICATION</span>' : '';
  return shell(
    `Receipt ${p.number}`,
    paper,
    SIMPLE_CSS,
    `<div class="page">${simpleHead(b, installment ? 'INSTALLMENT RECEIPT' : 'PAYMENT RECEIPT', `<b>${esc(p.number)}</b> · ${fd(p.date)}<br/>${state}`)}
    <div class="in"><div class="two"><div><div class="label">Received from</div><b style="font-size:1.15em">${esc(c.name)}</b><div class="muted">${[esc(c.contactPerson), esc(c.phone)].filter(Boolean).join('<br/>')}</div></div>
      <div class="r"><div class="label">Amount received</div><div class="amount">${m(p.amount)}</div></div></div>
    <table class="kv" style="margin-top:14px"><tr><td>Payment method</td><td class="r">${PAYMENT_METHOD_LABELS[p.method]}</td></tr>
      <tr><td>Transaction ID</td><td class="r">${esc(txnId(p.method, p.reference))}</td></tr><tr><td>Received by</td><td class="r">${esc(p.receivedBy)}</td></tr></table>
    ${tailHtml(p.notes, b)}
    ${applied ? `<div class="extra"><div class="label">Applied to</div><table class="items"><tr><th>Invoice</th><th class="r">Invoice total</th><th class="r">This payment</th><th class="r">Balance now</th></tr>${applied}</table></div>` : ''}
    ${p.unallocated > 0 ? `<div class="extra"><b>${m(p.unallocated)}</b> is held as an advance on the client's account.</div>` : ''}
    ${simpleSig(b)}</div><div class="grow"></div><div class="muted" style="text-align:center;margin-top:14px">${b.invoiceFooter ? nl(b.invoiceFooter) : ''}</div></div>`,
    simpleVars(b),
  );
}

/** Slip for one purchase bill: what was bought, from whom, and what was paid. */
export function purchaseSlipHtml(p: Purchase, b: BusinessProfile, paper: Paper = 'A5', template?: InvoiceTemplate): string {
  const plan = p.installments ?? [];
  const paid = p.paid ?? p.total;
  const balance = p.balance ?? 0;
  // a purchase printed with the same five invoice designs: the supplier stands where the client would
  const invoice = {
    id: p.id,
    number: p.number,
    businessId: p.businessId,
    clientId: '',
    clientName: p.supplier,
    businessName: b.tradingName || b.legalName,
    issueDate: p.date,
    dueDate: p.createdAt?.slice(0, 10) || p.date,
    reference: p.billNo ? `Supplier bill ${p.billNo}` : '',
    billingAddress: '',
    lines: p.lines.map((l) => ({ serviceId: null, name: l.name, description: '', qty: l.qty, unit: l.unit, unitPrice: l.unitPrice, discountType: 'percent', discountValue: 0, taxRateBp: 0, lineTotal: l.amount })),
    overallDiscountType: 'percent',
    overallDiscountValue: 0,
    charges: [],
    notes: p.notes,
    paymentTerms: '',
    installments: plan.map((x) => ({ dueDate: x.dueDate, amount: x.amount, paid: x.paid ? x.amount : 0, status: x.paid ? 'paid' : 'pending' })),
    status: 'final',
    displayStatus: balance <= 0 ? 'paid' : paid > 0 ? 'partially_paid' : 'unpaid',
    currency: p.currency,
    currencyPrecision: p.currencyPrecision,
    taxInclusive: false,
    rounding: 'none',
    subtotal: p.total,
    itemDiscounts: 0,
    overallDiscount: 0,
    taxableAmount: p.total,
    taxAmount: 0,
    chargesTotal: 0,
    roundingAdjustment: 0,
    total: p.total,
    paid,
    balance,
    createdAt: p.createdAt,
    finalizedAt: p.createdAt,
  } as unknown as Invoice;
  const supplier = { name: p.supplier } as Client;
  const info: [string, string][] = [
    ['Paid with', PAYMENT_METHOD_LABELS[p.method]],
    ['Transaction ID', txnId(p.method, p.reference ?? '')],
    ...(p.accountName ? [['Paid from', p.accountName] as [string, string]] : []),
    ['Category', p.category],
  ];
  return invoiceHtml({ docType: 'purchase', invoice, business: b, client: supplier, payments: [], info }, paper, template);
}

/** A purchase order or goods received note, printed with the invoice designs (supplier in the client's place). */
export function buyingDocHtml(
  kind: 'order' | 'receipt',
  doc: { id: string; number: string; businessId: string; date: string; dueDate: string; lines: { name: string; qty: number; unit: string; unitPrice: number; amount: number; note?: string }[]; total: number; notes: string; terms?: string; currency: string; currencyPrecision: number; createdAt: string; reference?: string },
  supplier: { name: string; contactPerson?: string; phone?: string; email?: string; address?: string; ntn?: string },
  b: BusinessProfile,
  paper: Paper = 'A4',
  template?: InvoiceTemplate,
): string {
  const invoice = {
    id: doc.id,
    number: doc.number,
    businessId: doc.businessId,
    clientId: '',
    clientName: supplier.name,
    businessName: b.tradingName || b.legalName,
    issueDate: doc.date,
    dueDate: doc.dueDate || doc.date,
    reference: doc.reference ?? '',
    billingAddress: '',
    lines: doc.lines.map((l) => ({ serviceId: null, name: l.name, description: l.note ?? '', qty: l.qty, unit: l.unit, unitPrice: l.unitPrice, discountType: 'percent', discountValue: 0, taxRateBp: 0, lineTotal: l.amount })),
    overallDiscountType: 'percent',
    overallDiscountValue: 0,
    charges: [],
    notes: doc.notes,
    paymentTerms: doc.terms ?? '',
    installments: [],
    status: 'final',
    displayStatus: '',
    currency: doc.currency,
    currencyPrecision: doc.currencyPrecision,
    taxInclusive: false,
    rounding: 'none',
    subtotal: doc.total,
    itemDiscounts: 0,
    overallDiscount: 0,
    taxableAmount: doc.total,
    taxAmount: 0,
    chargesTotal: 0,
    roundingAdjustment: 0,
    total: doc.total,
    paid: 0,
    balance: doc.total,
    createdAt: doc.createdAt,
    finalizedAt: doc.createdAt,
  } as unknown as Invoice;
  const client = { name: supplier.name, contactPerson: supplier.contactPerson ?? '', phone: supplier.phone ?? '', email: supplier.email ?? '', address: supplier.address ?? '', ntn: supplier.ntn ?? '', city: '', province: '', country: '', custom: {} } as unknown as Client;
  return invoiceHtml({ docType: kind, invoice, business: b, client, payments: [] }, paper, template);
}

/** One employee's payslip for a month. */
export function payslipHtml(s: Payslip, run: PayrollRun, b: BusinessProfile, paper: Paper = 'A5'): string {
  const m = (v: number) => formatMoney(v, run.currency, run.currencyPrecision);
  const row = (k: string, v: string, cls = '') => `<tr class="${cls}"><td>${k}</td><td class="r">${v}</td></tr>`;
  const month = new Date(`${run.month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const css = '.page{padding:28px}.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid var(--a);padding-bottom:12px;margin-bottom:14px}h1{font-size:1.6em;margin:0;color:var(--d)}table{width:100%;border-collapse:collapse}td{padding:7px 4px;border-bottom:1px solid #e3e3e6}.r{text-align:right}.net td{font-weight:800;font-size:1.15em;border-top:2px solid #111}.minus td:last-child{color:#B42318}';
  const body = `<div class="page"><div class="head"><div>${b.logo ? `<img class="logo" src="${esc(b.logo)}" alt=""/>` : ''}<b>${esc(b.tradingName || b.legalName)}</b><div class="muted">${nl(b.address)}</div></div>
    <div class="r"><h1>PAYSLIP</h1><div class="muted">${month}</div></div></div>
    <table>${row('Employee', `<b>${esc(s.employeeName)}</b>`)}${s.designation ? row('Designation', esc(s.designation)) : ''}
    ${row(s.payType === 'monthly' ? 'Monthly salary' : 'Daily wage', m(s.rate))}${row(s.payType === 'monthly' ? 'Days worked' : 'Days', s.payType === 'monthly' ? `${s.days} of ${s.daysInMonth}` : String(s.days))}</table>
    <div class="label" style="margin-top:14px">Earnings</div><table>${row('Pay for days worked', m(s.earned))}${s.overtime ? row('Overtime', m(s.overtime)) : ''}${s.allowances ? row('Allowances', m(s.allowances)) : ''}${s.bonus ? row('Bonus', m(s.bonus)) : ''}</table>
    ${s.deductions || s.tax || s.advanceRecovery ? `<div class="label" style="margin-top:14px">Deductions</div><table>${s.deductions ? row('Deductions', `− ${m(s.deductions)}`, 'minus') : ''}${s.tax ? row('Income tax', `− ${m(s.tax)}`, 'minus') : ''}${s.advanceRecovery ? row('Advance recovered', `− ${m(s.advanceRecovery)}`, 'minus') : ''}</table>` : ''}
    <table style="margin-top:10px">${row('Net pay', m(s.net), 'net')}</table>
    ${s.notes ? `<div class="muted" style="margin-top:10px">${nl(s.notes)}</div>` : ''}
    <div class="two" style="margin-top:40px"><div class="muted">Employee signature<div style="border-bottom:1px solid #999;height:36px"></div></div><div class="muted">${run.status === 'paid' && run.paidDate ? `Paid on ${fd(run.paidDate)}` : 'Authorized signature'}<div style="border-bottom:1px solid #999;height:36px"></div></div></div></div>`;
  return localize(shell(`Payslip ${s.employeeName} ${run.month}`, paper, css, body, colorVars('classic', b.accentColor)), b.docLanguage ?? 'en');
}

/** A compact counter receipt for thermal printers (80 or 58 mm), with a QR of the receipt number. */
export function posReceiptHtml(d: { invoice: Invoice; payments: Payment[]; business: BusinessProfile; change?: number; cashier?: string }, paper: Paper = 'thermal'): string {
  const { invoice: i, business: b } = d;
  const m = (v: number) => formatMoney(v, i.currency, i.currencyPrecision);
  const narrow = paper === 'thermal58';
  const rows = i.lines
    .map((l) => `<tr><td colspan="2"><b>${esc(l.name)}</b></td></tr><tr><td class="muted">${qtyToString(l.qty)} × ${m(l.unitPrice)}${l.discountValue ? ' (disc.)' : ''}</td><td class="r">${m(l.lineTotal ?? 0)}</td></tr>`)
    .join('');
  const t = (k: string, v: string, cls = '') => `<tr class="${cls}"><td>${k}</td><td class="r">${v}</td></tr>`;
  const paid = d.payments.filter((p) => p.verificationStatus !== 'rejected');
  const body = `<div class="page">
    <div class="c">${b.logo ? `<img class="logo" src="${esc(b.logo)}" alt="" style="margin:0 auto 4px"/>` : ''}<div class="shop">${esc(b.tradingName || b.legalName)}</div>
      <div class="muted">${[b.address, b.phone].filter(Boolean).map(esc).join('<br/>')}</div>${b.ntn ? `<div class="muted">NTN ${esc(b.ntn)}</div>` : ''}</div>
    <div class="rule"></div>
    <table>${t('Receipt', esc(i.number ?? ''))}${t('Date', `${fd(i.issueDate)} ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`)}${i.clientName && i.clientName !== 'Walk-in customer' ? t('Customer', esc(i.clientName)) : ''}${d.cashier ? t('Cashier', esc(d.cashier)) : ''}</table>
    <div class="rule"></div><table>${rows}</table><div class="rule"></div>
    <table>${t('Sub total', m(i.subtotal))}${i.itemDiscounts + i.overallDiscount ? t('Discount', `− ${m(i.itemDiscounts + i.overallDiscount)}`) : ''}${i.taxAmount ? t('Tax', m(i.taxAmount)) : ''}${t('TOTAL', m(i.total), 'big')}
    ${paid.map((p) => t(PAYMENT_METHOD_LABELS[p.method], m(p.allocations.find((a) => a.invoiceId === i.id)?.amount ?? p.amount))).join('')}
    ${d.change ? t('Change', m(d.change)) : ''}${i.balance > 0 ? t('Udhaar (due)', m(i.balance), 'big') : ''}</table>
    <div class="rule"></div>
    <div class="c">${qrSvg(i.number ?? i.id, narrow ? 90 : 110)}<div class="muted">Show this code for returns</div>
    <div style="margin-top:6px">${b.invoiceFooter ? nl(b.invoiceFooter) : 'Thank you for shopping with us!'}</div></div></div>`;
  const css = `.page{font-family:'Courier New',monospace;font-size:${narrow ? 10 : 11.5}px}.c{text-align:center}.shop{font-size:1.35em;font-weight:800}
    .rule{border-top:1px dashed #000;margin:6px 0}table{width:100%;border-collapse:collapse}td{padding:1px 0;vertical-align:top}.r{text-align:right;white-space:nowrap}
    .big td{font-weight:800;font-size:1.15em}.muted{color:#333;font-size:.92em}.logo{max-height:46px;display:block}svg{display:block;margin:4px auto}`;
  return localize(shell(`Receipt ${i.number ?? ''}`, paper, css, body, ''), b.docLanguage ?? 'en');
}

const localDt = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return isNaN(d.getTime()) ? iso : `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Shift summary (Z-report) for a thermal printer. */
export function zReportHtml(z: ZReport, b: BusinessProfile, paper: Paper = 'thermal'): string {
  const m = (v: number) => formatMoney(v, z.currency, z.currencyPrecision);
  const t = (k: string, v: string, cls = '') => `<tr class="${cls}"><td>${k}</td><td class="r">${v}</td></tr>`;
  const s = z.shift;
  const body = `<div class="page"><div class="c"><b>${esc(b.tradingName || b.legalName)}</b><div>Z-REPORT</div></div><div class="rule"></div>
    <table>${t('Cashier', esc(s.openedByName))}${t('Opened', esc(localDt(s.openedAt)))}${s.closedAt ? t('Closed', esc(localDt(s.closedAt))) : ''}</table><div class="rule"></div>
    <table>${t('Sales', String(z.sales))}${t('Sales total', m(z.salesTotal), 'big')}${z.byTender.map((x) => t(POS_TENDER_LABELS[x.tender], m(x.amount))).join('')}
    ${t('Discounts', m(z.discounts))}${t('Tax', m(z.tax))}${t(`Returns (${z.returns})`, m(z.returnsTotal))}</table><div class="rule"></div>
    <table>${t('Opening float', m(s.openingFloat))}${t('Cash in', m(z.cashIn))}${t('Cash out', m(z.cashOut))}${t('Cash refunds', m(z.cashRefunds))}${t('Expected in drawer', m(z.expectedCash), 'big')}
    ${s.counted !== null ? t('Counted', m(s.counted)) + t('Difference', m(s.difference ?? 0), 'big') : ''}</table></div>`;
  const css = '.page{font-family:"Courier New",monospace;font-size:11px}.c{text-align:center}.rule{border-top:1px dashed #000;margin:6px 0}table{width:100%;border-collapse:collapse}.r{text-align:right}.big td{font-weight:800}';
  return shell(`Z-report ${s.openedAt.slice(0, 10)}`, paper, css, body, '');
}

/** Every purchase bill in a period on one sheet, with a grand total. */
export function purchasesListHtml(list: Purchase[], b: BusinessProfile, period: string, paper: Paper = 'A4'): string {
  const cur = list[0] ?? { currency: b.currency, currencyPrecision: b.currencyPrecision };
  const m = (v: number) => formatMoney(v, cur.currency, cur.currencyPrecision);
  const total = list.reduce((a, p) => a + p.total, 0);
  const rows = list
    .map((p) => `<tr><td>${fd(p.date)}</td><td>${esc(p.number)}</td><td>${esc(p.supplier)}</td><td style="white-space:normal">${p.lines.map((l) => `${esc(l.name)} × ${qtyToString(l.qty)}${l.unit ? ' ' + esc(l.unit) : ''}`).join(', ')}</td><td class="r">${m(p.total)}</td></tr>`)
    .join('');
  return shell(
    'Purchases',
    paper,
    SIMPLE_CSS,
    `<div class="page">${simpleHead(b, 'PURCHASES', `${esc(period)}<br/>${list.length} bill${list.length === 1 ? '' : 's'}`)}
    <div class="in"><div class="two"><div></div><div class="r"><div class="label">Total purchases</div><div class="amount">${m(total)}</div></div></div>
    <div class="extra"><table class="items"><tr><th>Date</th><th>No.</th><th>Supplier</th><th>Items</th><th class="r">Amount</th></tr>${rows || '<tr><td colspan="5">No purchases in this period.</td></tr>'}
      <tr><td colspan="4"><b>Total</b></td><td class="r"><b>${m(total)}</b></td></tr></table></div>
    ${simpleSig(b)}</div><div class="grow"></div></div>`,
    simpleVars(b),
  );
}

export function statementHtml(l: ClientLedger, b: BusinessProfile, paper: Paper = 'A4'): string {
  const m = (v: number) => formatMoney(v, b.currency, b.currencyPrecision);
  const rows = l.entries
    .map((e) => `<tr><td>${e.date ? fd(e.date) : ''}</td><td>${esc(e.label)}</td><td class="r">${e.debit ? m(e.debit) : ''}</td><td class="r">${e.credit ? m(e.credit) : ''}</td><td class="r">${m(e.balance)}</td></tr>`)
    .join('');
  const c = l.client;
  return shell(
    `Statement ${c.name}`,
    paper,
    SIMPLE_CSS,
    `<div class="page">${simpleHead(b, 'ACCOUNT STATEMENT', `As of ${fd(new Date().toISOString().slice(0, 10))}`)}
    <div class="in"><div class="two"><div><div class="label">Client</div><b style="font-size:1.15em">${esc(c.name)}</b><div class="muted">${[esc(c.contactPerson), nl([c.address, c.city].filter(Boolean).join(', ')), esc(c.phone)].filter(Boolean).join('<br/>')}</div></div>
      <div class="r"><span class="muted">Total invoiced:</span> ${m(l.totalInvoiced)}<br/><span class="muted">Total paid:</span> ${m(l.totalPaid)}<br/><span class="muted">Outstanding:</span> <b>${m(l.outstanding)}</b>${l.credit ? `<br/><span class="muted">Advance balance:</span> ${m(l.credit)}` : ''}${l.overdue ? `<br/><span class="muted">Overdue:</span> ${m(l.overdue)}` : ''}</div></div>
    <table class="items" style="margin-top:16px"><tr><th>Date</th><th>Entry</th><th class="r">Charged</th><th class="r">Received</th><th class="r">Balance</th></tr>${rows}</table>
    ${simpleSig(b)}</div><div class="grow"></div></div>`,
    simpleVars(b),
  );
}

// ---------------------------------------------------------------- quotation

/** Render a quotation with the business's invoice design. */
export function quotationHtml(d: { quotation: Quotation; business: BusinessProfile; client: Client }, paper: Paper = 'A4', template?: InvoiceTemplate): string {
  const q = d.quotation;
  const invoice: Invoice = {
    ...q,
    dueDate: q.validUntil,
    paymentTerms: q.terms,
    installments: [],
    status: 'draft',
    displayStatus: q.displayStatus as Invoice['displayStatus'],
    rounding: 'none',
    paid: 0,
    balance: q.total,
    finalizedAt: null,
  };
  return invoiceHtml({ docType: 'quotation', invoice, business: d.business, client: d.client, payments: [] }, paper, template);
}

// ---------------------------------------------------------------- report

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = (m: string) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

export function reportHtml(r: ReportData, b: BusinessProfile, title: string, paper: Paper = 'A4'): string {
  const m = (v: number) => formatMoney(v, r.currency, r.currencyPrecision);
  const pct = (v: number, of: number) => (of > 0 ? `${Math.round((v / of) * 100)}%` : '');
  const table = (head: string[], rows: string[][], right: number[] = []) =>
    rows.length
      ? `<table class="items" style="margin-top:6px"><tr>${head.map((h, n) => `<th class="${right.includes(n) ? 'r' : ''}">${h}</th>`).join('')}</tr>${rows
          .map((row) => `<tr>${row.map((c, n) => `<td class="${right.includes(n) ? 'r' : ''}">${c}</td>`).join('')}</tr>`)
          .join('')}</table>`
      : '<div class="muted" style="margin-top:6px">Nothing in this period.</div>';
  const section = (heading: string, html: string) => `<div class="extra" style="margin-top:20px"><div class="label">${heading}</div>${html}</div>`;
  const kpi = (label: string, value: string) => `<td style="padding:10px 12px;border:1px solid #e3e3e6;width:25%"><div class="muted" style="font-size:.85em">${label}</div><div style="font-size:1.25em;font-weight:800">${value}</div></td>`;
  const a = r.aging;
  return shell(
    title,
    paper,
    SIMPLE_CSS,
    `<div class="page">${simpleHead(b, 'FINANCIAL REPORT', `${fd(r.from)} – ${fd(r.to)}`)}
    <div class="in">
      <table style="border-collapse:collapse"><tr>${kpi('Invoiced', m(r.totals.invoiced))}${kpi('Collected', m(r.totals.collected))}${kpi('Outstanding today', m(r.totals.outstanding))}${kpi('Overdue today', m(r.totals.overdue))}</tr>
      <tr>${kpi('Invoices issued', String(r.totals.invoiceCount))}${kpi('Payments received', String(r.totals.paymentCount))}${kpi('Expenses', m(r.totals.expenses))}${kpi('Collected − expenses', m(r.totals.collected - r.totals.expenses))}</tr></table>
      ${section('Monthly collections', table(['Month', 'Payments', 'Amount'], r.collections.monthly.map((x) => [monthName(x.month), String(x.count), m(x.amount)]), [1, 2]))}
      ${section('Weekly collections', table(['Week starting', 'Payments', 'Amount'], r.collections.weekly.map((x) => [fd(x.weekStart), String(x.count), m(x.amount)]), [1, 2]))}
      ${section('Payment methods', table(['Method', 'Payments', 'Amount', 'Share'], r.methods.map((x) => [PAYMENT_METHOD_LABELS[x.method], String(x.count), m(x.amount), pct(x.amount, r.totals.collected)]), [1, 2, 3]))}
      ${section('Client-wise revenue', table(['Client', 'Invoices', 'Invoiced', 'Collected', 'Outstanding now'], r.clients.map((x) => [esc(x.clientName), String(x.invoiceCount), m(x.invoiced), m(x.collected), m(x.outstanding)]), [1, 2, 3, 4]))}
      ${section('Service-wise revenue', table(['Service / product', 'Qty', 'Invoices', 'Revenue'], r.services.map((x) => [esc(x.name), qtyToString(x.qty), String(x.invoiceCount), m(x.revenue)]), [1, 2, 3]) + '<div class="muted" style="margin-top:4px;font-size:.85em">Line totals after item discounts, before overall discount, tax and charges.</div>')}
      ${section('Outstanding by age (as of today)', table(['Not yet due', '1–30 days', '31–60 days', '61–90 days', 'Over 90 days'], [[m(a.notDue), m(a.d1to30), m(a.d31to60), m(a.d61to90), m(a.d90plus)]], [0, 1, 2, 3, 4]))}
      ${section('Overdue invoices', table(['Invoice', 'Client', 'Due date', 'Days late', 'Balance'], r.overdueInvoices.map((x) => [esc(x.number), esc(x.clientName), fd(x.dueDate), String(x.daysOverdue), m(x.balance)]), [3, 4]))}
      ${section(`Installments due in the period · scheduled ${m(r.installments.scheduled)}, collected ${m(r.installments.collected)}`, table(['Due', 'Invoice', 'Client', 'Amount', 'Collected', 'Status'], r.installments.rows.map((x) => [fd(x.dueDate), esc(x.invoiceNumber), esc(x.clientName), m(x.amount), m(x.paid), x.status]), [3, 4]))}
      <div class="muted" style="margin-top:22px;font-size:.85em">Generated by Kaarobarly on ${fd(new Date().toISOString().slice(0, 10))}.</div>
    </div></div>`,
    simpleVars(b),
  );
}

// ---------------------------------------------------------------- print and PDF

function printInBrowser(html: string) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  frame.srcdoc = html;
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 60_000);
  };
  document.body.appendChild(frame);
}

/** Send the document to a printer (AirPrint / Android print service / browser print dialog). */
export async function printDoc(html: string, paper: Paper) {
  if (Platform.OS === 'web') return printInBrowser(html);
  await Print.printAsync({ html, width: PAPER_SIZE[paper].width, height: PAPER_SIZE[paper].height });
}

/** Render a PDF and open the system share sheet (WhatsApp, email, save to files...). */
export async function sharePdf(html: string, paper: Paper, title: string) {
  if (Platform.OS === 'web') return printInBrowser(html); // the browser dialog offers "Save as PDF"
  const { uri } = await Print.printToFileAsync({ html, width: PAPER_SIZE[paper].width, height: PAPER_SIZE[paper].height });
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: title });
}
