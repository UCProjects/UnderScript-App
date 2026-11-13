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

const svgNamespace = 'http://www.w3.org/2000/svg';
const symbols = {
  globe: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M3 12h18' }], ['path', { d: 'M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18' }]],
  code: [['path', { d: 'M8 7l-5 5l5 5M16 7l5 5l-5 5M14 4l-4 16' }]],
  up: [['path', { d: 'M6 15l6-6l6 6' }]],
  down: [['path', { d: 'M6 9l6 6l6-6' }]],
  bug: [
    ['ellipse', { cx: 12, cy: 14, rx: 5, ry: 6.5 }],
    ['path', { d: 'M9 7.5a3 3 0 0 1 6 0' }],
    ['path', { d: 'M12 7.5v13' }],
    ['path', { d: 'M7 11H3M7.2 15.5L3.5 17.5M7.5 8L4.5 5.5' }],
    ['path', { d: 'M17 11h4M16.8 15.5l3.7 2M16.5 8l3-2.5' }],
  ],
};

function symbol(name) {
  const svg = document.createElementNS(svgNamespace, 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) {
    svg.setAttribute(key, value);
  }
  for (const [tag, attributes] of symbols[name]) {
    const part = document.createElementNS(svgNamespace, tag);
    Object.entries(attributes).forEach(([key, value]) => part.setAttribute(key, value));
    svg.append(part);
  }
  return svg;
}

const tooltip = element('div', { className: 'tooltip', hidden: true, role: 'tooltip' });
document.body.append(tooltip);

function hideTooltip() {
  tooltip.hidden = true;
}

function attachTooltip(target, title, detail) {
  function show() {
    tooltip.replaceChildren(
      element('div', { className: 'tip-title', textContent: title }),
      element('div', { className: 'tip-detail', textContent: detail }));
    tooltip.hidden = false;
    const box = target.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(Math.max(margin, box.left + box.width / 2 - tooltip.offsetWidth / 2), window.innerWidth - tooltip.offsetWidth - margin);
    const below = box.bottom + margin;
    const top = below + tooltip.offsetHeight > window.innerHeight - margin ? box.top - tooltip.offsetHeight - margin : below;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }
  target.addEventListener('mouseenter', show);
  target.addEventListener('focus', show);
  target.addEventListener('mouseleave', hideTooltip);
  target.addEventListener('blur', hideTooltip);
  target.addEventListener('click', hideTooltip);
}

function linkButton(plugin, kind, label) {
  const target = plugin.links?.[kind];
  if (!target) return [];
  const button = element('button', { type: 'button', className: 'linkbutton' }, symbol({ website: 'globe', source: 'code', support: 'bug' }[kind]));
  button.setAttribute('aria-label', label);
  attachTooltip(button, label, target);
  button.addEventListener('click', () => window.launcher.openLink(plugin.url, kind));
  return [button];
}

function pluginIcon(plugin) {
  if (plugin.icon) return element('img', { className: 'plugin-icon', src: plugin.icon, alt: '' });
  return element('div', { className: 'plugin-icon placeholder', textContent: initials(plugin.name) });
}

function arrowButton(plugin, step, disabled) {
  const label = step < 0 ? 'Load earlier' : 'Load later';
  const button = element('button', { type: 'button', className: 'arrow', disabled }, symbol(step < 0 ? 'up' : 'down'));
  button.dataset.step = step;
  button.setAttribute('aria-label', `${label}: ${plugin.name}`);
  if (!disabled) attachTooltip(button, label, 'Plugins run from the top of the list down');
  button.addEventListener('click', async () => {
    hideTooltip();
    if (await window.launcher.move(plugin.url, step)) await render(plugin.url, step);
  });
  return button;
}

function row(plugin, index, count) {
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

  const arrows = element('div', { className: 'order' },
    arrowButton(plugin, -1, index === 0),
    arrowButton(plugin, 1, index === count - 1));

  item.append(
    arrows,
    toggle,
    pluginIcon(plugin),
    element('div', { className: 'info' },
      element('div', { className: 'name', textContent: plugin.name }),
      element('div', { className: 'sub' },
        element('span', { className: 'version', textContent: `v${plugin.version}` }),
        ...linkButton(plugin, 'website', 'Website'),
        ...linkButton(plugin, 'source', 'Source'),
        ...linkButton(plugin, 'support', 'Report a problem or get support')),
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

async function render(focusUrl, step) {
  const plugins = await window.launcher.list();
  summary.textContent = plugins.length
    ? `${plugins.length} plugin${plugins.length === 1 ? '' : 's'} installed. Untick a plugin to turn it off.`
    : 'No plugins installed.';
  list.replaceChildren(...plugins.length ? plugins.map((plugin, index) => row(plugin, index, plugins.length)) : [element('li', { className: 'empty' }, 'Nothing here yet.')]);
  markWarnings().catch(() => {});
  if (focusUrl === undefined) return;
  const moved = [...list.querySelectorAll('li[data-url]')].find((item) => item.dataset.url === focusUrl);
  const same = moved?.querySelector(`button.arrow[data-step="${step}"]`);
  (same?.disabled ? moved.querySelector('button.arrow:not(:disabled)') : same)?.focus();
}

document.querySelector('main').addEventListener('scroll', hideTooltip);
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
