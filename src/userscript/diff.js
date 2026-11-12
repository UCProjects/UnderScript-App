const lineBreak = /\r?\n/;

export const diffLimits = {
  context: 3,
  maxEdits: 1500,
  maxLines: 600,
  maxLineLength: 600,
};

function shorten(text) {
  return text.length > diffLimits.maxLineLength ? `${text.slice(0, diffLimits.maxLineLength)}...` : text;
}

function search(a, b, maxEdits) {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, maxEdits);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace = [];
  for (let d = 0; d <= max; d++) {
    trace.push({ low: -d - 1, data: v.slice(offset - d - 1, offset + d + 2) });
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) x = v[offset + k + 1];
      else x = v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return trace;
    }
  }
  return undefined;
}

function backtrack(a, b, trace) {
  const ops = [];
  let x = a.length;
  let y = b.length;
  for (let d = trace.length - 1; d >= 0; d--) {
    const { low, data } = trace[d];
    const at = (k) => data[k - low];
    const k = x - y;
    const previousK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const previousX = at(previousK);
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      ops.push({ type: ' ', text: a[x - 1] });
      x -= 1;
      y -= 1;
    }
    if (d > 0) {
      if (x === previousX) ops.push({ type: '+', text: b[previousY] });
      else ops.push({ type: '-', text: a[previousX] });
    }
    x = previousX;
    y = previousY;
  }
  return ops.reverse();
}

function commonEnds(a, b) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end += 1;
  return { start, end };
}

function group(ops, context) {
  const ranges = [];
  ops.forEach((op, index) => {
    if (op.type === ' ') return;
    const from = Math.max(0, index - context);
    const to = Math.min(ops.length - 1, index + context);
    const last = ranges.at(-1);
    if (last && from <= last.to + 1) last.to = Math.max(last.to, to);
    else ranges.push({ from, to });
  });
  return ranges;
}

export function diffLines(before, after, options = {}) {
  const { context, maxEdits, maxLines } = { ...diffLimits, ...options };
  const a = String(before).split(lineBreak);
  const b = String(after).split(lineBreak);
  const { start, end } = commonEnds(a, b);
  const middleA = a.slice(start, a.length - end);
  const middleB = b.slice(start, b.length - end);
  if (!middleA.length && !middleB.length) return { added: 0, removed: 0, hunks: [], truncated: false, tooLarge: false };

  const trace = search(middleA, middleB, maxEdits);
  if (!trace) return { added: middleB.length, removed: middleA.length, hunks: [], truncated: false, tooLarge: true };

  const lead = a.slice(Math.max(0, start - context), start).map((text) => ({ type: ' ', text }));
  const trail = a.slice(a.length - end, a.length - end + context).map((text) => ({ type: ' ', text }));
  const ops = [...lead, ...backtrack(middleA, middleB, trace), ...trail];
  const firstOld = start - lead.length + 1;

  const numbered = [];
  let oldLine = firstOld;
  let newLine = firstOld;
  for (const op of ops) {
    numbered.push({ ...op, oldLine, newLine });
    if (op.type !== '+') oldLine += 1;
    if (op.type !== '-') newLine += 1;
  }

  let added = 0;
  let removed = 0;
  numbered.forEach(({ type }) => {
    if (type === '+') added += 1;
    if (type === '-') removed += 1;
  });

  let budget = maxLines;
  let truncated = false;
  const hunks = [];
  for (const { from, to } of group(numbered, context)) {
    if (budget <= 0) {
      truncated = true;
      break;
    }
    const lines = numbered.slice(from, to + 1);
    const shown = lines.slice(0, budget);
    if (shown.length < lines.length) truncated = true;
    budget -= shown.length;
    hunks.push({
      oldStart: shown[0].oldLine,
      newStart: shown[0].newLine,
      lines: shown.map(({ type, text, oldLine: o, newLine: n }) => ({ type, text: shorten(text), old: type === '+' ? undefined : o, new: type === '-' ? undefined : n })),
    });
  }
  return { added, removed, hunks, truncated, tooLarge: false };
}
