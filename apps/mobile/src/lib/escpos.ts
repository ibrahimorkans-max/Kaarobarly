/**
 * Printer command languages, built as raw bytes:
 * ESC/POS for receipt and kitchen printers, TSPL (TSC, Xprinter, most label printers) and ZPL (Zebra).
 * Thermal printers print Latin text only; other scripts (Urdu) are left out of raw printing.
 */
import { LABEL_SIZES, POS_TENDER_LABELS, PAYMENT_METHOD_LABELS, barcodeKindFor, formatMoney, isCode128Text, qtyToString, type BusinessProfile, type Invoice, type Kot, type LabelDesign, type Payment, type ZReport } from './shared';
import type { LabelJob } from './labels';

const ascii = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/×/g, 'x')
    .replace(/·/g, '-')
    .replace(/[^\x20-\x7e\n]/g, '');

class Bytes {
  private out: number[] = [];
  raw(...b: number[]) {
    this.out.push(...b);
    return this;
  }
  text(s: string) {
    for (const ch of ascii(s)) this.out.push(ch.charCodeAt(0));
    return this;
  }
  line(s = '') {
    return this.text(s).raw(0x0a);
  }
  bytes() {
    return Uint8Array.from(this.out);
  }
}

// ================================================================ ESC/POS

const ESC = 0x1b;
const GS = 0x1d;

class EscPos extends Bytes {
  constructor(readonly cols: number) {
    super();
    this.raw(ESC, 0x40); // initialise
  }
  align(a: 'left' | 'center' | 'right') {
    return this.raw(ESC, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2);
  }
  bold(on: boolean) {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }
  /** 1 = normal, 2 = double width and height */
  size(n: 1 | 2) {
    return this.raw(GS, 0x21, n === 2 ? 0x11 : 0x00);
  }
  rule(ch = '-') {
    return this.line(ch.repeat(this.cols));
  }
  /** left text and right text on one line, wrapping the left side when long */
  pair(left: string, right: string, cols = this.cols) {
    const l = ascii(left);
    const r = ascii(right);
    const room = Math.max(cols - r.length - 1, 4);
    const parts = l.match(new RegExp(`.{1,${room}}`, 'g')) ?? [''];
    parts.forEach((p, i) => this.line(i === parts.length - 1 ? p + ' '.repeat(Math.max(cols - p.length - r.length, 1)) + r : p));
    return this;
  }
  wrap(s: string) {
    for (const p of ascii(s).match(new RegExp(`.{1,${this.cols}}(\\s|$)|\\S+`, 'g')) ?? []) this.line(p.trimEnd());
    return this;
  }
  qr(data: string, size = 6) {
    const d = Array.from(ascii(data)).map((c) => c.charCodeAt(0));
    const len = d.length + 3;
    this.raw(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0x00) // model 2
      .raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, size) // module size
      .raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31) // error correction M
      .raw(GS, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30, ...d)
      .raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30); // print
    return this.raw(0x0a);
  }
  cut() {
    return this.raw(0x0a, 0x0a, 0x0a, GS, 0x56, 0x42, 0x00);
  }
  /** opens a cash drawer wired to the printer */
  drawer() {
    return this.raw(ESC, 0x70, 0x00, 0x19, 0xfa);
  }
}

export const colsFor = (widthMm: 58 | 80) => (widthMm === 58 ? 32 : 48);

