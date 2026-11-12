import { scriptId } from './gm.js';
import { changeList, sameMeta } from './installed.js';
import { parseMeta } from './meta.js';
import { describePermissions } from './permissions.js';
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

const gamePattern = /^(?:\*|https?):\/\/(?:\*\.?)?(?:www\.)?undercards\.net(?::\d+)?(?:\/|$)/i;

export function outsideGame(patterns) {
  return patterns.filter((pattern) => !gamePattern.test(pattern));
}

export function scriptInfo(meta, entry) {
  return {
    source: entry.url,
    author: meta.author ?? entry.author ?? 'unknown',
    pages: outsideGame([...meta.matches, ...meta.includes]),
    permissions: describePermissions(meta.grants),
    connects: meta.connects,
    code: hostsOf([...meta.requires, ...Object.values(meta.resources)]),
    noframes: meta.noframes,
  };
}

export function describeResult({ status, name, version, previousVersion, error }) {
  return {
    status,
    name,
    version,
    previousVersion,
    message: error ? String(error.message ?? error) : undefined,
  };
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
      const previous = existing ? await installed.assetsOf(entry.url).then((stored) => stored?.script || undefined, () => undefined) : undefined;
      const approved = await confirm({
        kind: existing ? 'changed' : 'new',
        name: meta.name,
        version: meta.version,
        previousVersion: existing?.version,
        info: scriptInfo(meta, entry),
        changes: existing ? changeList(existing.meta, meta) : [],
        script: source,
        previous,
      });
      if (!approved) return { status: 'cancelled', entry };
    }

    try {
      const built = await build(source);
      await installed.save({
        url: entry.url,
        name: meta.name,
        id: scriptId(meta),
        pluginName: entry.name,
        source: 'registry',
        version: meta.version,
        meta: built.meta,
        bundle: built.bundle,
        script: source,
        assets: built.assets,
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
