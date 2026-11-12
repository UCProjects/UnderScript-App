const limit = 12;
const changeLimit = 40;
const maxMatches = 10000;
const highlightWindow = 200;

const sections = document.getElementById('sections');
const accept = document.getElementById('accept');
const cancel = document.getElementById('cancel');

function element(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function section(title, ...rows) {
  return element('section', {}, element('h2', { textContent: title }), element('div', { className: 'items' }, ...rows));
}

function row(...children) {
  return element('div', {}, ...children);
}

function note(text) {
  return element('div', { className: 'muted note', textContent: text });
}

function lines(values, max = limit) {
  const nodes = values.slice(0, max).map((value) => element('div', { className: 'mono', textContent: value }));
  if (values.length > max) nodes.push(element('div', { className: 'muted', textContent: `and ${values.length - max} more` }));
  return nodes;
}

function capped(values, max = limit) {
  return lines(values, max).map((node) => row(node));
}

function changeRow({ type, key, value }) {
  const signs = { added: '+', removed: '-', moved: '~' };
  const what = type === 'moved' ? `@${key} (order changed)` : `@${key} ${value}`.trim();
  return element('div', { className: `change ${type}` },
    element('span', { className: 'sign mono', textContent: signs[type] }),
    element('span', { className: 'what mono', textContent: what }));
}

function permissionRow({ text, names }) {
  return row(
    element('div', { textContent: text }),
    element('div', { className: 'chips' }, ...names.map((name) => element('span', { className: 'chip', textContent: name }))));
}

const expandables = [];

function expandable(label, build) {
  const button = element('button', { type: 'button', className: 'link', textContent: `Show ${label}` });
  const pane = element('div', { className: 'pane', hidden: true });
  const close = () => {
    pane.hidden = true;
    button.textContent = `Show ${label}`;
  };
  const bringIntoView = () => {
    const main = pane.closest('main');
    if (!main) return;
    const box = main.getBoundingClientRect();
    const shown = pane.getBoundingClientRect();
    if (shown.top < box.top || shown.bottom > box.bottom) button.parentElement.scrollIntoView({ block: 'start' });
  };
  expandables.push(close);
  let loaded = false;
  button.addEventListener('click', async () => {
    if (!pane.hidden) {
      close();
      return;
    }
    expandables.filter((other) => other !== close).forEach((other) => other());
    pane.hidden = false;
    button.textContent = `Hide ${label}`;
    if (loaded) {
      bringIntoView();
      return;
    }
    loaded = true;
    pane.replaceChildren(note('Loading...'));
    try {
      pane.replaceChildren(await build());
    } catch (error) {
      pane.replaceChildren(note(`The ${label} could not be loaded`));
    }
    bringIntoView();
  });
  return { button, pane };
}

function findBar(viewer, rows, text, folds) {
  const lineStarts = [0];
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) lineStarts.push(at + 1);

  const input = element('input', { type: 'search', className: 'find', placeholder: 'Find in source', spellcheck: false });
  const sensitive = element('button', { type: 'button', className: 'step', textContent: 'Aa', title: 'Match case' });
  const previous = element('button', { type: 'button', className: 'step', textContent: '↑', title: 'Previous match (Shift+Enter)' });
  const next = element('button', { type: 'button', className: 'step', textContent: '↓', title: 'Next match (Enter)' });
  const count = element('span', { className: 'count muted' });
  const jump = element('input', { type: 'number', className: 'jump', placeholder: 'Line', min: 1, max: rows.length });
  jump.style.setProperty('--digits', String(rows.length).length);
  const bar = element('div', { className: 'findbar' }, input, sensitive, previous, next, count, jump);

  let matches = [];
  let current = -1;
  let needle = '';
  let timer;

  const lineOf = (offset) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (lineStarts[middle] <= offset) low = middle;
      else high = middle - 1;
    }
    return low;
  };

  const range = (offset, length, unfold = false) => {
    const line = lineOf(offset);
    const first = offset - lineStarts[line];
    const last = first + length;
    const found = new Range();
    const segments = folds.get(line);
    if (!segments) {
      const node = rows[line].lastChild.firstChild;
      if (!node) return undefined;
      found.setStart(node, first);
      found.setEnd(node, last);
      return found;
    }
    const touched = segments.filter((segment) => segment.end > first && segment.start < Math.max(last, first + 1));
    if (touched.some((segment) => segment.folded)) {
      if (!unfold) return undefined;
      touched.forEach((segment) => segment.expand());
    }
    found.setStart(touched[0].node, first - touched[0].start);
    found.setEnd(touched.at(-1).node, last - touched.at(-1).start);
    return found;
  };

  function reveal(offset, length) {
    const target = rows[lineOf(offset)];
    const place = length ? range(offset, length, true)?.getBoundingClientRect() : undefined;
    const box = viewer.getBoundingClientRect();
    const top = place?.height ? place.top - box.top + viewer.scrollTop : target.offsetTop;
    const height = place?.height ? place.height : target.offsetHeight;
    if (top < viewer.scrollTop + height || top + height > viewer.scrollTop + viewer.clientHeight - height) {
      const centered = top - (viewer.clientHeight - height) / 2;
      viewer.scrollTop = Math.max(0, height > viewer.clientHeight ? top - 8 : centered);
    }
  }

  function paint() {
    if (!CSS.highlights) return;
    const around = [];
    for (let index = Math.max(0, current - highlightWindow); index < Math.min(matches.length, current + highlightWindow); index++) {
      if (index !== current) around.push(range(matches[index], needle.length));
    }
    CSS.highlights.set('find', new Highlight(...around.filter(Boolean)));
    const active = current >= 0 ? range(matches[current], needle.length) : undefined;
    CSS.highlights.set('find-current', active ? new Highlight(active) : new Highlight());
  }

  function show() {
    if (!needle) count.textContent = '';
    else if (!matches.length) count.textContent = 'No matches';
    else count.textContent = `${current + 1} of ${matches.length}${matches.length >= maxMatches ? '+' : ''}`;
    if (current >= 0) range(matches[current], needle.length, true);
    paint();
    if (current >= 0) reveal(matches[current], needle.length);
  }

  function search() {
    needle = input.value;
    matches = [];
    if (needle) {
      const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), sensitive.classList.contains('active') ? 'g' : 'gi');
      for (let found = pattern.exec(text); found && matches.length < maxMatches; found = pattern.exec(text)) matches.push(found.index);
    }
    const visible = rows.findIndex((line) => line.offsetTop + line.offsetHeight > viewer.scrollTop);
    const top = lineStarts[Math.max(0, visible)];
    const first = matches.findIndex((offset) => offset >= top);
    current = matches.length ? Math.max(0, first) : -1;
    show();
  }

  function step(direction) {
    if (!matches.length) return;
    current = (current + direction + matches.length) % matches.length;
    show();
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(search, 150);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
      if (input.value !== needle) {
        search();
        return;
      }
    }
    step(event.shiftKey ? -1 : 1);
  });
  sensitive.addEventListener('click', () => {
    sensitive.classList.toggle('active');
    search();
  });
  previous.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  jump.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const line = Math.min(rows.length, Math.max(1, Math.trunc(Number(jump.value))));
    if (!Number.isFinite(line)) return;
    const start = lineStarts[line - 1];
    const end = line < lineStarts.length ? lineStarts[line] - 1 : text.length;
    reveal(start, 0);
    const marked = end > start ? range(start, end - start) : undefined;
    if (CSS.highlights) CSS.highlights.set('find-current', marked ? new Highlight(marked) : new Highlight());
    count.textContent = `Line ${line}`;
  });
  return bar;
}