/** A counter receipt for an ESC/POS printer. */
export function receiptEscPos(d: { invoice: Invoice; payments: Payment[]; business: BusinessProfile; change?: number; cashier?: string }, widthMm: 58 | 80, openDrawer = false): Uint8Array {
  const { invoice: i, business: b } = d;
  const m = (v: number) => formatMoney(v, i.currency, i.currencyPrecision);
  const p = new EscPos(colsFor(widthMm));
  if (openDrawer) p.drawer();
  p.align('center').bold(true).size(2).wrap(b.tradingName || b.legalName).size(1).bold(false);
  if (b.address) p.wrap(b.address);
  if (b.phone) p.line(b.phone);
  if (b.ntn) p.line(`NTN ${b.ntn}`);
  p.align('left').rule();
  p.pair('Receipt', i.number ?? '');
  p.pair('Date', `${i.issueDate} ${new Date().toTimeString().slice(0, 5)}`);
  if (i.clientName && i.clientName !== 'Walk-in customer') p.pair('Customer', i.clientName);
  if (d.cashier) p.pair('Cashier', d.cashier);
  p.rule();
  for (const l of i.lines) {
    p.bold(true).wrap(l.name).bold(false);
    p.pair(`  ${qtyToString(l.qty)} x ${m(l.unitPrice)}`, m(l.lineTotal ?? Math.round((l.qty * l.unitPrice) / 1000)));
  }
  p.rule();
  p.pair('Sub total', m(i.subtotal));
  if (i.itemDiscounts + i.overallDiscount) p.pair('Discount', `-${m(i.itemDiscounts + i.overallDiscount)}`);
  if (i.taxAmount) p.pair('Tax', m(i.taxAmount));
  // double-size text: half as many characters fit
  p.bold(true).size(2).pair('TOTAL', m(i.total), Math.floor(p.cols / 2)).size(1).bold(false);
  for (const pay of d.payments.filter((x) => x.verificationStatus !== 'rejected')) p.pair(PAYMENT_METHOD_LABELS[pay.method], m(pay.allocations.find((a) => a.invoiceId === i.id)?.amount ?? pay.amount));
  if (d.change) p.pair('Change', m(d.change));
  if (i.balance > 0) p.bold(true).pair('Udhaar (due)', m(i.balance)).bold(false);
  if (i.notes) p.wrap(i.notes);
  p.rule().align('center').qr(i.number ?? i.id, widthMm === 58 ? 5 : 6).line('Show this code for returns');
  p.wrap(b.invoiceFooter || 'Thank you for shopping with us!');
  return p.cut().bytes();
}

/** Kitchen tickets: large and plain, one per section. */
export function kotEscPos(kots: Kot[], widthMm: 58 | 80): Uint8Array {
  const p = new EscPos(colsFor(widthMm));
  for (const k of kots) {
    p.align('center').bold(true).size(2).line(`${k.section.toUpperCase()} - KOT ${k.number}`).size(1);
    p.line(`${k.kind === 'dine_in' ? `TABLE ${k.table}` : k.kind.replace('_', ' ').toUpperCase()}  ${k.orderNumber}  ${new Date(k.createdAt).toTimeString().slice(0, 5)}`).bold(false);
    p.align('left').rule('=');
    for (const i of k.items) {
      p.size(2).wrap(`${qtyToString(i.qty)} x ${i.name}`).size(1);
      if (i.note) p.line(`   -> ${i.note}`);
    }
    p.cut();
  }
  return p.bytes();
}

/** End-of-shift summary on the receipt printer. */
export function zReportEscPos(z: ZReport, b: BusinessProfile, widthMm: 58 | 80): Uint8Array {
  const m = (v: number) => formatMoney(v, z.currency, z.currencyPrecision);
  const p = new EscPos(colsFor(widthMm));
  p.align('center').bold(true).line(b.tradingName || b.legalName).size(2).line('Z-REPORT').size(1).bold(false).align('left').rule();
  p.pair('Cashier', z.shift.openedByName).pair('Opened', z.shift.openedAt.slice(0, 16).replace('T', ' '));
  if (z.shift.closedAt) p.pair('Closed', z.shift.closedAt.slice(0, 16).replace('T', ' '));
  p.rule().pair('Sales', String(z.sales)).bold(true).pair('Sales total', m(z.salesTotal)).bold(false);
  for (const t of z.byTender) p.pair(POS_TENDER_LABELS[t.tender], m(t.amount));
  p.pair('Discounts', m(z.discounts)).pair('Tax', m(z.tax)).pair(`Returns (${z.returns})`, m(z.returnsTotal)).rule();
  p.pair('Opening float', m(z.shift.openingFloat)).pair('Cash in', m(z.cashIn)).pair('Cash out', m(z.cashOut)).pair('Cash refunds', m(z.cashRefunds));
  p.bold(true).pair('Expected in drawer', m(z.expectedCash)).bold(false);
  if (z.shift.counted !== null) p.pair('Counted', m(z.shift.counted)).bold(true).pair('Difference', m(z.shift.difference ?? 0)).bold(false);
  return p.cut().bytes();
}

/** A one-line test page. */
export function testEscPos(widthMm: 58 | 80): Uint8Array {
  const p = new EscPos(colsFor(widthMm));
  return p.align('center').bold(true).size(2).line('Kaarobarly').size(1).bold(false).line('Printer test').rule().pair('Width', `${widthMm} mm`).qr('KAAROBARLY', 5).cut().bytes();
}

// ================================================================ labels: TSPL and ZPL

export type LabelLanguage = 'tspl' | 'zpl';

