// Kaarobarly for Windows: the same app as the phone, from a local copy of the web build,
// with silent printing to installed Windows printers (receipt, label and A4).
const { app, BrowserWindow, Menu, ipcMain, net, protocol, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');

const WEB = path.join(__dirname, 'web');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'Kaarobarly',
    backgroundColor: '#EEF1FB',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadURL('app://kaarobarly/');
  // links to WhatsApp, the shop page and the web open in the normal browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:|^tel:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) {
      e.preventDefault();
      void shell.openExternal(url);
    }
  });
}

app.whenReady().then(() => {
  // serve the web build; every unknown path is a screen of the app (index.html)
  protocol.handle('app', async (req) => {
    const { pathname } = new URL(req.url);
    let file = path.normalize(path.join(WEB, decodeURIComponent(pathname)));
    if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(WEB, 'index.html');
    // the same isolation headers as the web build, so the offline database can run
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers);
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
    if (file.endsWith('.html')) headers.set('Content-Type', 'text/html; charset=utf-8');
    return new Response(res.body, { status: res.status, headers });
  });

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Kaarobarly',
        submenu: [
          { role: 'reload' },
          { role: 'togglefullscreen', label: 'Full screen (counter mode)' },
          { type: 'separator' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { role: 'resetZoom' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
    ]),
  );

  ipcMain.handle('kb:printers', async () => {
    const list = await win.webContents.getPrintersAsync();
    return list.map((p) => ({ name: p.name, isDefault: !!p.isDefault }));
  });

  // print an HTML document: silently to the chosen printer, or with the Windows print dialog
  ipcMain.handle('kb:print', async (_e, html, opts = {}) => {
    if (typeof html !== 'string' || html.length > 20_000_000) throw new Error('Nothing to print');
    const job = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
    try {
      await job.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const options = {
        silent: !!opts.silent && !!opts.printer,
        deviceName: opts.printer || undefined,
        printBackground: true,
        margins: { marginType: 'none' },
        ...(opts.widthMicrons ? { pageSize: { width: opts.widthMicrons, height: opts.heightMicrons || 297000 } } : {}),
      };
      return await new Promise((resolve, reject) => job.webContents.print(options, (ok, reason) => (ok || reason === 'cancelled' ? resolve(ok) : reject(new Error(reason || 'Printing failed')))));
    } finally {
      job.destroy();
    }
  });

  createWindow();

  // "Kaarobarly.exe --smoke": load the app, report what it sees, then quit (checks a build)
  if (process.argv.includes('--smoke')) {
    win.webContents.once('did-finish-load', () =>
      setTimeout(async () => {
        const r = await win.webContents.executeJavaScript('(async () => ({ title: document.title, text: document.body.innerText.slice(0, 120), bridge: typeof window.kaarobarlyDesktop, url: location.href, api: await fetch("https://kaarobarly.zhtrader.com/health").then((r) => r.status).catch((e) => String(e)), isolated: self.crossOriginIsolated }))()');
        const printers = await win.webContents.getPrintersAsync();
        console.log('SMOKE', JSON.stringify({ ...r, printers: printers.map((p) => p.name) }));
        app.quit();
      }, 8000),
    );
  }
});

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
app.on('window-all-closed', () => app.quit());
