import crypto from 'crypto';
import { promises as file } from 'fs';
import path from 'path';

export const limits = {
  id: 300,
  key: 256,
  value: 1024 * 1024,
  keys: 1000,
  total: 10 * 1024 * 1024,
};

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function size(values) {
  return Object.entries(values).reduce((sum, [key, raw]) => sum + key.length + raw.length, 0);
}

export function createStore(dir) {
  const states = new Map();
  const pending = new Set();

  function track(promise) {
    pending.add(promise);
    const done = () => pending.delete(promise);
    promise.then(done, done);
    return promise;
  }

  function locate(id) {
    return path.join(dir, `${crypto.createHash('sha256').update(id).digest('hex')}.json`);
  }

  async function read(id) {
    try {
      const { values } = JSON.parse(await file.readFile(locate(id), 'utf8'));
      return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, JSON.stringify(value)]));
    } catch (e) {
      return {};
    }
  }

  async function write(id, values) {
    const target = locate(id);
    const temp = `${target}.tmp`;
    const data = { id, values: Object.fromEntries(Object.entries(values).map(([key, raw]) => [key, JSON.parse(raw)])) };
    await file.mkdir(dir, { recursive: true });
    await file.writeFile(temp, JSON.stringify(data, null, 2));
    await file.rename(temp, target);
  }

  function state(id) {
    if (!states.has(id)) states.set(id, { ready: read(id), running: null, dirty: false });
    return states.get(id);
  }

  function flush(id, current, values) {
    current.dirty = true;
    if (!current.running) {
      current.running = (async () => {
        try {
          while (current.dirty) {
            current.dirty = false;
            await write(id, values);
          }
        } finally {
          current.running = null;
        }
      })();
    }
    return current.running;
  }

  async function put(id, key, raw) {
    check(typeof id === 'string' && id && id.length <= limits.id, 'Invalid script id');
    check(typeof key === 'string' && key && key.length <= limits.key, 'Invalid key');
    check(typeof raw === 'string' && raw.length <= limits.value, 'Invalid value');
    JSON.parse(raw);
    const current = state(id);
    const values = await current.ready;
    const previous = values[key];
    values[key] = raw;
    try {
      check(Object.keys(values).length <= limits.keys, 'Too many values');
      check(size(values) <= limits.total, 'Values are too large');
    } catch (e) {
      if (previous === undefined) delete values[key];
      else values[key] = previous;
      throw e;
    }
    await flush(id, current, values);
  }

  async function erase(id, key) {
    check(typeof id === 'string' && id && id.length <= limits.id, 'Invalid script id');
    check(typeof key === 'string' && key, 'Invalid key');
    const current = state(id);
    const values = await current.ready;
    if (!(key in values)) return;
    delete values[key];
    await flush(id, current, values);
  }

  return {
    async get(id) {
      return { ...await state(id).ready };
    },
    set: (id, key, raw) => track(put(id, key, raw)),
    remove: (id, key) => track(erase(id, key)),
    flush: () => Promise.allSettled([...pending]),
  };
}
