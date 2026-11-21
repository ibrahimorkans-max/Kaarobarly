// The core encoder only (pure JS); the package's main entry pulls in Node and canvas code.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const core: { create(text: string, opts?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' }): { modules: { size: number; get(row: number, col: number): number } } } = require('qrcode/lib/core/qrcode');

/** A QR code as an SVG string (one path), for printing on documents. */
export function qrSvg(text: string, size = 120): string {
  const { modules } = core.create(text, { errorCorrectionLevel: 'M' });
  const n = modules.size;
  const quiet = 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (modules.get(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  }
  const view = n + quiet * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${view} ${view}" shape-rendering="crispEdges"><rect width="${view}" height="${view}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