const DOTS = 8; // 203 dpi: 8 dots per mm
const q = (s: string) => ascii(s).replace(/"/g, "'");

function labelLines(d: LabelDesign, item: LabelJob['item'], b: BusinessProfile) {
  const m = (v: number) => formatMoney(v, b.currency, b.currencyPrecision);
  const out: { text: string; big?: boolean }[] = [];
  if (d.show.business) out.push({ text: b.tradingName || b.legalName });
  if (d.show.name) out.push({ text: item.name });
  if (d.show.price) out.push({ text: `${m(item.defaultPrice)}${d.show.unit && item.unit ? `/${item.unit}` : ''}`, big: true });
  if (d.show.mrp && item.mrp > 0) out.push({ text: `MRP ${m(item.mrp)}` });
  if (d.show.sku && item.sku) out.push({ text: `SKU ${item.sku}` });
  if (d.extra) out.push({ text: d.extra });
  return out;
}

/** Labels for a TSPL printer (TSC, Xprinter, Gainscha …); A4 sheet designs print one label per item on a roll. */
export function labelsTspl(d: LabelDesign, jobs: LabelJob[], b: BusinessProfile): Uint8Array {
  const size = LABEL_SIZES[d.size];
  const w = 'sheet' in size ? 50 : size.w;
  const h = 'sheet' in size ? 30 : size.h;
  const out = new Bytes();
  out.line(`SIZE ${w} mm,${h} mm`).line('GAP 2 mm,0 mm').line('DIRECTION 1').line('REFERENCE 0,0').line('CODEPAGE 1252');
  for (const j of jobs) {
    if (j.copies <= 0) continue;
    const code = j.item.barcode || j.item.sku;
    out.line('CLS');
    let y = 12;
    const maxChars = Math.floor((w * DOTS - 24) / 12);
    for (const l of labelLines(d, j.item, b)) {
      const t = q(l.text).slice(0, l.big ? Math.floor(maxChars / 2) : maxChars);
      out.line(`TEXT 12,${y},"${l.big ? '3' : '2'}",0,1,1,"${t}"`);
      y += l.big ? 30 : 22;
    }
    const left = h * DOTS - y - 12;
    if (code && d.code === 'barcode' && isCode128Text(code) && left > 40) {
      const kind = barcodeKindFor(code) === 'ean13' ? 'EAN13' : '128';
      out.line(`BARCODE 12,${y},"${kind}",${Math.min(left - 26, 80)},1,0,2,2,"${q(code)}"`);
    } else if (code && d.code === 'qr' && left > 40) {
      const cell = Math.max(2, Math.min(6, Math.floor(left / 30)));
      out.line(`QRCODE ${w * DOTS - cell * 29 - 12},12,M,${cell},A,0,"${q(d.qrContent === 'code' ? code : `${code} ${j.item.name}`)}"`);
    }
    out.line(`PRINT 1,${Math.min(j.copies, 500)}`);
  }
  return out.bytes();
}

/** The same labels in ZPL for Zebra printers. */
export function labelsZpl(d: LabelDesign, jobs: LabelJob[], b: BusinessProfile): Uint8Array {
  const size = LABEL_SIZES[d.size];
  const w = ('sheet' in size ? 50 : size.w) * DOTS;
  const h = ('sheet' in size ? 30 : size.h) * DOTS;
  const out = new Bytes();
  for (const j of jobs) {
    if (j.copies <= 0) continue;
    const code = j.item.barcode || j.item.sku;
    out.text(`^XA^CI28^PW${w}^LL${h}`);
    let y = 12;
    for (const l of labelLines(d, j.item, b)) {
      out.text(`^FO12,${y}^A0N,${l.big ? 34 : 22},${l.big ? 30 : 20}^FB${w - 24},1,0,L^FD${q(l.text)}^FS`);
      y += l.big ? 38 : 26;
    }
    const left = h - y - 12;
    if (code && d.code === 'barcode' && isCode128Text(code) && left > 40) {
      const ean = barcodeKindFor(code) === 'ean13';
      out.text(`^FO12,${y}^BY2${ean ? `^BEN,${Math.min(left - 26, 80)},Y,N^FD${code.slice(0, 12)}^FS` : `^BCN,${Math.min(left - 26, 80)},Y,N,N^FD${q(code)}^FS`}`);
    } else if (code && d.code === 'qr') {
      out.text(`^FO${w - 140},12^BQN,2,4^FDMA,${q(code)}^FS`);
    }
    out.line(`^PQ${Math.min(j.copies, 500)}^XZ`);
  }
  return out.bytes();
}

/** Bytes → base64 (no dependency on btoa). */
export function toBase64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + (i + 1 < bytes.length ? chars[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? chars[n & 63] : '=');
  }
  return out;
}
