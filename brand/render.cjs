/**
 * Draws every Tijar logo PNG (app icons, adaptive icon layers, splash, favicons, website images)
 * from the SVG masters in this folder. Uses Electron's renderer, so no image library is needed.
 * Run from the repo root:  apps/desktop/node_modules/.bin/electron brand/render.cjs
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const B = __dirname;
const svg = (f) => fs.readFileSync(path.join(B, f), 'utf8');
const MOBILE = path.join(B, '../apps/mobile/assets/images');
const DESKTOP = path.join(B, '../apps/desktop/build');
const SITE = path.join(B, '../apps/api/site/assets/img');

const NAVY_BG = (id) => `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0F3444"/><stop offset="1" stop-color="#071621"/></linearGradient>`;
const inner = (s) => s.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

/** A square canvas: optional navy background (with corner radius) and the mark scaled to `scale`. */
function compose({ size, mark, scale, bg, radius = 0, dy = 0 }) {
  const m = size * scale;
  const x = (size - m) / 2;
  const y = (size - m) / 2 + dy * size;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs>${NAVY_BG('bg')}<radialGradient id="glow" cx=".7" cy=".25" r=".7"><stop offset="0" stop-color="#19B892" stop-opacity=".28"/><stop offset="1" stop-color="#19B892" stop-opacity="0"/></radialGradient></defs>
    ${bg ? `<rect width="${size}" height="${size}" rx="${radius * size}" fill="url(#bg)"/><rect width="${size}" height="${size}" rx="${radius * size}" fill="url(#glow)"/>` : ''}
    ${mark ? `<svg x="${x}" y="${y}" width="${m}" height="${m}" viewBox="-8 -12 282 282">${inner(svg(mark))}</svg>` : ''}
  </svg>`;
}

const JOBS = [
  [MOBILE, 'icon.png', compose({ size: 1024, mark: 'tijar-mark-on-dark.svg', scale: 0.66, bg: true })],
  [MOBILE, 'android-icon-foreground.png', compose({ size: 1024, mark: 'tijar-mark-on-dark.svg', scale: 0.5 })],
  [MOBILE, 'android-icon-background.png', compose({ size: 1024, bg: true })],
  [MOBILE, 'android-icon-monochrome.png', compose({ size: 1024, mark: 'tijar-mark-white.svg', scale: 0.5 })],
  [MOBILE, 'splash-icon.png', compose({ size: 512, mark: 'tijar-mark-on-dark.svg', scale: 0.92 })],
  [MOBILE, 'favicon.png', compose({ size: 96, mark: 'tijar-mark-on-dark.svg', scale: 0.74, bg: true, radius: 0.22 })],
  [DESKTOP, 'icon.png', compose({ size: 512, mark: 'tijar-mark-on-dark.svg', scale: 0.66, bg: true, radius: 0.22 })],
  [SITE, 'favicon.png', compose({ size: 192, mark: 'tijar-mark-on-dark.svg', scale: 0.72, bg: true, radius: 0.22 })],
  [SITE, 'icon-512.png', compose({ size: 512, mark: 'tijar-mark-on-dark.svg', scale: 0.66, bg: true, radius: 0.22 })],
  [B, 'preview.png', `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="420"><rect width="1200" height="420" fill="#fff"/><rect x="420" width="380" height="420" fill="#0F2A3B"/>
    <svg x="20" y="20" width="380" height="380" viewBox="-8 -12 282 282">${inner(svg('tijar-mark.svg'))}</svg>
    <svg x="440" y="20" width="340" height="340" viewBox="-8 -12 282 282">${inner(svg('tijar-mark-on-dark.svg')).replace(/id="(\w)"/g, 'id="d$1"').replace(/url\(#(\w)\)/g, 'url(#d$1)')}</svg>
    <svg x="820" y="150" width="360" height="81" viewBox="0 0 446 100">${inner(svg('tijar-wordmark.svg'))}</svg></svg>`],
];

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('about:blank');
  for (const [dir, file, src] of JOBS) {
    const url = await win.webContents.executeJavaScript(`new Promise((ok, no) => {
      const img = new Image();
      img.onload = () => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0); ok(c.toDataURL('image/png')); };
      img.onerror = () => no(new Error('bad svg'));
      img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(src).toString('base64'))};
    })`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file), Buffer.from(url.split(',')[1], 'base64'));
    console.log('wrote', path.relative(path.join(B, '..'), path.join(dir, file)));
  }
  app.quit();
});