function lineContent(line, index, folds) {
  const content = element('span', { className: 'ln mono' });
  const parts = foldLine(line);
  if (!parts) {
    content.textContent = line;
    return content;
  }
  let start = 0;
  folds.set(index, parts.map((part) => {
    const segment = { start, end: start + part.text.length, text: part.text, folded: part.folded };
    if (part.folded) {
      segment.node = element('button', { type: 'button', className: 'fold', textContent: part.label, title: 'Show' });
      segment.node.addEventListener('click', () => segment.expand());
    } else {
      segment.node = document.createTextNode(part.text);
    }
    segment.expand = () => {
      if (!segment.folded) return;
      const expanded = document.createTextNode(segment.text);
      segment.node.replaceWith(expanded);
      segment.node = expanded;
      segment.folded = false;
    };
    content.append(segment.node);
    start = segment.end;
    return segment;
  }));
  return content;
}

async function sourceView() {
  const source = await window.confirmation.source();
  if (!source) return note('The source is not available');
  const text = source.text.replace(/\r\n/g, '\n');
  const all = text.split('\n');
  const folds = new Map();
  const rows = all.map((line, index) => element('div', { className: 'row' },
    element('span', { className: 'no mono', textContent: index + 1 }),
    lineContent(line, index, folds)));
  const viewer = element('div', { className: 'viewer' }, element('div', { className: 'rows' }, ...rows));
  viewer.style.setProperty('--digits', String(all.length).length);
  const container = element('div', {}, findBar(viewer, rows, text, folds), viewer);
  const kilobytes = (value) => `${Math.round(value / 1024)} KB`;
  const summary = source.truncated
    ? `Showing the first ${kilobytes(text.length)} of ${kilobytes(source.total)}`
    : `${all.length} lines, ${kilobytes(source.total)}`;
  container.append(note(folds.size ? `${summary}. ${folds.size} long ${folds.size === 1 ? 'line is' : 'lines are'} folded` : summary));
  return container;
}

