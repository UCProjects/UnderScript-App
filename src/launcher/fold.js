const foldDefaults = { minData: 200, maxPlain: 1500, keep: 400 };
const dataPrefix = /data:[\w.+-]+\/[\w.+-]+(?:;[\w.+=-]+)*;base64,/gi;

function formatSize(length) {
  if (length < 1024) return `${length} characters`;
  if (length < 1024 * 1024) return `${Math.round(length / 1024)} KB`;
  return `${(length / 1024 / 1024).toFixed(1)} MB`;
}

function isBase64(code) {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
    || code === 43 || code === 47 || code === 61 || code === 45 || code === 95;
}

function foldLine(line, options = {}) {
  const { minData, maxPlain, keep } = { ...foldDefaults, ...options };
  if (line.length <= Math.min(minData, maxPlain)) return undefined;

  const parts = [];
  let last = 0;
  dataPrefix.lastIndex = 0;
  for (let found = dataPrefix.exec(line); found; found = dataPrefix.exec(line)) {
    const start = found.index + found[0].length;
    let end = start;
    while (end < line.length && isBase64(line.charCodeAt(end))) end += 1;
    dataPrefix.lastIndex = end;
    if (end - start < minData) continue;
    parts.push({ text: line.slice(last, start), folded: false });
    parts.push({ text: line.slice(start, end), folded: true, label: `${formatSize(end - start)} of base64` });
    last = end;
  }
  parts.push({ text: line.slice(last), folded: false });

  const segments = parts.filter((part) => part.text.length).flatMap((part) => {
    if (part.folded || part.text.length <= maxPlain) return [part];
    const rest = part.text.length - keep;
    return [
      { text: part.text.slice(0, keep), folded: false },
      { text: part.text.slice(keep), folded: true, label: `${rest.toLocaleString('en-US')} more characters` },
    ];
  });
  return segments.some((part) => part.folded) ? segments : undefined;
}
