const { ipcRenderer } = require('electron');
const { resolve } = require('path');

ipcRenderer.invoke('dir:scripts').then((dir) => {
  require(resolve(dir, 'underscript.bundle.js'));
});
