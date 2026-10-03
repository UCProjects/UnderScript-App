import { request } from './download.js';

export const registryURL = 'https://raw.githubusercontent.com/UCProjects/UnderScript/refs/heads/master/plugins.json';

const releasePattern = /^\/([^/]+)\/([^/]+)\/releases\/(?:latest\/download|download\/[^/]+)\/([^/]+)$/;

function secure(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.protocol === 'https:' ? url : undefined;
  } catch (e) {
    return undefined;
  }
}

function release(url) {
  if (url.hostname !== 'github.com') return undefined;
  const match = releasePattern.exec(url.pathname);
  return match && match.slice(1).map((part) => part.toLowerCase()).join('/');
}

export function parseRegistry(data) {
  if (!Array.isArray(data)) throw new Error('Invalid registry');
  return data.flatMap((entry) => {
    const { name, author, updateURL, downloadURL } = entry ?? {};
    const url = secure([downloadURL, updateURL].find((value) => typeof value === 'string'));
    if (typeof name !== 'string' || !name || !url?.pathname.endsWith('.user.js')) return [];
    return [{ name, author: typeof author === 'string' ? author : undefined, url: url.href }];
  });
}

export function findEntry(entries, clicked) {
  const target = secure(clicked);
  if (!target) return undefined;
  const targetRelease = release(target);
  return entries.find((entry) => {
    if (entry.url === target.href) return true;
    const entryRelease = release(new URL(entry.url));
    return Boolean(entryRelease) && entryRelease === targetRelease;
  });
}

export async function loadRegistry() {
  const res = await request(registryURL);
  if (res.status !== 200) throw new Error(`Unable to load the plugin registry (${res.status})`);
  return parseRegistry(await res.json());
}
