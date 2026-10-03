const manager = new URLSearchParams(location.search).get('mode') === 'manager';
const list = document.getElementById('plugins');
const summary = document.getElementById('summary');
const startup = document.getElementById('startup');
const start = document.getElementById('start');

start.textContent = manager ? 'Done' : 'Start';

function element(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function row(plugin) {
  const toggle = element('input', { type: 'checkbox', checked: plugin.enabled, title: 'Enabled' });
  const item = element('li', { className: plugin.enabled ? '' : 'disabled' });
  toggle.addEventListener('change', async () => {
    await window.launcher.setEnabled(plugin.url, toggle.checked);
    item.classList.toggle('disabled', !toggle.checked);
  });

  const remove = element('button', { type: 'button', className: 'remove' }, 'Remove');
  let timer;
  remove.addEventListener('click', async () => {
    if (!remove.classList.contains('confirm')) {
      remove.classList.add('confirm');
      remove.textContent = 'Click again to remove';
      timer = setTimeout(() => {
        remove.classList.remove('confirm');
        remove.textContent = 'Remove';
      }, 3000);
      return;
    }
    clearTimeout(timer);
    await window.launcher.remove(plugin.url);
    await render();
  });

  item.append(
    toggle,
    element('div', { className: 'info' },
      element('div', { className: 'name', textContent: plugin.name }),
      element('div', { className: 'version', textContent: `v${plugin.version}` })),
    remove,
  );
  return item;
}

async function render() {
  const plugins = await window.launcher.list();
  summary.textContent = plugins.length
    ? `${plugins.length} plugin${plugins.length === 1 ? '' : 's'} installed. Untick a plugin to turn it off.`
    : 'No plugins installed.';
  list.replaceChildren(...plugins.length ? plugins.map(row) : [element('li', { className: 'empty' }, 'Nothing here yet.')]);
}

startup.addEventListener('change', () => window.launcher.setShowAtStartup(startup.checked));
start.addEventListener('click', () => window.launcher.done());
document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && document.activeElement === document.body) window.launcher.done();
});

(async () => {
  startup.checked = await window.launcher.showAtStartup();
  await render();
  start.focus();
})();
