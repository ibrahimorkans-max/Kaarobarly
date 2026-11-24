import { LABEL_SIZES, barcodeKindFor, barcodeSvg, formatMoney, isCode128Text, type BusinessProfile, type LabelDesign, type Service } from './shared';
import { qrSvg } from './qr';
import type { Paper, RollPaper } from './pdf';

export interface LabelJob {
  item: Pick<Service, 'name' | 'nameUr' | 'defaultPrice' | 'mrp' | 'sku' | 'barcode' | 'unit'>;
  copies: number;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The paper a design prints on: its own roll size, or A4 for sticker sheets. */
export const labelPaper = (d: LabelDesign): Paper => ('sheet' in LABEL_SIZES[d.size] ? 'A4' : (d.size as RollPaper));

/** The code printed on an item's label: its barcode, else its SKU. */
export const labelCode = (i: LabelJob['item']) => i.barcode || i.sku;

function one(d: LabelDesign, i: LabelJob['item'], b: BusinessProfile): string {
  const size = LABEL_SIZES[d.size];
  const h = size.h;
  const m = (v: number) => formatMoney(v, b.currency, b.currencyPrecision);
  const code = labelCode(i);
  const s = d.show;
  const priceMm = h * { S: 0.12, M: 0.16, L: 0.22 }[d.priceSize];
  const qr = d.code === 'qr' && !!code;
  const bars = d.code === 'barcode' && !!code && isCode128Text(code);

  const parts: string[] = [];
  if ((s.business || s.logo) && !qr) {
    parts.push(`<div class="biz">${s.logo && b.logo ? `<img src="${esc(b.logo)}" alt=""/>` : ''}${s.business ? esc(b.tradingName || b.legalName) : ''}</div>`);
  }
  if (s.name) parts.push(`<div class="name">${esc(i.name)}</div>`);
  if (s.nameUr && i.nameUr) parts.push(`<div class="ur" dir="rtl">${esc(i.nameUr)}</div>`);
  if (s.price || (s.mrp && i.mrp)) {
    const mrp = s.mrp && i.mrp > 0 ? (i.mrp > i.defaultPrice ? `<s>${m(i.mrp)}</s>` : `MRP ${m(i.mrp)}`) : '';
    parts.push(
      `<div class="price">${s.price ? `<b style="font-size:${priceMm.toFixed(2)}mm">${m(i.defaultPrice)}</b>` : ''}${s.unit && i.unit ? `<span class="unit">/${esc(i.unit)}</span>` : ''}${mrp ? `<span class="mrp">${mrp}</span>` : ''}</div>`,
    );
  }
  if (s.sku && i.sku && (d.code !== 'barcode' || i.barcode)) parts.push(`<div class="small">SKU ${esc(i.sku)}</div>`);
  if (d.extra) parts.push(`<div class="small">${esc(d.extra)}</div>`);
  if (bars) parts.push(`<div class="bars">${barcodeSvg(code, { kind: barcodeKindFor(code), text: false })}</div><div class="digits">${esc(code)}</div>`);

  if (qr) {
    const content = d.qrContent === 'code_price' ? `${code} ${m(i.defaultPrice)}` : d.qrContent === 'name_price' ? `${i.name}\n${m(i.defaultPrice)}` : code;
    const head = s.business ? `<div class="biz">${esc(b.tradingName || b.legalName)}</div>` : '';
    return `<div class="row">${`<div class="col">${head}${parts.join('')}</div>`}<div class="qr">${qrSvg(content, 200).replace(/width="200" height="200"/, 'width="100%" height="100%"')}</div></div>`;
  }
  return parts.join('');
}

/**
 * Labels for a list of items. Roll sizes print one label per page; A4 sheets lay labels out in
 * the sheet's grid, skipping `skip` positions so a part-used sheet can be finished.
 */
export function labelsHtml(d: LabelDesign, jobs: LabelJob[], b: BusinessProfile, skip = 0): string {
  const size = LABEL_SIZES[d.size];
  const sheet = 'sheet' in size ? size.sheet : null;
  const items = jobs.flatMap((j) => Array.from({ length: Math.max(0, Math.min(j.copies, 500)) }, () => j.item));
  const h = size.h;
  const base = Math.max(1.9, Math.min(h * 0.11, 4.2));
  const pad = h * 0.05;
  // the QR is square: as tall as the label allows, but never more than 45% of its width
  const qrMm = Math.min(h - pad * 2, size.w * 0.45);
  const box = (inner: string, style = '') => `<div class="lbl" style="${style}">${inner}</div>`;

  let body = '';
  if (!sheet) {
    body = items.map((i) => box(one(d, i, b))).join('');
  } else {
    const per = sheet.cols * sheet.rows;
    const cells: (string | null)[] = [...Array(Math.min(skip, per - 1)).fill(null), ...items.map((i) => one(d, i, b))];
    for (let p = 0; p < cells.length; p += per) {
      const page = cells.slice(p, p + per);
      body += `<div class="sheet">${page
        .map((c, k) => {
          if (c === null) return '';
          const col = k % sheet.cols;
          const row = Math.floor(k / sheet.cols);
          return box(c, `position:absolute;left:${(sheet.left + col * (size.w + sheet.gapX)).toFixed(2)}mm;top:${(sheet.top + row * (h + sheet.gapY)).toFixed(2)}mm`);
        })
        .join('')}</div>`;
    }
  }

  const css = `
@page { size: ${sheet ? 'A4' : `${size.w}mm ${h}mm`}; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; }
.sheet { position: relative; width: 210mm; height: 297mm; overflow: hidden; page-break-after: always; break-after: page; }
.lbl { width: ${size.w}mm; height: ${h}mm; padding: ${(h * 0.05).toFixed(2)}mm ${(h * 0.07).toFixed(2)}mm; overflow: hidden; display: flex; flex-direction: column; gap: ${(h * 0.012).toFixed(2)}mm;
  font-size: ${base.toFixed(2)}mm; line-height: 1.12; ${sheet ? '' : 'page-break-after: always; break-after: page;'} ${d.border ? 'border: 0.3mm solid #000; border-radius: 1.5mm;' : ''} }
.biz { display: flex; align-items: center; gap: 1mm; font-size: 0.8em; font-weight: 700; white-space: nowrap; overflow: hidden; }
.biz img { height: 1.4em; max-width: 30%; object-fit: contain; }
.name { font-weight: 700; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.ur { font-size: 1.05em; white-space: nowrap; overflow: hidden; text-align: right; }
.price { display: flex; align-items: baseline; gap: 1.2mm; flex-wrap: wrap; }
.price b { font-weight: 900; line-height: 1; }
.unit, .small { font-size: 0.78em; }
.mrp { font-size: 0.8em; margin-left: auto; }
.bars { flex: 1 1 auto; min-height: ${(h * 0.22).toFixed(2)}mm; }
.bars svg { display: block; width: 100%; height: 100%; }
.digits { font-family: 'Courier New', monospace; font-size: 0.78em; text-align: center; letter-spacing: 0.3mm; }
.row { display: flex; gap: 1.5mm; height: 100%; align-items: center; }
.col { flex: 1; min-width: 0; max-height: 100%; overflow: hidden; display: flex; flex-direction: column; gap: 0.6mm; justify-content: safe center; }
/* when a small label is overfull, extra lines give way first, then the name; the price never does */
.col > * { flex-shrink: 8; min-height: 0; overflow: hidden; }
.col > .name { flex-shrink: 1; min-height: 1.15em; }
.col > .price { flex-shrink: 0; }
.qr { width: ${qrMm.toFixed(2)}mm; height: ${qrMm.toFixed(2)}mm; flex: none; }
.qr svg { display: block; width: 100%; height: 100%; }`;
  const width = sheet ? 794 : Math.round((size.w * 96) / 25.4);
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=${width}"/><title>Labels</title><style>${css}</style></head><body>${body || box('<div class="small">No labels to print</div>')}</body></html>`;
}

/** A sample item for previewing a design. */
export const SAMPLE_LABEL_ITEM: LabelJob['item'] = { name: 'Basmati Rice Super Kernel 1kg', nameUr: 'باسمتی چاول', defaultPrice: 39_000, mrp: 42_000, sku: 'RICE-1KG', barcode: '2012345678903', unit: 'pack' };
