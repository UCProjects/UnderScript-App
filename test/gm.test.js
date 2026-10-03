import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import vm from 'node:vm';
import { createBundle } from '../src/userscript/bundle.js';
import { gmApi, scriptId } from '../src/userscript/gm.js';

function fakeApp(initial = {}) {
  const calls = [];
  const values = { ...initial };
  return {
    calls,
    api: {
      getValues: (id) => ({ ...values[id] }),
      setValue: (id, key, raw) => calls.push(['set', id, key, raw]),
      deleteValue: (id, key) => calls.push(['delete', id, key]),
    },
  };
}

function run(meta, script, api) {
  const handlers = [];
  const sandbox = {
    JSON,
    document: { addEventListener: (type, handler) => handlers.push(handler) },
  };
  if (api) sandbox.underscriptApp = api;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(createBundle(meta, script), sandbox);
  handlers[0]();
  return sandbox;
}

const all = ['GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_listValues'];
const meta = (grants, extra = {}) => ({ name: 'Test', namespace: 'https://example.com/', version: '1', grants, ...extra });
const id = scriptId(meta(all));

describe('gmApi', () => {
  it('defines nothing without grants', () => {
    assert.deepEqual(gmApi({}), []);
    assert.deepEqual(gmApi(meta([])), []);
    assert.deepEqual(gmApi(meta(['none'])), []);
    assert.deepEqual(gmApi(meta(['unsafeWindow', 'GM_getResourceText'])), []);
  });

  it('defines only the granted functions', () => {
    const { api } = fakeApp();
    const sandbox = run(meta(['GM_getValue']), 'window.types = [typeof GM_getValue, typeof GM_setValue, typeof GM_deleteValue, typeof GM_listValues].join();', api);
    assert.equal(sandbox.types, 'function,undefined,undefined,undefined');
  });

  it('defines all four when all are granted', () => {
    const { api } = fakeApp();
    const sandbox = run(meta(all), 'window.types = [typeof GM_getValue, typeof GM_setValue, typeof GM_deleteValue, typeof GM_listValues].join();', api);
    assert.equal(sandbox.types, 'function,function,function,function');
  });

  it('identifies a script by its namespace and name', () => {
    assert.equal(scriptId({ namespace: 'https://example.com/', name: 'Test' }), 'https://example.com/|Test');
    assert.equal(scriptId({}), '|unnamed');
    assert.equal(scriptId(), '|unnamed');
  });
});

describe('GM_getValue and GM_setValue', () => {
  it('starts from the stored snapshot for its own script', () => {
    const { api } = fakeApp({ [id]: { count: '5', name: '"stored"' }, 'other|Script': { count: '99' } });
    const sandbox = run(meta(all), 'window.out = JSON.stringify([GM_getValue("count"), GM_getValue("name"), GM_listValues().sort()]);', api);
    assert.equal(sandbox.out, '[5,"stored",["count","name"]]');
  });

  it('round trips json values and sends the raw json to be saved', () => {
    const { api, calls } = fakeApp();
    const sandbox = run(meta(all), `
      GM_setValue('n', 5);
      GM_setValue('s', 'text');
      GM_setValue('b', false);
      GM_setValue('z', null);
      GM_setValue('o', { a: [1, 2, { b: 3 }] });
      window.out = JSON.stringify([GM_getValue('n'), GM_getValue('s'), GM_getValue('b'), GM_getValue('z'), GM_getValue('o')]);
    `, api);
    assert.equal(sandbox.out, '[5,"text",false,null,{"a":[1,2,{"b":3}]}]');
    assert.deepEqual(calls, [
      ['set', id, 'n', '5'],
      ['set', id, 's', '"text"'],
      ['set', id, 'b', 'false'],
      ['set', id, 'z', 'null'],
      ['set', id, 'o', '{"a":[1,2,{"b":3}]}'],
    ]);
  });

  it('returns the fallback for missing keys, and undefined without one', () => {
    const { api } = fakeApp();
    const sandbox = run(meta(all), 'window.out = JSON.stringify([GM_getValue("nope", "fallback"), GM_getValue("nope") === undefined, GM_getValue("nope", 0)]);', api);
    assert.equal(sandbox.out, '["fallback",true,0]');
  });

  it('returns the fallback when a stored value is not valid json', () => {
    const { api } = fakeApp({ [id]: { broken: '{not json' } });
    const sandbox = run(meta(all), 'window.out = GM_getValue("broken", "fallback");', api);
    assert.equal(sandbox.out, 'fallback');
  });

  it('hands out copies, so changing a result does not change the stored value', () => {
    const { api } = fakeApp({ [id]: { o: '{"a":1}' } });
    const sandbox = run(meta(all), 'const first = GM_getValue("o"); first.a = 2; window.out = GM_getValue("o").a;', api);
    assert.equal(sandbox.out, 1);
  });

  it('removes a key when set to undefined', () => {
    const { api, calls } = fakeApp({ [id]: { k: '1' } });
    const sandbox = run(meta(all), 'GM_setValue("k", undefined); window.out = [GM_getValue("k", "gone"), GM_listValues().length].join();', api);
    assert.equal(sandbox.out, 'gone,0');
    assert.deepEqual(calls, [['delete', id, 'k']]);
  });

  it('turns keys into strings', () => {
    const { api, calls } = fakeApp();
    const sandbox = run(meta(all), 'GM_setValue(1, "one"); window.out = [GM_getValue("1"), GM_getValue(1), GM_listValues()[0] === "1"].join();', api);
    assert.equal(sandbox.out, 'one,one,true');
    assert.deepEqual(calls, [['set', id, '1', '"one"']]);
  });

  it('lets errors from unserializable values reach the script', () => {
    const { api } = fakeApp();
    const sandbox = run(meta(all), 'const a = {}; a.self = a; try { GM_setValue("loop", a); window.out = "no error"; } catch (e) { window.out = e.name; }', api);
    assert.equal(sandbox.out, 'TypeError');
  });

  it('keeps working in memory when the bridge is missing', () => {
    const sandbox = run(meta(all), 'GM_setValue("k", 1); window.out = GM_getValue("k");');
    assert.equal(sandbox.out, 1);
  });
});

describe('GM_deleteValue and GM_listValues', () => {
  it('deletes only the named key and saves the deletion', () => {
    const { api, calls } = fakeApp();
    const sandbox = run(meta(all), 'GM_setValue("a", 1); GM_setValue("b", 2); GM_deleteValue("a"); window.out = [GM_getValue("a", "x"), GM_getValue("b")].join();', api);
    assert.equal(sandbox.out, 'x,2');
    assert.deepEqual(calls.at(-1), ['delete', id, 'a']);
  });

  it('lists keys including ones set this run', () => {
    const { api } = fakeApp({ [id]: { old: '1' } });
    const sandbox = run(meta(all), 'GM_setValue("fresh", 2); window.out = JSON.stringify(GM_listValues().sort());', api);
    assert.equal(sandbox.out, '["fresh","old"]');
  });
});
