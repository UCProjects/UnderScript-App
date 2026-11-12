const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  list: () => ipcRenderer.invoke('plugins:list'),
  warnings: () => ipcRenderer.invoke('plugins:warnings'),
  reinstall: (url) => ipcRenderer.invoke('plugins:reinstall', url),
  openLink: (url, kind) => ipcRenderer.invoke('plugins:open-link', url, kind),
  setEnabled: (url, enabled) => ipcRenderer.invoke('plugins:enable', url, enabled),
  remove: (url) => ipcRenderer.invoke('plugins:remove', url),
  showAtStartup: () => ipcRenderer.invoke('plugins:show-at-startup'),
  setShowAtStartup: (value) => ipcRenderer.invoke('plugins:set-show-at-startup', value),
  done: () => ipcRenderer.send('plugins:done'),
});
