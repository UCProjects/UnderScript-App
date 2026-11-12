const regexPattern = /^\/(.+)\/([a-z]*)$/;
const matchPattern = /^(\*|https?|file|ftp):\/\/([^/]*)(\/.*)$/;

function escape(text) {
  return text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

function glob(text) {
  return new RegExp(`^${text.split('*').map(escape).join('.*')}$`, 'i');
}

function matchesHost(pattern, url) {
  const host = pattern.toLowerCase();
  if (host === '*') return true;
  if (host.startsWith('*.')) {
    const base = host.slice(2);
    return url.hostname === base || url.hostname.endsWith(`.${base}`);
  }
  return (host.includes(':') ? url.host : url.hostname) === host;
}

function matchesPattern(pattern, url) {
  if (pattern === '<all_urls>') return ['http:', 'https:', 'file:', 'ftp:'].includes(url.protocol);
  const parsed = matchPattern.exec(pattern);
  if (!parsed) return false;
  const [, scheme, host, path] = parsed;
  const allowed = scheme === '*' ? ['http:', 'https:'].includes(url.protocol) : url.protocol === `${scheme}:`;
  return allowed && matchesHost(host, url) && glob(path).test(`${url.pathname}${url.search}`);
}

function matchesInclude(pattern, href) {
  const regex = regexPattern.exec(pattern);
  if (!regex) return glob(pattern).test(href);
  try {
    return new RegExp(regex[1], regex[2]).test(href);
  } catch (e) {
    return false;
  }
}

export function matchesUrl({ matches = [], includes = [], excludes = [], excludeMatches = [] }, href) {
  let url;
  try {
    url = new URL(href);
  } catch (e) {
    return false;
  }
  const included = matches.some((pattern) => matchesPattern(pattern, url))
    || includes.some((pattern) => matchesInclude(pattern, url.href));
  if (!included) return false;
  return !excludes.some((pattern) => matchesInclude(pattern, url.href))
    && !excludeMatches.some((pattern) => matchesPattern(pattern, url));
}
