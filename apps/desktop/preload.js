// The small bridge the app uses on Windows: list printers and print without the dialog.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kaarobarlyDesktop', {
  platform: 'windows',
  printers: () => ipcRenderer.invoke('kb:printers'),
  print: (html, opts) => ipcRenderer.invoke('kb:print', html, opts),
});
