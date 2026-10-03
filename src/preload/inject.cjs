const { contextBridge, ipcRenderer, webFrame } = require('electron');

let listening = false;

contextBridge.exposeInMainWorld('underscriptApp', {
  onToast: (callback) => {
    if (listening) return;
    listening = true;
    ipcRenderer.on('toast', (_, data) => callback(data));
  },
});

ipcRenderer.invoke('inject:scripts').then(async (scripts) => {
  for (const script of scripts) {
    await webFrame.executeJavaScript(script);
  }
});
