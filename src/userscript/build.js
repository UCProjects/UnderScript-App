import { createBundle } from './bundle.js';
import { cachedDownload } from './download.js';
import { parseMeta } from './meta.js';

export async function buildBundle(source, localResources = {}) {
  const meta = parseMeta(source);
  if (!meta?.version) throw new Error('Unable to determine the script version');
  const requires = await Promise.all(meta.requires.map(cachedDownload));
  const resources = Object.fromEntries(await Promise.all(
    Object.entries(meta.resources).map(async ([name, target]) => [name, await cachedDownload(target)]),
  ));
  return { meta, bundle: createBundle(meta, source, { requires, resources, localResources }) };
}
