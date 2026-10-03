import assert from 'node:assert/strict';
import { promises as file } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createStore, limits } from '../src/userscript/store.js';

let dir;
let store;

beforeEach(async () => {
  dir = await file.mkdtemp(path.join(os.tmpdir(), 'gm-store-'));
  store = createStore(dir);
});

afterEach(() => file.rm(dir, { recursive: true, force: true }));

describe('createStore', () => {
  it('returns nothing for an unknown script', async () => {
    assert.deepEqual(await store.get('unknown'), {});
  });

  it('stores values as raw json strings per script', async () => {
    await store.set('a|One', 'count', '5');
    await store.set('a|One', 'object', '{"x":[1,2]}');
    await store.set('a|Two', 'count', '"other"');
    assert.deepEqual(await store.get('a|One'), { count: '5', object: '{"x":[1,2]}' });
    assert.deepEqual(await store.get('a|Two'), { count: '"other"' });
  });

  it('persists to disk and survives a new store', async () => {
    await store.set('a|One', 'k', '{"deep":{"v":true}}');
    assert.deepEqual(await createStore(dir).get('a|One'), { k: '{"deep":{"v":true}}' });
  });

  it('writes readable json files named by a hash, never by the script id', async () => {
    await store.set('../evil|name', 'k', '1');
    const files = await file.readdir(dir);
    assert.equal(files.length, 1);
    assert.match(files[0], /^[0-9a-f]{64}\.json$/);
    const data = JSON.parse(await file.readFile(path.join(dir, files[0]), 'utf8'));
    assert.deepEqual(data, { id: '../evil|name', values: { k: 1 } });
  });

  it('overwrites and removes keys', async () => {
    await store.set('a|One', 'k', '1');
    await store.set('a|One', 'k', '2');
    await store.set('a|One', 'gone', '3');
    await store.remove('a|One', 'gone');
    await store.remove('a|One', 'never-existed');
    assert.deepEqual(await store.get('a|One'), { k: '2' });
  });

  it('applies concurrent writes in order without losing any', async () => {
    await Promise.all(Array.from({ length: 25 }, (_, i) => store.set('a|One', `k${i}`, String(i))));
    await Promise.all([store.set('a|One', 'last', '1'), store.set('a|One', 'last', '2')]);
    const values = await store.get('a|One');
    assert.equal(Object.keys(values).length, 26);
    assert.equal(values.last, '2');
  });

  it('treats a corrupt file as empty and recovers on the next write', async () => {
    await store.set('a|One', 'k', '1');
    const [name] = await file.readdir(dir);
    await file.writeFile(path.join(dir, name), '{not json');
    const fresh = createStore(dir);
    assert.deepEqual(await fresh.get('a|One'), {});
    await fresh.set('a|One', 'again', '2');
    assert.deepEqual(await createStore(dir).get('a|One'), { again: '2' });
  });

  it('coalesces bursts of writes into a few file writes', async () => {
    const original = file.writeFile;
    let writes = 0;
    file.writeFile = async (...args) => { writes++; return original.apply(file, args); };
    try {
      await Promise.all(Array.from({ length: 200 }, (_, i) => store.set('a|One', `k${i}`, String(i))));
    } finally {
      file.writeFile = original;
    }
    assert.ok(writes <= 3, `expected at most 3 writes, got ${writes}`);
    assert.equal(Object.keys(await createStore(dir).get('a|One')).length, 200);
  });

  it('keeps rejected values out of memory and off disk', async () => {
    await store.set('a|One', 'ok', '1');
    await assert.rejects(store.set('a|One', 'k'.repeat(limits.key + 1), '1'), /Invalid key/);
    assert.deepEqual(await store.get('a|One'), { ok: '1' });
  });

  it('leaves no temporary files behind', async () => {
    await store.set('a|One', 'k', '1');
    assert.deepEqual((await file.readdir(dir)).filter((name) => name.endsWith('.tmp')), []);
  });

  describe('validation', () => {
    it('rejects invalid ids, keys and values', async () => {
      await assert.rejects(async () => store.set('', 'k', '1'), /Invalid script id/);
      await assert.rejects(async () => store.set(5, 'k', '1'), /Invalid script id/);
      await assert.rejects(async () => store.set('x'.repeat(limits.id + 1), 'k', '1'), /Invalid script id/);
      await assert.rejects(async () => store.set('a', '', '1'), /Invalid key/);
      await assert.rejects(async () => store.set('a', 'k'.repeat(limits.key + 1), '1'), /Invalid key/);
      await assert.rejects(async () => store.set('a', 'k', 5), /Invalid value/);
      await assert.rejects(async () => store.set('a', 'k', 'x'.repeat(limits.value + 1)), /Invalid value/);
      await assert.rejects(async () => store.set('a', 'k', '{not json'));
      assert.deepEqual(await file.readdir(dir), []);
    });

    it('limits how many values a script can store', async () => {
      const big = createStore(dir);
      await Promise.all(Array.from({ length: limits.keys }, (_, i) => big.set('a|One', `k${i}`, '1')));
      await assert.rejects(big.set('a|One', 'one-too-many', '1'), /Too many values/);
      assert.equal(Object.keys(await big.get('a|One')).length, limits.keys);
    });

    it('limits the total size', async () => {
      const chunk = JSON.stringify('x'.repeat(limits.value - 2));
      for (let i = 0; i < 9; i++) await store.set('a|One', `k${i}`, chunk);
      await assert.rejects(async () => {
        await store.set('a|One', 'k9', chunk);
        await store.set('a|One', 'k10', chunk);
      }, /too large/);
    });
  });
});

describe('flush', () => {
  it('resolves once pending writes are on disk', async () => {
    const pending = store.set('a|One', 'k', '1');
    await store.flush();
    assert.deepEqual(await createStore(dir).get('a|One'), { k: '1' });
    await pending;
  });

  it('resolves immediately when nothing is pending', async () => {
    await store.flush();
    await store.get('a|One');
    await store.flush();
  });
});
