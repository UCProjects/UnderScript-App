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

function describe({ status, version, previousVersion, message }) {
  if (status === 'installed' || status === 'updated') {
    const change = previousVersion === version || previousVersion === undefined ? `Reinstalled v${version}` : `Updated v${previousVersion} to v${version}`;
    return `${change}. Refresh the page to load it`;
  }
  if (status === 'cancelled') return 'Cancelled';
  if (status === 'rejected') return 'No longer in the community plugin list, so it cannot be reinstalled';
  return message ?? 'The plugin could not be reinstalled';
}

function row(plugin) {
  const toggle = element('input', { type: 'checkbox', checked: plugin.enabled, title: 'Enabled' });
  const item = element('li', { className: plugin.enabled ? '' : 'disabled' });
  item.dataset.url = plugin.url;
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

  const status = element('div', { className: 'status' });
  const reinstall = element('button', { type: 'button', className: 'reinstall' }, 'Reinstall');
  reinstall.addEventListener('click', async () => {
    reinstall.disabled = true;
    status.textContent = 'Reinstalling...';
    try {
      status.textContent = describe(await window.launcher.reinstall(plugin.url));
    } catch (error) {
      status.textContent = 'The plugin could not be reinstalled';
    }
    reinstall.disabled = false;
  });

  item.append(
    toggle,
    element('div', { className: 'info' },
      element('div', { className: 'name', textContent: plugin.name }),
      element('div', { className: 'version', textContent: `v${plugin.version}` }),
      status),
    ...plugin.source === 'registry' ? [reinstall] : [],
    remove,
  );
  return item;
}

async function markWarnings() {
  const warnings = await window.launcher.warnings();
  list.querySelectorAll('.warning').forEach((node) => node.remove());
  for (const item of list.querySelectorAll('li[data-url]')) {
    const warning = warnings.find(({ url }) => url === item.dataset.url);
    if (!warning) continue;
    const text = warning.kind === 'warn' ? warning.message : 'No longer in the community plugin list';
    item.querySelector('.info').append(element('div', { className: 'warning', textContent: text }));
  }
}

async function render() {
  const plugins = await window.launcher.list();
  summary.textContent = plugins.length
    ? `${plugins.length} plugin${plugins.length === 1 ? '' : 's'} installed. Untick a plugin to turn it off.`
    : 'No plugins installed.';
  list.replaceChildren(...plugins.length ? plugins.map(row) : [element('li', { className: 'empty' }, 'Nothing here yet.')]);
  markWarnings().catch(() => {});
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
