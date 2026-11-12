const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  list: () => ipcRenderer.invoke('plugins:list'),
  warnings: () => ipcRenderer.invoke('plugins:warnings'),
  setEnabled: (url, enabled) => ipcRenderer.invoke('plugins:enable', url, enabled),
  remove: (url) => ipcRenderer.invoke('plugins:remove', url),
  showAtStartup: () => ipcRenderer.invoke('plugins:show-at-startup'),
  setShowAtStartup: (value) => ipcRenderer.invoke('plugins:set-show-at-startup', value),
  done: () => ipcRenderer.send('plugins:done'),
});
