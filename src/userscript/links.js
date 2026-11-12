const nameChars = /^[A-Za-z0-9_.-]+$/;
const gistChars = /^[0-9a-f]+$/i;
const pathChars = /^[A-Za-z0-9_.@+~%-]+$/;

function secure(value) {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && !url.username && !url.password ? url : undefined;
  } catch (e) {
    return undefined;
  }
}

function samePlace(a, b) {
  const strip = (value) => {
    const url = new URL(value);
    url.hash = '';
    return url.href.replace(/\/$/, '');
  };
  return strip(a) === strip(b);
}

function blobOf(page, rest) {
  const [first, second, third] = rest;
  let ref;
  let path;
  if (first === 'refs' && ['heads', 'tags'].includes(second)) {
    ref = third;
    path = rest.slice(3);
  } else {
    [ref] = rest;
    path = rest.slice(1);
  }
  if (!ref || !path.length || ![ref, ...path].every((part) => pathChars.test(part) && part !== '..')) return undefined;
  return `${page}/blob/${ref}/${path.join('/')}`;
}

function derive(value) {
  const url = secure(value);
  if (!url) return undefined;
  const parts = url.pathname.split('/').filter(Boolean);
  if (['github.com', 'raw.githubusercontent.com'].includes(url.hostname)) {
    const [owner, repo, ...rest] = parts;
    if (!nameChars.test(owner ?? '') || !nameChars.test(repo ?? '')) return undefined;
    const page = `https://github.com/${owner}/${repo}`;
    const inFile = url.hostname === 'github.com' ? ['blob', 'raw'].includes(rest[0]) && blobOf(page, rest.slice(1)) : blobOf(page, rest);
    return { page, support: `${page}/issues`, file: inFile || page };
  }
  if (['gist.github.com', 'gist.githubusercontent.com'].includes(url.hostname)) {
    const [user, id] = parts;
    if (!nameChars.test(user ?? '') || !gistChars.test(id ?? '')) return undefined;
    const page = `https://gist.github.com/${user}/${id}`;
    return { page, support: `${page}#new_comment_field`, file: page };
  }
  return undefined;
}

export function pluginLinks({ url, meta } = {}) {
  const values = meta?.values ?? {};
  const first = (key) => values[key]?.[0];
  const website = [meta?.homepage, first('homepageURL'), first('website')]
    .map(secure)
    .find(Boolean);
  const support = secure(first('supportURL'));
  const derived = [url, meta?.homepage, meta?.downloadURL, meta?.updateURL].map(derive).find(Boolean);
  const home = website?.href ?? derived?.page;
  const source = secure(first('source'))?.href ?? derived?.file ?? secure(url)?.href;
  return {
    website: home,
    source: source && !(home && samePlace(source, home)) ? source : undefined,
    support: support?.href ?? derived?.support,
  };
}
