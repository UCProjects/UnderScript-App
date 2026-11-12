import assert from 'node:assert/strict';
import { promises as file } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createInstalled } from '../src/userscript/installed.js';
import { createBundle } from '../src/userscript/bundle.js';
import { createInstaller, describeResult, outsideGame, scriptInfo } from '../src/userscript/install.js';
import { parseMeta } from '../src/userscript/meta.js';

const RELEASE = 'https://github.com/elytrafae/prettycards/releases/latest/download/prettycards.user.js';
const RAW = 'https://raw.githubusercontent.com/theWiza2341/Wizascript/refs/heads/main/wizascript.user.js';
const registry = [
  { name: 'PrettyCards', author: 'elytrafae', url: RELEASE },
  { name: 'Wizascript', author: 'TheWiza2341', url: RAW },
];

function source(extra = [], version = '1.0.0', name = 'Test Plugin') {
  return [
    '// ==UserScript==',
    `// @name ${name}`,
    '// @namespace https://example.com/',
    `// @version ${version}`,
    '// @match https://undercards.net/*',
    '// @grant GM_getValue',
    ...extra,
    '// ==/UserScript==',
    'window.plugin = 1;',
  ].join('\n');
}

let dir;
let installed;
let calls;
let scripts;
let answer;
let installer;

beforeEach(async () => {
  dir = await file.mkdtemp(path.join(os.tmpdir(), 'install-'));
  installed = createInstalled(dir);
  calls = { fetch: [], confirm: [], build: [] };
  scripts = new Map([[RELEASE, source()], [RAW, source([], '1.0.0', 'Wiza')]]);
  answer = true;
  installer = createInstaller({
    loadRegistry: async () => registry,
    fetchScript: async (url) => {
      calls.fetch.push(url);
      if (!scripts.has(url)) throw new Error('Unable to download');
      return scripts.get(url);
    },
    build: async (text) => {
      calls.build.push(text);
      const meta = parseMeta(text);
      return { meta, bundle: createBundle(meta, text) };
    },
    installed,
    confirm: async (request) => {
      calls.confirm.push(request);
      return answer;
    },
  });
});

afterEach(() => file.rm(dir, { recursive: true, force: true }));

describe('scriptInfo', () => {
  it('summarizes what the script will do', () => {
    const meta = parseMeta(source(['// @author someone', '// @connect api.example.com', '// @require https://unpkg.com/a.js', '// @require https://unpkg.com/b.js', '// @resource r https://cdn.example/r.json']));
    assert.deepEqual(scriptInfo(meta, registry[0]), {
      source: RELEASE,
      author: 'someone',
      pages: [],
      permissions: [{ text: 'Save and read its own data', names: ['GM_getValue'] }],
      connects: ['api.example.com'],
      code: ['unpkg.com', 'cdn.example'],
      noframes: false,
    });
  });

  it('falls back to the registry author and lists no permissions for none', () => {
    const meta = parseMeta(source().replace('// @grant GM_getValue', '// @grant none'));
    const info = scriptInfo(meta, registry[0]);
    assert.equal(info.author, 'elytrafae');
    assert.deepEqual(info.permissions, []);
    assert.deepEqual(info.code, []);
  });
});

describe('outsideGame', () => {
  it('drops patterns that only point at the game', () => {
    assert.deepEqual(outsideGame([
      'https://undercards.net/*',
      'https://*.undercards.net/*',
      '*://*.undercards.net/Game*',
      'https://www.undercards.net/*',
      'https://*undercards.net/*/*',
      'http://undercards.net',
    ]), []);
  });

  it('keeps patterns for other sites, including look-alikes', () => {
    const others = [
      'https://undercard.feildmaster.com/*',
      'https://sernon158.github.io/uc-editor/*',
      'https://undercards.net.evil.example/*',
      'https://notundercards.net/*',
      '/undercards\.net/',
      '*',
    ];
    assert.deepEqual(outsideGame(others), others);
  });
});

describe('describeResult', () => {
  it('keeps the plain fields and turns an error into its message', () => {
    assert.deepEqual(describeResult({ status: 'updated', name: 'A', version: '2', previousVersion: '1', entry: { url: 'x' } }), {
      status: 'updated',
      name: 'A',
      version: '2',
      previousVersion: '1',
      message: undefined,
    });
    assert.equal(describeResult({ status: 'failed', error: new Error('boom') }).message, 'boom');
    assert.equal(describeResult({ status: 'failed', error: 'text' }).message, 'text');
  });
});

