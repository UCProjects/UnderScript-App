import { createBundle } from './bundle.js';
import { createDownloader, verifyIntegrity } from './download.js';
import { parseMeta } from './meta.js';

export async function fetchAssets(meta) {
  const downloadOnce = createDownloader();
  const requires = await Promise.all(meta.requires.map(async (target) => ({
    url: target.url,
    integrity: target.integrity,
    code: await downloadOnce(target),
  })));
  const resources = Object.fromEntries(await Promise.all(Object.entries(meta.resources).map(async ([name, target]) => [name, {
    url: target.url,
    integrity: target.integrity,
    code: await downloadOnce(target),
  }])));
  return { requires, resources };
}

export function assembleBundle(source, assets, localResources = {}) {
  const meta = parseMeta(source);
  if (!meta?.version) throw new Error('Unable to determine the script version');
  const everything = [...assets.requires, ...Object.values(assets.resources)];
  everything.forEach(({ url, integrity, code }) => verifyIntegrity(Buffer.from(code), integrity, url));
  return {
    meta,
    bundle: createBundle(meta, source, {
      requires: assets.requires.map(({ code }) => code),
      resources: Object.fromEntries(Object.entries(assets.resources).map(([name, { code }]) => [name, code])),
      localResources,
    }),
  };
}

export async function buildBundle(source, localResources = {}) {
  const meta = parseMeta(source);
  if (!meta?.version) throw new Error('Unable to determine the script version');
  const assets = await fetchAssets(meta);
  return { ...assembleBundle(source, assets, localResources), assets };
}
