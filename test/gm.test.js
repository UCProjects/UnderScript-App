import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import vm from 'node:vm';
import { createBundle } from '../src/userscript/bundle.js';
import { gmApi, storagePrefix } from '../src/userscript/gm.js';

class Storage {
  #map = new Map();
  get length() { return this.#map.size; }
  key(index) { return [...this.#map.keys()][index] ?? null; }
  getItem(key) { return this.#map.has(key) ? this.#map.get(key) : null; }
  setItem(key, value) { this.#map.set(key, String(value)); }
  removeItem(key) { this.#map.delete(key); }
}

function run(meta, script, localStorage = new Storage()) {
  const handlers = [];
  const sandbox = {
    localStorage,
    JSON,
    document: { addEventListener: (type, handler) => handlers.push(handler) },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(createBundle(meta, script), sandbox);
  handlers[0]();
  return { sandbox, localStorage };
}

const all = ['GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_listValues'];
const meta = (grants, extra = {}) => ({ name: 'Test', namespace: 'https://example.com/', version: '1', grants, ...extra });

describe('gmApi', () => {
  it('defines nothing without grants', () => {
    assert.deepEqual(gmApi({}), []);
    assert.deepEqual(gmApi(meta([])), []);
    assert.deepEqual(gmApi(meta(['none'])), []);
  });

  it('defines only the granted functions', () => {
    const { sandbox } = run(meta(['GM_getValue']), 'window.types = [typeof GM_getValue, typeof GM_setValue, typeof GM_deleteValue, typeof GM_listValues].join();');
    assert.equal(sandbox.types, 'function,undefined,undefined,undefined');
  });

  it('defines all four when all are granted', () => {
    const { sandbox } = run(meta(all), 'window.types = [typeof GM_getValue, typeof GM_setValue, typeof GM_deleteValue, typeof GM_listValues].join();');
    assert.equal(sandbox.types, 'function,function,function,function');
  });

  it('builds the storage prefix from the namespace and name', () => {
    assert.equal(storagePrefix({ namespace: 'https://example.com/', name: 'Test' }), 'GM:https://example.com/|Test:');
    assert.equal(storagePrefix({}), 'GM:|unnamed:');
  });
});

describe('GM_getValue and GM_setValue', () => {
  it('round trips json values', () => {
    const { sandbox } = run(meta(all), `
      GM_setValue('n', 5);
      GM_setValue('s', 'text');
      GM_setValue('b', false);
      GM_setValue('z', null);
      GM_setValue('o', { a: [1, 2, { b: 3 }] });
      window.out = JSON.stringify([GM_getValue('n'), GM_getValue('s'), GM_getValue('b'), GM_getValue('z'), GM_getValue('o')]);
    `);
    assert.equal(sandbox.out, '[5,"text",false,null,{"a":[1,2,{"b":3}]}]');
  });

  it('returns the fallback for missing keys, and undefined without one', () => {
    const { sandbox } = run(meta(all), 'window.out = JSON.stringify([GM_getValue("nope", "fallback"), GM_getValue("nope") === undefined, GM_getValue("nope", 0)]);');
    assert.equal(sandbox.out, '["fallback",true,0]');
  });

  it('returns the fallback when the stored value is not valid json', () => {
    const storage = new Storage();
    storage.setItem(`${storagePrefix(meta(all))}broken`, '{not json');
    const { sandbox } = run(meta(all), 'window.out = GM_getValue("broken", "fallback");', storage);
    assert.equal(sandbox.out, 'fallback');
  });

  it('removes a key when set to undefined', () => {
    const { sandbox } = run(meta(all), 'GM_setValue("k", 1); GM_setValue("k", undefined); window.out = [GM_getValue("k", "gone"), GM_listValues().length].join();');
    assert.equal(sandbox.out, 'gone,0');
  });

  it('keeps scripts apart by namespace and name', () => {
    const storage = new Storage();
    run(meta(all, { name: 'One' }), 'GM_setValue("shared", "one");', storage);
    run(meta(all, { name: 'Two' }), 'GM_setValue("shared", "two");', storage);
    run(meta(all, { name: 'One', namespace: 'https://other.example/' }), 'GM_setValue("shared", "three");', storage);
    const read = (m) => run(m, 'window.out = GM_getValue("shared");', storage).sandbox.out;
    assert.equal(read(meta(all, { name: 'One' })), 'one');
    assert.equal(read(meta(all, { name: 'Two' })), 'two');
    assert.equal(read(meta(all, { name: 'One', namespace: 'https://other.example/' })), 'three');
  });

  it('persists across runs with the same storage', () => {
    const storage = new Storage();
    run(meta(all), 'GM_setValue("count", 1);', storage);
    const { sandbox } = run(meta(all), 'window.out = GM_getValue("count");', storage);
    assert.equal(sandbox.out, 1);
  });

  it('survives a storage that throws', () => {
    const broken = {
      length: 0,
      key() { throw new Error('blocked'); },
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
      removeItem() { throw new Error('blocked'); },
    };
    const { sandbox } = run(meta(all), 'GM_setValue("a", 1); GM_deleteValue("a"); window.out = [GM_getValue("a", "fb"), GM_listValues().length].join();', broken);
    assert.equal(sandbox.out, 'fb,0');
  });
});

describe('GM_deleteValue and GM_listValues', () => {
  it('deletes only the named key', () => {
    const { sandbox } = run(meta(all), 'GM_setValue("a", 1); GM_setValue("b", 2); GM_deleteValue("a"); window.out = [GM_getValue("a", "x"), GM_getValue("b")].join();');
    assert.equal(sandbox.out, 'x,2');
  });

  it('lists only this scripts keys, without the prefix', () => {
    const storage = new Storage();
    storage.setItem('unrelated', '1');
    run(meta(all, { name: 'Other' }), 'GM_setValue("theirs", 1);', storage);
    const { sandbox } = run(meta(all), 'GM_setValue("a", 1); GM_setValue("b", 2); window.out = JSON.stringify(GM_listValues().sort());', storage);
    assert.equal(sandbox.out, '["a","b"]');
  });
});
