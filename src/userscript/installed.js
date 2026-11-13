import crypto from 'crypto';
import { promises as file } from 'fs';
import path from 'path';
import { bundleFormat, bundleInfo, runsOn } from './bundle.js';
import { iconLimit, imageType } from './icon.js';

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

export function changeList(before, after) {
  const a = comparable(before);
  const b = comparable(after);
  const changes = [];
  for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const was = a[key] ?? [];
    const now = b[key] ?? [];
    if (JSON.stringify(was) === JSON.stringify(now)) continue;
    const removed = was.filter((entry) => !now.includes(entry));
    const added = now.filter((entry) => !was.includes(entry));
    if (!removed.length && !added.length) {
      changes.push({ type: 'moved', key });
      continue;
    }
    changes.push(...removed.map((value) => ({ type: 'removed', key, value })));
    changes.push(...added.map((value) => ({ type: 'added', key, value })));
  }
  return changes;
}

const marks = { moved: '~', removed: '-', added: '+' };

export function describeChanges(before, after) {
  return changeList(before, after).map(({ type, key, value }) => {
    if (type === 'moved') return `~ @${key} (order changed)`;
    return `${marks[type]} @${key} ${value}`.trim();
  });
}

export function createInstalled(dir) {
  let queue = Promise.resolve();
  let loading;

  const folder = (url) => path.join(dir, crypto.createHash('sha256').update(url).digest('hex'));
  const strip = ({ bundle, ...record }) => record;
  const pick = ({ url, id, bundle }) => ({ url, id, bundle });
  const allowedIn = ({ bundle }, subframe) => !subframe || !bundleInfo(bundle)?.noframes;

  async function write(target, text) {
    await file.writeFile(`${target}.tmp`, text);
    await file.rename(`${target}.tmp`, target);
  }

  async function readRecords() {
    const records = [];
    let entries = [];
    try {
      entries = await file.readdir(dir, { withFileTypes: true });
    } catch (e) {
      entries = [];
    }
    for (const entry of entries.filter((item) => item.isDirectory())) {
      try {
        const base = path.join(dir, entry.name);
        const record = JSON.parse(await file.readFile(path.join(base, 'record.json'), 'utf8'));
        const bundle = await file.readFile(path.join(base, 'bundle.js'), 'utf8');
        if (typeof record?.url === 'string') records.push({ ...record, source: record.source ?? 'registry', bundle });
      } catch (e) {
        continue;
      }
    }
    return records.sort((x, y) => x.order - y.order);
  }

  function load() {
    loading ??= readRecords();
    return loading;
  }

  async function persist(record) {
    const base = folder(record.url);
    const { bundle, ...data } = record;
    await file.mkdir(base, { recursive: true });
    await write(path.join(base, 'bundle.js'), bundle);
    await write(path.join(base, 'record.json'), JSON.stringify(data, null, 2));
  }

  async function persistAssets(url, script, assets) {
    const base = folder(url);
    const target = path.join(base, 'assets');
    await file.rm(target, { recursive: true, force: true });
    await file.mkdir(target, { recursive: true });
    await write(path.join(base, 'script.user.js'), script);
    const requires = await Promise.all(assets.requires.map(async ({ url: from, integrity, code }, index) => {
      const name = `require-${index}.js`;
      await write(path.join(target, name), code);
      return { url: from, integrity, file: name };
    }));
    const resources = await Promise.all(Object.entries(assets.resources).map(async ([name, { url: from, integrity, code }], index) => {
      const fileName = `resource-${index}.txt`;
      await write(path.join(target, fileName), code);
      return { name, url: from, integrity, file: fileName };
    }));
    return { requires, resources };
  }

  function serialize(task) {
    const run = queue.catch(() => {}).then(task);
    queue = run;
    return run;
  }

  return {
    async list() {
      return (await load()).map(strip);
    },

    async get(url) {
      const found = (await load()).find((record) => record.url === url);
      return found && strip(found);
    },

    async iconOf(url) {
      if (!(await load()).some((entry) => entry.url === url)) return undefined;
      try {
        const data = await file.readFile(path.join(folder(url), 'icon.bin'));
        const type = data.length <= iconLimit ? imageType(data) : undefined;
        return type && `data:${type};base64,${data.toString('base64')}`;
      } catch (e) {
        return undefined;
      }
    },

    async stale(format = bundleFormat) {
      return (await load()).filter((record) => record.format !== format).map(strip);
    },

    async assetsOf(url) {
      const record = (await load()).find((entry) => entry.url === url);
      if (!record) return undefined;
      const base = folder(url);
      const read = (...parts) => file.readFile(path.join(base, ...parts), 'utf8');
      return {
        script: await read('script.user.js'),
        assets: {
          requires: await Promise.all((record.requires ?? []).map(async ({ url: from, integrity, file: name }) => ({
            url: from,
            integrity,
            code: await read('assets', name),
          }))),
          resources: Object.fromEntries(await Promise.all((record.resources ?? []).map(async ({ name, url: from, integrity, file: fileName }) => [name, {
            url: from,
            integrity,
            code: await read('assets', fileName),
          }]))),
        },
      };
    },

    save: ({ url, name, id, version, meta, bundle, script = '', assets = { requires: [], resources: {} }, format = bundleFormat, source = 'registry', pluginName = name, icon }) => serialize(async () => {
      const records = await load();
      const existing = records.find((record) => record.url === url);
      const now = new Date().toISOString();
      const manifest = await persistAssets(url, script, assets);
      if (icon) await write(path.join(folder(url), 'icon.bin'), icon.data);
      const record = {
        url,
        name,
        pluginName,
        id,
        source: existing ? existing.source : source,
        version,
        format,
        meta,
        bundle,
        ...manifest,
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

    rebuilt: (url, { bundle, meta, format = bundleFormat }) => serialize(async () => {
      const records = await load();
      const record = records.find((entry) => entry.url === url);
      if (!record) return false;
      Object.assign(record, { bundle, meta, format });
      await persist(record);
      return true;
    }),

    setEnabled: (url, enabled) => serialize(async () => {
      const records = await load();
      const record = records.find((entry) => entry.url === url);
      if (!record) return false;
      record.enabled = Boolean(enabled);
      await persist(record);
      return true;
    }),

    move: (url, step) => serialize(async () => {
      const records = await load();
      const from = records.findIndex((entry) => entry.url === url);
      const to = from + step;
      if (from < 0 || !Number.isInteger(step) || to < 0 || to >= records.length) return false;
      const [moved] = records.splice(from, 1);
      records.splice(to, 0, moved);
      const changed = [];
      records.forEach((record, index) => {
        if (record.order === index + 1) return;
        record.order = index + 1;
        changed.push(record);
      });
      await Promise.all(changed.map(persist));
      return true;
    }),

    remove: (url) => serialize(async () => {
      const records = await load();
      const index = records.findIndex((entry) => entry.url === url);
      if (index < 0) return false;
      records.splice(index, 1);
      await file.rm(folder(url), { recursive: true, force: true });
      return true;
    }),

    async reportable() {
      return (await load()).map((record) => ({ name: record.pluginName ?? record.name, version: record.version, enabled: record.enabled }));
    },

    async enabledBundles({ subframe = false } = {}) {
      return (await load()).filter((record) => record.enabled && allowedIn(record, subframe)).map(pick);
    },

    async bundlesFor(href, { subframe = false } = {}) {
      return (await load())
        .filter((record) => record.enabled && allowedIn(record, subframe) && runsOn(record.bundle, href))
        .map(pick);
    },
  };
}
