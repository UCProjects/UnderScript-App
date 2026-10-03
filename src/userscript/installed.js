import crypto from 'crypto';
import { promises as file } from 'fs';
import path from 'path';
import { runsOn } from './bundle.js';

function comparable(meta) {
  const values = {};
  for (const [key, list] of Object.entries(meta?.values ?? {})) {
    if (key !== 'version' && !key.startsWith('version:')) values[key] = list;
  }
  return values;
}

export function sameMeta(before, after) {
  const a = comparable(before);
  const b = comparable(after);
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length
    && keys.every((key) => Object.hasOwn(b, key) && JSON.stringify(a[key]) === JSON.stringify(b[key]));
}

export function describeChanges(before, after) {
  const a = comparable(before);
  const b = comparable(after);
  const lines = [];
  for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const was = a[key] ?? [];
    const now = b[key] ?? [];
    if (JSON.stringify(was) === JSON.stringify(now)) continue;
    const removed = was.filter((entry) => !now.includes(entry));
    const added = now.filter((entry) => !was.includes(entry));
    if (!removed.length && !added.length) {
      lines.push(`~ @${key} (order changed)`);
      continue;
    }
    lines.push(...removed.map((value) => `- @${key} ${value}`.trim()));
    lines.push(...added.map((value) => `+ @${key} ${value}`.trim()));
  }
  return lines;
}

export function createInstalled(dir) {
  let queue = Promise.resolve();
  let cache;

  function stem(url) {
    return path.join(dir, crypto.createHash('sha256').update(url).digest('hex'));
  }

  async function load() {
    if (cache) return cache;
    const records = [];
    let names = [];
    try {
      names = await file.readdir(dir);
    } catch (e) {
      names = [];
    }
    for (const name of names.filter((entry) => entry.endsWith('.json'))) {
      try {
        const record = JSON.parse(await file.readFile(path.join(dir, name), 'utf8'));
        const bundle = await file.readFile(path.join(dir, name.replace(/\.json$/, '.js')), 'utf8');
        if (typeof record?.url === 'string') records.push({ ...record, bundle });
      } catch (e) {
        continue;
      }
    }
    cache = records.sort((x, y) => x.order - y.order);
    return cache;
  }

  async function persist(record) {
    const base = stem(record.url);
    const { bundle, ...data } = record;
    await file.mkdir(dir, { recursive: true });
    await file.writeFile(`${base}.js.tmp`, bundle);
    await file.rename(`${base}.js.tmp`, `${base}.js`);
    await file.writeFile(`${base}.json.tmp`, JSON.stringify(data, null, 2));
    await file.rename(`${base}.json.tmp`, `${base}.json`);
  }

  function serialize(task) {
    const run = queue.catch(() => {}).then(task);
    queue = run;
    return run;
  }

  const strip = ({ bundle, ...record }) => record;

  return {
    async list() {
      return (await load()).map(strip);
    },

    async get(url) {
      const found = (await load()).find((record) => record.url === url);
      return found && strip(found);
    },

    save: ({ url, name, id, version, meta, bundle }) => serialize(async () => {
      const records = await load();
      const existing = records.find((record) => record.url === url);
      const now = new Date().toISOString();
      const record = {
        url,
        name,
        id,
        version,
        meta,
        bundle,
        enabled: existing ? existing.enabled : true,
        installedAt: existing ? existing.installedAt : now,
        updatedAt: now,
        order: existing ? existing.order : Math.max(0, ...records.map((entry) => entry.order)) + 1,
      };
      await persist(record);
      if (existing) records[records.indexOf(existing)] = record;
      else records.push(record);
      return strip(record);
    }),

    setEnabled: (url, enabled) => serialize(async () => {
      const records = await load();
      const record = records.find((entry) => entry.url === url);
      if (!record) return false;
      record.enabled = Boolean(enabled);
      await persist(record);
      return true;
    }),

    remove: (url) => serialize(async () => {
      const records = await load();
      const index = records.findIndex((entry) => entry.url === url);
      if (index < 0) return false;
      records.splice(index, 1);
      const base = stem(url);
      await Promise.all([`${base}.js`, `${base}.json`].map((target) => file.rm(target, { force: true })));
      return true;
    }),

    async bundlesFor(href) {
      return (await load())
        .filter((record) => record.enabled && runsOn(record.bundle, href))
        .map(({ url, id, bundle }) => ({ url, id, bundle }));
    },
  };
}
