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

  function formatNotes(html) {
    const { body } = new DOMParser().parseFromString(html, 'text/html');
    body.querySelectorAll('ol, ul').forEach((list) => {
      list.style.textAlign = 'left';
      list.style.whiteSpace = 'normal';
      list.style.listStyle = list.tagName === 'OL' ? 'decimal' : 'disc';
      list.style.margin = '0.5em 0';
      list.style.paddingLeft = '1.5em';
    });
    return body.innerHTML;
  }

  underscriptApp.onToast(async (data) => {
    const instance = await plugin;
    if (!instance) return;
    if (data.notes) {
      data.text = `${formatNotes(data.notes)}${data.text ? `<p>${data.text}</p>` : ''}`;
      delete data.notes;
    }
    if (data.refresh) {
      data.onClose = () => location.reload();
      delete data.refresh;
    }
    instance.toast(data);
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
