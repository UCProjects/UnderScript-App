const blockPattern = /^[ \t]*\/\/[ \t]*==UserScript==[ \t]*\r?\n([\s\S]*?)^[ \t]*\/\/[ \t]*==\/UserScript==/m;
const linePattern = /^[ \t]*\/\/[ \t]*@(\S+)(?:[ \t]+(.*?))?[ \t]*$/;
const resourcePattern = /^(\S+)\s+(\S+)/;
const pinPattern = /^(?:md5|sha\d+)(?:[=-]|$)/i;
const integrityPattern = /^(sha256|sha384|sha512)[=-](.+)$/;
const digestSizes = { sha256: 32, sha384: 48, sha512: 64 };
const ignoredRequires = new Set([
  'https://raw.githubusercontent.com/UCProjects/UnderScript/master/src/checkerV2.js',
]);
const singles = new Set([
  'name',
  'namespace',
  'version',
  'description',
  'author',
  'homepage',
  'homepageURL',
  'website',
  'source',
  'icon',
  'iconURL',
  'defaulticon',
  'icon64',
  'icon64URL',
  'updateURL',
  'downloadURL',
  'installURL',
  'supportURL',
  'copyright',
  'license',
  'run-at',
  'noframes',
  'sandbox',
  'unwrap',
  'top-level-await',
]);

function decodeHash(value, algorithm) {
  const size = digestSizes[algorithm];
  if (new RegExp(`^[0-9a-f]{${size * 2}}$`, 'i').test(value)) return value.toLowerCase();
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return undefined;
  const buffer = Buffer.from(value, 'base64');
  return buffer.length === size ? buffer.toString('hex') : undefined;
}

function parseTarget(value) {
  let url;
  try {
    url = new URL(value);
  } catch (e) {
    throw new Error(`Invalid url in meta block: ${value}`);
  }
  const fragment = url.hash.slice(1);
  if (!pinPattern.test(fragment.trim())) return { url: url.href, integrity: [] };
  url.hash = '';
  const integrity = [];
  for (const part of fragment.split(/[;,]/)) {
    const match = integrityPattern.exec(part.trim());
    const hash = match && decodeHash(match[2], match[1]);
    if (!hash) throw new Error(`Unusable integrity hash in ${value} (use sha256, sha384 or sha512)`);
    integrity.push({ algorithm: match[1], hash });
  }
  return { url: url.href, integrity };
}

export function parseMeta(source) {
  const block = blockPattern.exec(String(source));
  if (!block) return null;

  const values = new Map();
  for (const text of block[1].split(/\r?\n/)) {
    const line = linePattern.exec(text);
    if (!line) continue;
    if (!values.has(line[1])) values.set(line[1], []);
    values.get(line[1]).push(line[2] ?? '');
  }
  for (const [key, list] of values) {
    if (list.length > 1 && singles.has(key.split(':')[0])) throw new Error(`Duplicate @${key} in meta block`);
  }

  const all = (key) => values.get(key) ?? [];
  const first = (key) => all(key)[0];

  const resources = [];
  for (const entry of all('resource')) {
    const match = resourcePattern.exec(entry);
    if (!match) continue;
    if (resources.some(([name]) => name === match[1])) throw new Error(`Duplicate @resource ${match[1]} in meta block`);
    resources.push([match[1], parseTarget(match[2])]);
  }

  return {
    name: first('name'),
    namespace: first('namespace'),
    version: first('version'),
    description: first('description'),
    author: first('author'),
    homepage: first('homepage'),
    icon: first('icon'),
    updateURL: first('updateURL'),
    downloadURL: first('downloadURL'),
    runAt: first('run-at') ?? 'document-idle',
    noframes: values.has('noframes'),
    matches: all('match'),
    includes: all('include'),
    excludes: all('exclude'),
    excludeMatches: all('exclude-match'),
    connects: all('connect'),
    grants: all('grant'),
    requires: all('require').filter(Boolean).map(parseTarget).filter(({ url }) => !ignoredRequires.has(url)),
    resources: Object.fromEntries(resources),
    values: Object.fromEntries(values),
  };
}
