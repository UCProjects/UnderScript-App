(() => {
  function ready(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback, { once: true });
    } else {
      callback();
    }
  }

  const plugin = new Promise((resolve) => {
    ready(() => {
      if (typeof underscript === 'undefined') return;
      resolve(underscript.plugin('UnderScript App'));
    });
  });

  underscriptApp.onToast((data) => {
    plugin.then((instance) => {
      if (!instance) return;
      if (data.refresh) {
        data.onClose = () => location.reload();
        delete data.refresh;
      }
      instance.toast(data);
    });
  });

  plugin.then(({ events }) => {
    let loggedIn = false;
    events.on('Chat:Connected', () => {
      loggedIn = true;
    });
    events.on(':GuestMode', () => {
      if (!loggedIn) return;
      location.href = '/SignIn';
    });
  });
})();
