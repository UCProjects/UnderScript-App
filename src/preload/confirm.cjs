const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('confirmation', {
  details: () => ipcRenderer.invoke('confirm:details'),
  source: () => ipcRenderer.invoke('confirm:source'),
  diff: () => ipcRenderer.invoke('confirm:diff'),
  answer: (accepted) => ipcRenderer.send('confirm:answer', accepted === true),
});
