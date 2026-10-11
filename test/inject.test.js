import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import vm from 'node:vm';
import { createBundle, injectable } from '../src/userscript/bundle.js';

const all = ['GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_listValues'];
const meta = (grants = all) => ({ name: 'Test', namespace: 'https://example.com/', version: '1', grants });

function bridge(initial = {}) {
  const calls = [];
  const values = { ...initial };
  return {
    calls,
    api: Object.freeze({
      version: '9.9.9',
      getValues: (token) => ({ ...values[token] }),
      setValue: (token, key, raw) => calls.push(['set', token, key, raw]),
      deleteValue: (token, key) => calls.push(['delete', token, key]),
    }),
  };
}

function sandboxWith(api, extra = {}) {
  const sandbox = { JSON, document: { readyState: 'complete', addEventListener: () => {} }, underscriptApp: api, ...extra };
  sandbox.window = sandbox;
  return vm.createContext(sandbox);
}

function inject(api, script, token, grants) {
  const sandbox = sandboxWith(api);
  vm.runInContext(injectable(createBundle(meta(grants), script), token), sandbox);
  return sandbox;
}

describe('injectable', () => {
  it('routes the value functions to the token it was given', () => {
    const { api, calls } = bridge({ 'token-a': { count: '5' } });
    const sandbox = inject(api, 'GM_setValue("n", 1); window.out = GM_getValue("count");', 'token-a');
    assert.equal(sandbox.out, 5);
    assert.deepEqual(calls, [['set', 'token-a', 'n', '1']]);
  });

  it('ignores the script id baked into an older bundle', () => {
    const { api, calls } = bridge({ 'token-a': { v: '1' }, 'ns|Other': { v: '2' } });
    const oldStore = `function UnderScriptWrapper() {
const __GM_store = ((id) => {
  const api = typeof underscriptApp === 'object' ? underscriptApp : {};
  const map = new Map(Object.entries(api.getValues ? api.getValues(id) : {}));
  return { map, set: (key, raw) => { map.set(key, raw); api.setValue(id, key, raw); } };
})("ns|Other");
window.out = __GM_store.map.get('v');
__GM_store.set('k', '"x"');
}
UnderScriptWrapper();`;
    const sandbox = sandboxWith(api);
    vm.runInContext(injectable(oldStore, 'token-a'), sandbox);
    assert.equal(sandbox.out, '1');
    assert.deepEqual(calls, [['set', 'token-a', 'k', '"x"']]);
  });

  it('keeps two scripts on their own tokens', () => {
    const { api, calls } = bridge({ 'token-a': { who: '"a"' }, 'token-b': { who: '"b"' } });
    const sandbox = sandboxWith(api);
    ['token-a', 'token-b'].forEach((token) => {
      vm.runInContext(injectable(createBundle(meta(), 'window[`seen-${GM_getValue("who")}`] = true; GM_setValue("hit", 1);'), token), sandbox);
    });
    assert.equal(sandbox['seen-a'], true);
    assert.equal(sandbox['seen-b'], true);
    assert.deepEqual(calls, [['set', 'token-a', 'hit', '1'], ['set', 'token-b', 'hit', '1']]);
  });

  it('does not let a script reach other tokens through its bridge', () => {
    const { api, calls } = bridge({ 'token-a': { mine: '1' }, 'token-b': { secret: '2' } });
    const sandbox = sandboxWith(api);
    const script = 'window.read = JSON.stringify(underscriptApp.getValues("token-b")); underscriptApp.setValue("token-b", "k", "v");';
    vm.runInContext(injectable(createBundle(meta([]), script), 'token-a'), sandbox);
    assert.equal(sandbox.read, '{"mine":"1"}');
    assert.deepEqual(calls, [['set', 'token-a', 'k', 'v']]);
  });

  it('passes the rest of the bridge through', () => {
    const { api } = bridge();
    const sandbox = inject(api, 'window.version = underscriptApp.version;', 'token-a', []);
    assert.equal(sandbox.version, '9.9.9');
  });

  it('leaves nothing global that holds the script source', () => {
    const { api } = bridge();
    const sandbox = inject(api, '', 'token-a');
    assert.equal(typeof sandbox.UnderScriptWrapper, 'undefined');
    assert.equal(vm.runInContext('typeof UnderScriptWrapper', sandbox), 'undefined');
  });

  it('does not expose the token in the functions it hands out', () => {
    const { api } = bridge();
    const sandbox = inject(api, 'window.text = [underscriptApp.getValues, underscriptApp.setValue].join();', 'secret-token');
    assert.equal(sandbox.text.includes('secret-token'), false);
  });
});
