const { contextBridge, ipcRenderer, webFrame } = require('electron');

const version = process.argv.find((arg) => arg.startsWith('--app-version='))?.split('=')[1];
console.log(`UnderScript App(v${version}): Loaded`);

let listening = false;
let stored = {};

contextBridge.exposeInMainWorld('underscriptApp', {
  version,
  onToast: (callback) => {
    if (listening) return;
    listening = true;
    ipcRenderer.on('toast', (_, data) => callback(data));
  },
  getValues: (token) => ({ ...stored[token] }),
  setValue: (token, key, raw) => {
    if (!stored[token] || typeof key !== 'string' || typeof raw !== 'string') return;
    stored[token][key] = raw;
    ipcRenderer.send('gm:set', token, key, raw);
  },
  deleteValue: (token, key) => {
    if (!stored[token] || typeof key !== 'string') return;
    delete stored[token][key];
    ipcRenderer.send('gm:delete', token, key);
  },
});

(async () => {
  const injection = await ipcRenderer.invoke('inject:scripts');
  stored = Object.fromEntries(Object.entries(injection.values).map(([token, values]) => [token, { ...values }]));
  for (const script of injection.scripts) {
    try {
      await webFrame.executeJavaScript(script);
    } catch (error) {
      console.error(error);
    }
  }
})();