describe('install icons', () => {
  const png = { type: 'image/png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2]) };

  function withIcons(fetchIcon) {
    const asked = [];
    const build = async (text) => {
      const meta = parseMeta(text);
      return { meta, bundle: createBundle(meta, text) };
    };
    return {
      asked,
      install: createInstaller({
        loadRegistry: async () => registry,
        fetchScript: async () => source(['// @icon https://example.com/icon.png']),
        build,
        installed,
        confirm: async () => true,
        fetchIcon: async (url) => {
          asked.push(url);
          return fetchIcon(url);
        },
      }),
    };
  }

  it('fetches the icon the script names after it is approved and keeps it with the plugin', async () => {
    const { install, asked } = withIcons(async () => png);
    assert.equal((await install(RELEASE)).status, 'installed');
    assert.deepEqual(asked, ['https://example.com/icon.png']);
    assert.equal(await installed.iconOf(RELEASE), `data:image/png;base64,${png.data.toString('base64')}`);
  });

  it('installs the plugin without an icon when the icon cannot be fetched', async () => {
    for (const fetchIcon of [async () => undefined, async () => { throw new Error('offline'); }]) {
      await installed.remove(RELEASE);
      const { install } = withIcons(fetchIcon);
      assert.equal((await install(RELEASE)).status, 'installed');
      assert.equal(await installed.iconOf(RELEASE), undefined);
    }
  });

  it('does not ask for an icon when the script names none or the install is declined', async () => {
    const noIcon = createInstaller({
      loadRegistry: async () => registry,
      fetchScript: async () => source(),
      build: async (text) => ({ meta: parseMeta(text), bundle: 'b' }),
      installed,
      confirm: async () => true,
      fetchIcon: async () => { throw new Error('should not be called'); },
    });
    assert.equal((await noIcon(RELEASE)).status, 'installed');
    await installed.remove(RELEASE);
    const declined = createInstaller({
      loadRegistry: async () => registry,
      fetchScript: async () => source(['// @icon https://example.com/icon.png']),
      build: async (text) => ({ meta: parseMeta(text), bundle: 'b' }),
      installed,
      confirm: async () => false,
      fetchIcon: async () => { throw new Error('should not be called'); },
    });
    assert.equal((await declined(RELEASE)).status, 'cancelled');
  });
});

describe('install', () => {
  it('refuses links the registry does not list, without downloading', async () => {
    const result = await installer('https://evil.example/prettycards.user.js');
    assert.equal(result.status, 'rejected');
    assert.deepEqual(calls.fetch, []);
    assert.deepEqual(calls.confirm, []);
    assert.deepEqual(await installed.list(), []);
  });

  it('downloads from the registry url, not from the clicked link', async () => {
    const tagged = 'https://github.com/elytrafae/prettycards/releases/download/v1.0.0/prettycards.user.js';
    const result = await installer(tagged);
    assert.equal(result.status, 'installed');
    assert.deepEqual(calls.fetch, [RELEASE]);
    assert.equal((await installed.list())[0].url, RELEASE);
  });

  it('asks before installing a new script, and installs it when approved', async () => {
    const result = await installer(RELEASE);
    assert.equal(result.status, 'installed');
    assert.equal(result.name, 'PrettyCards');
    assert.equal(calls.confirm.length, 1);
    const [request] = calls.confirm;
    assert.equal(request.kind, 'new');
    assert.equal(request.name, 'PrettyCards');
    assert.equal(request.version, '1.0.0');
    assert.deepEqual(request.info.permissions, [{ text: 'Save and read its own data', names: ['GM_getValue'] }]);
    assert.deepEqual(request.changes, []);
    assert.equal(request.script, source());
    assert.equal(request.previous, undefined);
    const [record] = await installed.list();
    assert.equal(record.name, 'Test Plugin');
    assert.equal(record.id, 'https://example.com/|Test Plugin');
    assert.equal(record.enabled, true);
    assert.equal(record.pluginName, 'PrettyCards');
  });

  it('installs nothing when declined', async () => {
    answer = false;
    const result = await installer(RELEASE);
    assert.equal(result.status, 'cancelled');
    assert.deepEqual(calls.build, []);
    assert.deepEqual(await installed.list(), []);
  });

  it('updates silently when only the version changed', async () => {
    await installer(RELEASE);
    calls.confirm.length = 0;
    scripts.set(RELEASE, source([], '2.0.0'));
    const result = await installer(RELEASE);
    assert.equal(result.status, 'updated');
    assert.equal(result.previousVersion, '1.0.0');
    assert.deepEqual(calls.confirm, []);
    assert.equal((await installed.get(RELEASE)).version, '2.0.0');
  });

  it('reinstalls silently when nothing changed', async () => {
    await installer(RELEASE);
    calls.confirm.length = 0;
    assert.equal((await installer(RELEASE)).status, 'updated');
    assert.deepEqual(calls.confirm, []);
  });

  it('asks again when anything besides the version changed, listing the changes', async () => {
    await installer(RELEASE);
    calls.confirm.length = 0;
    scripts.set(RELEASE, source(['// @grant GM_xmlhttpRequest', '// @connect evil.example'], '2.0.0'));
    const result = await installer(RELEASE);
    assert.equal(result.status, 'updated');
    assert.equal(result.name, 'PrettyCards');
    const [request] = calls.confirm;
    assert.equal(request.kind, 'changed');
    assert.equal(request.previousVersion, '1.0.0');
    assert.deepEqual(request.changes, [
      { type: 'added', key: 'connect', value: 'evil.example' },
      { type: 'added', key: 'grant', value: 'GM_xmlhttpRequest' },
    ]);
    assert.deepEqual(request.info.connects, ['evil.example']);
    assert.equal(request.previous, source());
    assert.equal(request.script, source(['// @grant GM_xmlhttpRequest', '// @connect evil.example'], '2.0.0'));
    assert.equal((await installed.get(RELEASE)).version, '2.0.0');
  });

  it('keeps the installed version when a changed update is declined', async () => {
    await installer(RELEASE);
    scripts.set(RELEASE, source(['// @grant GM_xmlhttpRequest'], '2.0.0'));
    answer = false;
    assert.equal((await installer(RELEASE)).status, 'cancelled');
    assert.equal((await installed.get(RELEASE)).version, '1.0.0');
  });

  it('treats a renamed script as a change', async () => {
    await installer(RELEASE);
    scripts.set(RELEASE, source([], '1.0.1', 'Different Name'));
    await installer(RELEASE);
    assert.equal(calls.confirm.at(-1).kind, 'changed');
    assert.ok(calls.confirm.at(-1).changes.some(({ type, key, value }) => type === 'added' && key === 'name' && value === 'Different Name'));
  });

  it('fails without installing when the download fails', async () => {
    scripts.delete(RELEASE);
    const result = await installer(RELEASE);
    assert.equal(result.status, 'failed');
    assert.match(result.error.message, /Unable to download/);
    assert.deepEqual(calls.confirm, []);
    assert.deepEqual(await installed.list(), []);
  });

  it('fails for text that is not a user script, a script without a version, or a broken meta block', async () => {
    for (const bad of [
      'console.log(1)',
      source().replace('// @version 1.0.0\n', ''),
      source().replace('// @name Test Plugin\n', ''),
      source(['// @name Twice']),
    ]) {
      scripts.set(RELEASE, bad);
      const result = await installer(RELEASE);
      assert.equal(result.status, 'failed', bad.slice(0, 40));
    }
    assert.deepEqual(calls.confirm, []);
    assert.deepEqual(await installed.list(), []);
  });

  it('fails without saving when building the bundle fails', async () => {
    const failing = createInstaller({
      loadRegistry: async () => registry,
      fetchScript: async () => source(),
      build: async () => { throw new Error('Unable to download https://unpkg.com/x.js (404)'); },
      installed,
      confirm: async () => true,
    });
    const result = await failing(RELEASE);
    assert.equal(result.status, 'failed');
    assert.match(result.error.message, /404/);
    assert.deepEqual(await installed.list(), []);
  });

  it('fails when the registry cannot be loaded', async () => {
    const offline = createInstaller({
      loadRegistry: async () => { throw new Error('Unable to load the plugin registry (500)'); },
      fetchScript: async () => source(),
      build: async () => ({}),
      installed,
      confirm: async () => true,
    });
    const result = await offline(RELEASE);
    assert.equal(result.status, 'failed');
    assert.match(result.error.message, /registry/);
  });

  it('shares one install between simultaneous clicks on the same plugin', async () => {
    const [a, b] = await Promise.all([installer(RELEASE), installer(RELEASE)]);
    assert.equal(a, b);
    assert.equal(calls.confirm.length, 1);
    assert.equal(calls.fetch.length, 1);
    assert.equal((await installed.list()).length, 1);
  });

  it('keeps different plugins apart', async () => {
    await installer(RELEASE);
    await installer(RAW);
    assert.deepEqual((await installed.list()).map((record) => record.url), [RELEASE, RAW]);
  });
});