function diffRow({ type, text, old, new: next }) {
  const signs = { '+': '+', '-': '-', ' ': ' ' };
  return element('div', { className: `line ${type === '+' ? 'added' : ''} ${type === '-' ? 'removed' : ''}` },
    element('span', { className: 'num mono', textContent: old ?? '' }),
    element('span', { className: 'num mono', textContent: next ?? '' }),
    element('span', { className: 'sign mono', textContent: signs[type] }),
    element('span', { className: 'text mono', textContent: text }));
}

async function diffView() {
  const diff = await window.confirmation.diff();
  if (!diff) return note('The changes are not available');
  if (diff.tooLarge) return note(`Too many changes to show: about ${diff.added} lines added and ${diff.removed} removed`);
  if (!diff.hunks.length) return note('The code has no changes');
  const rows = diff.hunks.flatMap(({ oldStart, newStart, lines: hunkLines }, index) => [
    ...index ? [element('div', { className: 'gap mono', textContent: `@@ line ${oldStart} (was) / ${newStart} (now) @@` })] : [],
    ...hunkLines.map(diffRow),
  ]);
  const container = element('div', {}, element('div', { className: 'viewer diff' }, element('div', { className: 'lines' }, ...rows)));
  container.append(note(`${diff.added} lines added, ${diff.removed} removed${diff.truncated ? '. Only the first changes are shown' : ''}`));
  return container;
}

function render({ kind, name, version, previousVersion, info, changes, hasSource, canDiff }) {
  const update = kind === 'changed';
  document.title = update ? 'Update plugin' : 'Install plugin';
  document.getElementById('kind').textContent = update ? 'Update plugin' : 'Install plugin';
  document.getElementById('name').textContent = name;
  const versionText = update && previousVersion !== version ? `v${previousVersion} to v${version}` : `v${version}`;
  document.getElementById('subtitle').textContent = `${versionText} by ${info.author}`;
  document.getElementById('notice').textContent = update
    ? 'This update changes more than its version. Only update if you still trust this plugin.'
    : 'Plugins run on undercards.net with access to your account. Only install plugins you trust.';
  accept.textContent = update ? 'Update' : 'Install';

  const where = [row(element('span', { textContent: 'Every page UnderScript runs on' }))];
  if (info.noframes) where.push(row(element('span', { className: 'muted', textContent: 'Only in the main page, never inside frames' })));
  if (info.pages.length) {
    where.push(row(
      element('div', { className: 'hint', textContent: 'Also loads inside frames that match' }),
      ...lines(info.pages)));
  }

  const asksToRequest = info.permissions.some(({ names }) => names.some((grant) => grant === 'GM_xmlhttpRequest' || grant === 'GM.xmlHttpRequest'));

  const views = [
    ...canDiff ? [expandable('changes', diffView)] : [],
    ...hasSource ? [expandable('source', sourceView)] : [],
  ];

  sections.replaceChildren(
    ...update && changes.length
      ? [section('What changed', ...changes.slice(0, changeLimit).map(changeRow),
        ...changes.length > changeLimit ? [row(element('span', { className: 'muted', textContent: `and ${changes.length - changeLimit} more` }))] : [])]
      : [],
    section('Can do', ...info.permissions.length
      ? info.permissions.map(permissionRow)
      : [row(element('span', { className: 'muted', textContent: 'Nothing beyond running on Undercards.net' }))]),
    ...info.connects.length || asksToRequest
      ? [section('Can reach', ...info.connects.length
        ? capped(info.connects)
        : [row(element('span', { className: 'muted', textContent: 'No sites declared, so its web requests will be refused' }))])]
      : [],
    section('Runs on', ...where),
    ...info.code.length ? [section('Loads code from', ...capped(info.code))] : [],
    section('Source',
      row(element('span', { className: 'mono', textContent: info.source })),
      ...views.length ? [row(element('div', { className: 'actions' }, ...views.map(({ button }) => button)))] : [],
      ...views.map(({ pane }) => pane)),
  );
}

accept.addEventListener('click', () => window.confirmation.answer(true));
cancel.addEventListener('click', () => window.confirmation.answer(false));
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
    const input = document.querySelector('.pane:not([hidden]) .find');
    if (!input) return;
    event.preventDefault();
    input.focus();
    input.select();
    return;
  }
  if (event.key !== 'Escape') return;
  if (event.target.matches('input')) {
    event.target.blur();
    return;
  }
  window.confirmation.answer(false);
});

(async () => {
  const details = await window.confirmation.details();
  if (!details) {
    window.confirmation.answer(false);
    return;
  }
  render(details);
  cancel.focus();
})();
