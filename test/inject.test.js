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

  describe('on the Cloudflare challenge page', () => {
    const run = (document, script = 'window.ran = true;') => {
      const sandbox = sandboxWith(bridge().api, { document });
      vm.runInContext(injectable(createBundle(meta([]), script), 'token-a'), sandbox);
      return sandbox;
    };

    it('runs nothing when the page is already parsed', () => {
      assert.equal(run({ readyState: 'complete', title: 'Just a moment...', addEventListener: () => {} }).ran, undefined);
      assert.equal(run({ readyState: 'interactive', title: 'Just a moment...', addEventListener: () => {} }).ran, undefined);
      assert.equal(run({ readyState: 'complete', title: 'Undercards', addEventListener: () => {} }).ran, true);
    });

    it('recognizes a translated challenge page by its challenge options, and leaves the sign-in widget alone', () => {
      const challenge = { cType: 'interactive', cZone: 'undercards.net', cRay: 'a599cb5159f23462' };
      const page = (title) => ({ readyState: 'complete', title, addEventListener: () => {} });
      const withOptions = (options) => {
        const sandbox = sandboxWith(bridge().api, { document: page('Un instant…'), _cf_chl_opt: options });
        vm.runInContext(injectable(createBundle(meta([]), 'window.ran = true;'), 'token-a'), sandbox);
        return sandbox.ran;
      };
      assert.equal(withOptions(challenge), undefined);
      assert.equal(withOptions({ _eae3266e70ccc7333b6cc927: 'a', _19bbce45b087e34314475c56: 'b' }), true);
      assert.equal(withOptions(undefined), true);
    });

    it('waits for the title before deciding while the page is still loading', () => {
      const listeners = [];
      const document = { readyState: 'loading', title: '', addEventListener: (type, listener) => listeners.push([type, listener]) };
      const sandbox = run(document);
      assert.equal(sandbox.ran, undefined);
      assert.deepEqual(listeners.map(([type]) => type), ['readystatechange']);
      document.readyState = 'interactive';
      document.title = 'Just a moment...';
      listeners[0][1]();
      assert.equal(sandbox.ran, undefined);

      const normal = { readyState: 'loading', title: '', addEventListener: (type, listener) => listeners.push([type, listener]) };
      const other = run(normal);
      normal.readyState = 'interactive';
      normal.title = 'Undercards';
      listeners.at(-1)[1]();
      assert.equal(other.ran, true);
    });
  });

  it('does not expose the token in the functions it hands out', () => {
    const { api } = bridge();
    const sandbox = inject(api, 'window.text = [underscriptApp.getValues, underscriptApp.setValue].join();', 'secret-token');
    assert.equal(sandbox.text.includes('secret-token'), false);
  });
});
