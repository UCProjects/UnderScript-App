const { ipcRenderer } = require('electron');

// Acts as a cache for the resulting plugin
const plugin = new Promise((res) => {
  document.addEventListener('DOMContentLoaded', () => {
    res(underscript.plugin('UnderScript App'));
  });
});

function getPlugin() {
  return Promise.resolve(plugin); // Hand out a fresh promise
}

ipcRenderer.on('toast', (_, data) => {
  getPlugin().then((plugin) => {
    if (!plugin) return; // Should never happen, but who knows
    if (data.refresh) {
      data.onClose = (...args) => {
        location.reload();
      };
      delete data.refresh;
    }
    plugin.toast(data);
  });
});

module.exports = getPlugin;
