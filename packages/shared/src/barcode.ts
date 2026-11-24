/**
 * Barcodes drawn as SVG for labels: EAN-13 (retail) and Code 128 (any text, e.g. a SKU).
 * Pure functions with no dependencies, so the phone can print labels offline.
 */

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = L.map((p) => [...p].map((b) => (b === '1' ? '0' : '1')).join(''));
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** The 13th digit of an EAN-13 from its first 12. */
export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function isEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/** A new in-store EAN-13 (prefix 20, for the shop's own use). `random` returns 0..1. */
export function newStoreEan13(random: () => number = Math.random): string {
  let s = '20';
  for (let i = 0; i < 10; i++) s += Math.floor(random() * 10);
  return s + ean13CheckDigit(s);
}

/** The 95 modules of an EAN-13 as a 0/1 string. */
export function ean13Modules(code: string): string {
  if (!isEan13(code)) throw new Error(`${code} is not a valid EAN-13`);
  const d = [...code].map(Number);
  const parity = PARITY[d[0]];
  let s = '101';
  for (let i = 1; i <= 6; i++) s += (parity[i - 1] === 'L' ? L : G)[d[i]];
  s += '01010';
  for (let i = 7; i <= 12; i++) s += R[d[i]];
  return s + '101';
}

// Code 128 bar/space widths for values 0–106 (106 = stop).
const C128 = (
  '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 ' +
  '221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 ' +
  '231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 ' +
  '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 ' +
  '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 ' +
  '114131 311141 411131 211412 211214 211232 2331112'
).split(' ');

/** Text Code 128 can hold here (set B: printable ASCII). */
export const isCode128Text = (s: string) => s.length > 0 && s.length <= 48 && /^[\x20-\x7e]+$/.test(s);

/** Code 128 (set B, or set C for long digit-only text) as a 0/1 module string, with quiet zones left out. */
export function code128Modules(text: string): string {
  if (!isCode128Text(text)) throw new Error('Code 128 takes 1–48 plain characters');
  const values: number[] = [];
  if (/^\d+$/.test(text) && text.length >= 4 && text.length % 2 === 0) {
    values.push(105);
    for (let i = 0; i < text.length; i += 2) values.push(Number(text.slice(i, i + 2)));
  } else {
    values.push(104);
    for (const ch of text) values.push(ch.charCodeAt(0) - 32);
  }
  const check = values.reduce((s, v, i) => s + v * (i === 0 ? 1 : i), 0) % 103;
  values.push(check, 106);
  let out = '';
  for (const v of values) {
    [...C128[v]].forEach((w, i) => (out += (i % 2 === 0 ? '1' : '0').repeat(Number(w))));
  }
  return out;
}

export type BarcodeKind = 'ean13' | 'code128';

/** Pick EAN-13 for valid EAN codes, otherwise Code 128. */
export const barcodeKindFor = (code: string): BarcodeKind => (isEan13(code) ? 'ean13' : 'code128');

/**
 * A barcode as an SVG string that stretches to its box (width 100%). `text` prints the digits under the bars.
 * Quiet zones (blank margins the scanner needs) are included.
 */
export function barcodeSvg(code: string, opts: { kind?: BarcodeKind; height?: number; text?: boolean } = {}): string {
  const kind = opts.kind ?? barcodeKindFor(code);
  const bars = kind === 'ean13' ? ean13Modules(code) : code128Modules(code);
  const quiet = kind === 'ean13' ? 9 : 10;
  const textH = opts.text === false ? 0 : 9;
  const barH = opts.height ?? 40;
  const w = bars.length + quiet * 2;
  let d = '';
  let i = 0;
  while (i < bars.length) {
    if (bars[i] === '1') {
      let j = i;
      while (j < bars.length && bars[j] === '1') j++;
      // EAN guard bars run a little longer, as printed on packs
      const guard = kind === 'ean13' && (i < 3 || (i >= 45 && i < 50) || i >= 92);
      d += `M${i + quiet} 0h${j - i}v${barH + (guard && textH ? 4 : 0)}h-${j - i}z`;
      i = j;
    } else i++;
  }
  const label = !textH
    ? ''
    : kind === 'ean13'
      ? `<text x="${quiet - 7}" y="${barH + 8.5}" font-size="9">${code[0]}</text><text x="${quiet + 24}" y="${barH + 8.5}" font-size="9" text-anchor="middle" letter-spacing="1.2">${code.slice(1, 7)}</text><text x="${quiet + 70}" y="${barH + 8.5}" font-size="9" text-anchor="middle" letter-spacing="1.2">${code.slice(7)}</text>`
      : `<text x="${w / 2}" y="${barH + 8.5}" font-size="8.5" text-anchor="middle">${code.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${barH + textH}" preserveAspectRatio="none" width="100%" height="100%" shape-rendering="crispEdges" font-family="monospace"><rect width="${w}" height="${barH + textH}" fill="#fff"/><path d="${d}" fill="#000"/>${label}</svg>`;
}
