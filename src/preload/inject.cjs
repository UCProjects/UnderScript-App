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
  getValues: (id) => ({ ...stored[id] }),
  setValue: (id, key, raw) => {
    if (typeof id !== 'string' || typeof key !== 'string' || typeof raw !== 'string') return;
    (stored[id] ??= {})[key] = raw;
    ipcRenderer.send('gm:set', id, key, raw);
  },
  deleteValue: (id, key) => {
    if (typeof id !== 'string' || typeof key !== 'string') return;
    delete stored[id]?.[key];
    ipcRenderer.send('gm:delete', id, key);
  },
});

(async () => {
  const injection = await ipcRenderer.invoke('inject:scripts');
  stored = injection.values;
  for (const script of injection.scripts) {
    try {
      await webFrame.executeJavaScript(script);
    } catch (error) {
      console.error(error);
    }
  }
})();
