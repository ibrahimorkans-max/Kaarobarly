import { ORDER_KIND_LABELS, qtyToString, type Kot } from './shared';
import type { Paper } from './pdf';

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Kitchen order tickets, one per section, big and plain for a kitchen printer. */
export function kotHtml(kots: Kot[], paper: Paper): string {
  const width = paper === 'thermal58' ? '58mm' : '80mm';
  const body = kots
    .map(
      (k) => `<div class="t"><div class="h">${esc(k.section.toUpperCase())} · KOT ${k.number}</div>
      <div class="m">${k.kind === 'dine_in' ? `TABLE ${esc(k.table)}` : esc(ORDER_KIND_LABELS[k.kind])} · ${esc(k.orderNumber)} · ${new Date(k.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
      ${k.items.map((i) => `<div class="i"><b>${qtyToString(i.qty)} ×</b> ${esc(i.name)}${i.note ? `<div class="n">→ ${esc(i.note)}</div>` : ''}</div>`).join('')}</div>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=302"/><title>KOT</title><style>
@page { size: ${width} auto; margin: 3mm; } body { font-family: 'Courier New', monospace; margin: 6px; color: #000; }
.t { border-bottom: 2px dashed #000; padding-bottom: 8px; margin-bottom: 10px; page-break-after: always; }
.h { font-size: 18px; font-weight: 900; } .m { font-size: 12px; margin: 2px 0 8px; } .i { font-size: 16px; margin: 4px 0; } .n { font-size: 13px; font-style: italic; margin-left: 18px; }
</style></head><body>${body}</body></html>`;
}
