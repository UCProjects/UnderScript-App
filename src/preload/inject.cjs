const { contextBridge, ipcRenderer, webFrame } = require('electron');

const version = process.argv.find((arg) => arg.startsWith('--app-version='))?.split('=')[1];
console.log(`UnderScript App(v${version}): Loaded`);

let listening = false;

contextBridge.exposeInMainWorld('underscriptApp', {
  onToast: (callback) => {
    if (listening) return;
    listening = true;
    ipcRenderer.on('toast', (_, data) => callback(data));
  },
});

(async () => {
  const scripts = await ipcRenderer.invoke('inject:scripts');
  for (const script of scripts) {
    await webFrame.executeJavaScript(script);
  }
})();
