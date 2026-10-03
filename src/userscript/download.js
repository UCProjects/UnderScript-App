import crypto from 'crypto';

const timeout = 60000;
const limit = 10 * 1024 * 1024;
const cache = new Map();

export async function request(url, headers) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'UnderScript-App',
      ...headers,
    },
    signal: AbortSignal.timeout(timeout),
  });
  if (res.url && new URL(res.url).protocol !== 'https:') throw new Error(`Refusing insecure redirect from ${url}`);
  return res;
}

export async function download({ url, integrity = [] }) {
  if (new URL(url).protocol !== 'https:') throw new Error(`Refusing to download ${url}`);
  const res = await request(url);
  if (res.status !== 200) throw new Error(`Unable to download ${url} (${res.status})`);
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > limit) throw new Error(`${url} is too large`);
  for (const { algorithm, hash } of integrity) {
    if (crypto.createHash(algorithm).update(body).digest('hex') !== hash) {
      throw new Error(`Checksum mismatch for ${url}`);
    }
  }
  return String(body);
}

export function cachedDownload(target) {
  const key = JSON.stringify([target.url, target.integrity ?? []]);
  if (!cache.has(key)) {
    cache.set(key, download(target).catch((err) => {
      cache.delete(key);
      throw err;
    }));
  }
  return cache.get(key);
}

export function clearDownloads() {
  cache.clear();
}
