import { scriptId } from './gm.js';
import { describeChanges, sameMeta } from './installed.js';
import { parseMeta } from './meta.js';
import { findEntry } from './registry.js';

function hostsOf(targets) {
  const hosts = new Set();
  for (const { url } of targets) {
    try {
      hosts.add(new URL(url).host);
    } catch (e) {
      hosts.add(url);
    }
  }
  return [...hosts];
}

export function describeScript(meta, entry) {
  const pages = [...meta.matches, ...meta.includes];
  const permissions = meta.grants.filter((grant) => grant !== 'none');
  const code = hostsOf([...meta.requires, ...Object.values(meta.resources)]);
  return [
    `Source: ${entry.url}`,
    `Author: ${meta.author ?? entry.author ?? 'unknown'}`,
    `Runs on: ${pages.join(', ') || 'no pages'}`,
    `Permissions: ${permissions.join(', ') || 'none'}`,
    ...code.length ? [`Also loads code from: ${code.join(', ')}`] : [],
  ];
}

export function createInstaller({ loadRegistry, fetchScript, build, installed, confirm }) {
  const running = new Map();

  async function run(entry) {
    let source;
    let meta;
    try {
      source = await fetchScript(entry.url);
      meta = parseMeta(source);
    } catch (error) {
      return { status: 'failed', entry, error };
    }
    if (!meta) return { status: 'failed', entry, error: new Error('The download is not a user script') };
    if (!meta.name || !meta.version) return { status: 'failed', entry, error: new Error('The script has no name or version') };

    const existing = await installed.get(entry.url);
    const changed = existing && !sameMeta(existing.meta, meta);
    if (!existing || changed) {
      const approved = await confirm({
        kind: existing ? 'changed' : 'new',
        name: meta.name,
        version: meta.version,
        previousVersion: existing?.version,
        details: existing ? describeChanges(existing.meta, meta) : describeScript(meta, entry),
        entry,
      });
      if (!approved) return { status: 'cancelled', entry };
    }

    try {
      const built = await build(source);
      await installed.save({
        url: entry.url,
        name: meta.name,
        id: scriptId(meta),
        version: meta.version,
        meta: built.meta,
        bundle: built.bundle,
      });
    } catch (error) {
      return { status: 'failed', entry, error };
    }
    return { status: existing ? 'updated' : 'installed', entry, name: meta.name, version: meta.version, previousVersion: existing?.version };
  }

  return async function install(clicked) {
    let entry;
    try {
      entry = findEntry(await loadRegistry(), clicked);
    } catch (error) {
      return { status: 'failed', error };
    }
    if (!entry) return { status: 'rejected', url: clicked };
    if (!running.has(entry.url)) {
      running.set(entry.url, run(entry).finally(() => running.delete(entry.url)));
    }
    return running.get(entry.url);
  };
}
