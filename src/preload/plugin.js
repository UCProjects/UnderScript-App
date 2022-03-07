const { ipcRenderer } = require('electron');

const promise = new Promise((res) => {
  document.addEventListener('DOMContentLoaded', () => {
    plugin = underscript.plugin('UnderScript App');
    res(plugin);
  }, { once: true });
});

let plugin;
function getPlugin() {
  if (plugin) return Promise.resolve(plugin);
  return promise;
}

ipcRenderer.on('toast', (_, data) => {
  getPlugin().then((plugin) => {
    if (data.refresh) {
      data.onClose = (...args) => {
        location.reload();
      };
      delete data.refresh;
    }
    plugin.toast(data);
    return plugin;
  });
});

module.exports = getPlugin;
