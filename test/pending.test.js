import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import vm from 'node:vm';
import { pendingPrefix, pruneScript } from '../src/userscript/pending.js';

function storage(entries = {}) {
  const map = new Map(Object.entries(entries).map(([name, value]) => [`${pendingPrefix}${name}`, typeof value === 'string' ? value : JSON.stringify(value)]));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    removeItem: (key) => map.delete(key),
  };
}

function run(plugins, entries) {
  const localStorage = storage(entries);
  const script = pruneScript(plugins);
  if (script) vm.runInNewContext(script, { localStorage, JSON });
  return [...localStorage.map.keys()].map((key) => key.slice(pendingPrefix.length)).sort();
}

describe('pruneScript', () => {
  it('writes nothing when no plugin is turned off', () => {
    assert.equal(pruneScript([]), '');
    assert.equal(pruneScript([{ name: 'A', version: '1', enabled: true }]), '');
  });

  it('clears the pending update of a turned off plugin that is now on the new version', () => {
    const plugins = [{ name: 'Alpha', version: '1.0.0', enabled: false }];
    assert.deepEqual(run(plugins, { Alpha: { version: '0.9.0', newVersion: '1.0.0' } }), []);
  });

  it('clears a pending update recorded for another version than the installed one', () => {
    const plugins = [{ name: 'Alpha', version: '3.0.0', enabled: false }];
    assert.deepEqual(run(plugins, { Alpha: { version: '1.0.0', newVersion: '2.0.0' } }), []);
  });

  it('clears one that has no recorded version when it matches the new version', () => {
    const plugins = [{ name: 'Alpha', version: '2.0.0', enabled: false }];
    assert.deepEqual(run(plugins, { Alpha: { newVersion: '2.0.0' } }), []);
  });

  it('keeps an update that is still pending', () => {
    const plugins = [{ name: 'Beta', version: '1.0.0', enabled: false }];
    assert.deepEqual(run(plugins, { Beta: { version: '1.0.0', newVersion: '2.0.0' } }), ['Beta']);
    assert.deepEqual(run(plugins, { Beta: { newVersion: '2.0.0' } }), ['Beta']);
  });

  it('leaves enabled plugins, other plugins and unreadable entries alone', () => {
    const plugins = [
      { name: 'Alpha', version: '1.0.0', enabled: false },
      { name: 'Gamma', version: '1.0.0', enabled: true },
      { name: 'Broken', version: '1.0.0', enabled: false },
      { name: 'Null', version: '1.0.0', enabled: false },
    ];
    const kept = run(plugins, {
      Alpha: { version: '0.9.0', newVersion: '1.0.0' },
      Gamma: { version: '0.9.0', newVersion: '1.0.0' },
      Delta: { version: '0.9.0', newVersion: '1.0.0' },
      Broken: '{not json',
      Null: 'null',
    });
    assert.deepEqual(kept, ['Broken', 'Delta', 'Gamma', 'Null']);
  });

  it('copes with names and versions that need escaping', () => {
    const name = 'It\'s "odd" \\ name';
    const plugins = [{ name, version: '1.0.0', enabled: false }];
    assert.deepEqual(run(plugins, { [name]: { version: '0.9.0', newVersion: '1.0.0' } }), []);
  });
});
