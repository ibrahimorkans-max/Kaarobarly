import { formatMoney, qtyToString, type BusinessProfile, type ExpiryBatch, type ReorderGroup } from './shared';
import type { Paper } from './pdf';

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function page(title: string, paper: Paper, body: string) {
  const thermal = paper.startsWith('thermal');
  const width = paper === 'thermal58' ? '58mm' : thermal ? '80mm' : 'A4';
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=${thermal ? 302 : 794}"/><title>${esc(title)}</title><style>
@page { size: ${thermal ? `${width} auto` : 'A4'}; margin: ${thermal ? '3mm' : '12mm'}; }
body { font-family: ${thermal ? "'Courier New', monospace" : 'Arial, Helvetica, sans-serif'}; font-size: ${thermal ? 10.5 : 11.5}px; color: #111; margin: ${thermal ? '6px' : '0'}; }
h1 { font-size: 1.5em; margin: 0 0 2px; } h2 { font-size: 1.15em; margin: 14px 0 4px; border-bottom: 1px solid #999; padding-bottom: 2px; }
.muted { color: #555; } table { width: 100%; border-collapse: collapse; } th { text-align: left; font-size: .85em; color: #555; border-bottom: 1px solid #ccc; }
td, th { padding: 3px 4px; vertical-align: top; } .r { text-align: right; white-space: nowrap; } .tot td { font-weight: 800; border-top: 1px solid #999; }
.grand { margin-top: 12px; font-size: 1.25em; font-weight: 800; text-align: right; }
</style></head><body>${body}</body></html>`;
}

/** The reorder slip: what to buy, grouped by supplier, with quantities and estimated cost. */
export function reorderSlipHtml(groups: ReorderGroup[], b: BusinessProfile, paper: Paper, qty: Record<string, number>): string {
  const m = (v: number) => formatMoney(v, b.currency, b.currencyPrecision);
  const thermal = paper.startsWith('thermal');
  let grand = 0;
  const parts = groups.map((g) => {
    const lines = g.lines.filter((l) => (qty[l.itemId] ?? l.suggested) > 0);
    if (!lines.length) return '';
    let total = 0;
    const rows = lines
      .map((l) => {
        const q = qty[l.itemId] ?? l.suggested;
        const cost = Math.round((q * l.lastPrice) / 1000);
        total += cost;
        return thermal
          ? `<tr><td colspan="2"><b>${esc(l.name)}</b></td></tr><tr><td class="muted">have ${qtyToString(l.onHand)} · order <b>${qtyToString(q)}</b> ${esc(l.unit)}</td><td class="r">${m(cost)}</td></tr>`
          : `<tr><td><b>${esc(l.name)}</b>${l.barcode ? `<div class="muted">${esc(l.barcode)}</div>` : ''}</td><td class="r">${qtyToString(l.onHand)}</td><td class="r">${qtyToString(l.reorderLevel)}</td><td class="r"><b>${qtyToString(q)}</b> ${esc(l.unit)}</td><td class="r">${m(l.lastPrice)}</td><td class="r">${m(cost)}</td></tr>`;
      })
      .join('');
    grand += total;
    const head = thermal ? '' : '<tr><th>Item</th><th class="r">In stock</th><th class="r">Min</th><th class="r">Order</th><th class="r">Last price</th><th class="r">Est. cost</th></tr>';
    return `<h2>${esc(g.supplierName)}${g.supplierPhone ? ` <span class="muted">· ${esc(g.supplierPhone)}</span>` : ''}</h2><table>${head}${rows}<tr class="tot"><td colspan="${thermal ? 1 : 5}">Total</td><td class="r">${m(total)}</td></tr></table>`;
  });
  const body = `<h1>Reorder slip</h1><div class="muted">${esc(b.tradingName || b.legalName)} · ${new Date().toLocaleDateString('en-GB')}</div>${parts.join('')}<div class="grand">Estimated total ${m(grand)}</div>`;
  return page('Reorder slip', paper, body);
}

/** Expiring stock to send back, grouped by supplier, with batch numbers. */
export function returnSlipHtml(batches: ExpiryBatch[], b: BusinessProfile, paper: Paper): string {
  const groups = new Map<string, ExpiryBatch[]>();
  for (const x of batches) groups.set(x.supplierName || 'Supplier not known', [...(groups.get(x.supplierName || 'Supplier not known') ?? []), x]);
  const parts = [...groups.entries()].map(
    ([name, list]) =>
      `<h2>${esc(name)}</h2><table><tr><th>Item</th><th>Batch</th><th>Expiry</th><th class="r">Qty</th></tr>${list
        .map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.batchNo || '-')}</td><td>${esc(x.expiry)}</td><td class="r">${qtyToString(x.qty)} ${esc(x.unit)}</td></tr>`)
        .join('')}</table>`,
  );
  return page('Return to supplier', paper, `<h1>Return to supplier</h1><div class="muted">${esc(b.tradingName || b.legalName)} · ${new Date().toLocaleDateString('en-GB')}</div>${parts.join('')}`);
}

/** The slip for one supplier as a WhatsApp message. */
export function reorderMessage(g: ReorderGroup, b: BusinessProfile, qty: Record<string, number>, urdu: boolean): string {
  const lines = g.lines.filter((l) => (qty[l.itemId] ?? l.suggested) > 0).map((l) => `• ${l.name}: ${qtyToString(qty[l.itemId] ?? l.suggested)} ${l.unit}`.trim());
  const shop = b.tradingName || b.legalName;
  return urdu ? `السلام علیکم،\n${shop} کے لیے یہ سامان بھیج دیں:\n${lines.join('\n')}\nشکریہ` : `Assalam o Alaikum,\nPlease send the following for ${shop}:\n${lines.join('\n')}\nThank you.`;
}
