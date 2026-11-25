/**
 * Renders brand/promo/promo.html to PNG posters (feed 1080x1350, story 1080x1920, square 1080x1080).
 * Run from the repo root:  apps/desktop/node_modules/electron/dist/electron.exe brand/promo/render-promo.cjs [days]
 * Uses the DevTools screenshot call, so the image is full size whatever the screen size is.
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const SIZES = { feed: 1350, story: 1920, square: 1080 };
const days = process.argv.find((a) => /^\d+$/.test(a)) || '30';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => fs.appendFileSync(path.join(__dirname, 'render.log'), a.join(' ') + '\n');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1080, height: 800, webPreferences: { offscreen: true } });
  win.webContents.setFrameRate(30);
  const dbg = win.webContents.debugger;
  await win.loadURL('about:blank');
  dbg.attach('1.3');
  log('ready');
  try {
    for (const [size, h] of Object.entries(SIZES)) {
      await dbg.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1080, height: h, deviceScaleFactor: 1, mobile: false });
      log('loading', size);
      await win.loadURL(pathToFileURL(path.join(__dirname, 'promo.html')).href + `?size=${size}&days=${days}`);
      for (let i = 0; i < 40; i++) {
        if (await win.webContents.executeJavaScript('document.body.dataset.ready === "1"')) break;
        await wait(250);
      }
      await wait(900);
      const shot = await dbg.sendCommand('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1080, height: h, scale: 1 }, captureBeyondViewport: true });
      const out = path.join(__dirname, `tijar-promo-${size}.png`);
      fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
      log('wrote', out, `1080x${h}`);
    }
  } catch (e) {
    log('render failed:', e.message);
  }
  app.quit();
});
