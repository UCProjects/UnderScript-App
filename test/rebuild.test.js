import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { promises as file } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { assembleBundle, buildBundle } from '../src/userscript/build.js';
import { bundleFormat, createBundle } from '../src/userscript/bundle.js';
import { clearDownloads } from '../src/userscript/download.js';
import { createInstalled } from '../src/userscript/installed.js';
import { parseMeta } from '../src/userscript/meta.js';
import { rebuildStale } from '../src/userscript/rebuild.js';

const LIB = 'https://example.com/lib.js';
const CSS = 'https://example.com/a.css';
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

function script(extra = []) {
  return [
    '// ==UserScript==',
    '// @name Alpha',
    '// @namespace https://example.com/',
    '// @version 1.0.0',
    '// @match https://undercards.net/*',
    '// @grant GM_getResourceText',
    '// @grant GM_xmlhttpRequest',
    '// @connect example.com',
    ...extra,
    '// ==/UserScript==',
    'window.ran = GM_getResourceText("css");',
  ].join('\n');
}

const withAssets = (hash = sha256('lib code')) => script([`// @require ${LIB}#sha256=${hash}`, `// @resource css ${CSS}`]);

function serve(files) {
  return mock.method(globalThis, 'fetch', async (url) => {
    const body = files[String(url)];
    return body === undefined ? new Response('missing', { status: 404 }) : new Response(body);
  });
}

describe('bundleFormat', () => {
  it('is a short stable stamp of the bundle shape', () => {
    assert.match(bundleFormat, /^[0-9a-f]{16}$/);
  });

  it('follows the generated code', () => {
    const meta = { name: 'a', version: '1', grants: ['GM_xmlhttpRequest'], connects: [] };
    assert.notEqual(createBundle(meta, 'x'), createBundle({ ...meta, connects: ['example.com'] }, 'x'));
  });
});

describe('buildBundle and assembleBundle', () => {
  beforeEach(() => clearDownloads());
  afterEach(() => mock.restoreAll());

  it('returns the downloaded assets with the bundle', async () => {
    serve({ [LIB]: 'lib code', [CSS]: 'body {}' });
    const built = await buildBundle(withAssets());
    assert.equal(built.assets.requires[0].url, LIB);
    assert.equal(built.assets.requires[0].code, 'lib code');
    assert.equal(built.assets.requires[0].integrity[0].algorithm, 'sha256');
    assert.deepEqual(built.assets.resources.css, { url: CSS, integrity: [], code: 'body {}' });
    assert.ok(built.bundle.includes('lib code'));
  });

  it('builds the same bundle from the stored pieces without the network', async () => {
    serve({ [LIB]: 'lib code', [CSS]: 'body {}' });
    const source = withAssets();
    const built = await buildBundle(source);
    mock.restoreAll();
    const fetchMock = mock.method(globalThis, 'fetch', async () => {
      throw new Error('offline');
    });
    const again = assembleBundle(source, built.assets);
    assert.equal(again.bundle, built.bundle);
    assert.deepEqual(again.meta, built.meta);
    assert.equal(fetchMock.mock.calls.length, 0);
  });

  it('checks the stored assets against their hashes', () => {
    const source = withAssets();
    const assets = {
      requires: [{ url: LIB, integrity: parseMeta(source).requires[0].integrity, code: 'tampered' }],
      resources: {},
    };
    assert.throws(() => assembleBundle(source, assets), /Checksum mismatch/);
  });

  it('needs a version', () => {
    assert.throws(() => assembleBundle('// ==UserScript==\n// @name A\n// ==/UserScript==', { requires: [], resources: {} }), /version/);
  });
});

describe('rebuildStale', () => {
  let dir;
  let installed;

  beforeEach(async () => {
    clearDownloads();
    dir = await file.mkdtemp(path.join(os.tmpdir(), 'rebuild-'));
    installed = createInstalled(dir);
  });

  afterEach(async () => {
    mock.restoreAll();
    await file.rm(dir, { recursive: true, force: true });
  });

  async function install(url, source, format) {
    serve({ [LIB]: 'lib code', [CSS]: 'body {}' });
    const built = await buildBundle(source);
    mock.restoreAll();
    await installed.save({
      url,
      name: 'Alpha',
      id: 'id',
      version: '1.0.0',
      meta: built.meta,
      bundle: 'old bundle',
      script: source,
      assets: built.assets,
      format,
    });
    return built;
  }

  it('rebuilds out of date records from disk and leaves current ones alone', async () => {
    const built = await install('https://example.com/a.user.js', withAssets(), 'old');
    await installed.save({ url: 'https://example.com/b.user.js', name: 'Beta', id: 'b', version: '1', meta: {}, bundle: 'keep', script: 's' });
    const fetchMock = mock.method(globalThis, 'fetch', async () => {
      throw new Error('offline');
    });
    const result = await rebuildStale({ installed });
    assert.deepEqual(result, { rebuilt: ['https://example.com/a.user.js'], failed: [] });
    assert.equal(fetchMock.mock.calls.length, 0);
    const [first] = await createInstalled(dir).list();
    assert.equal(first.format, bundleFormat);
    assert.deepEqual(await installed.stale(), []);
    const [record] = await installed.bundlesFor('https://undercards.net/');
    assert.equal(record.bundle, built.bundle);
    assert.deepEqual(await rebuildStale({ installed }), { rebuilt: [], failed: [] });
  });

  it('keeps the old bundle and reports a record that cannot be rebuilt', async () => {
    await install('https://example.com/a.user.js', withAssets(), 'old');
    const base = path.join(dir, (await file.readdir(dir))[0], 'assets', 'require-0.js');
    await file.writeFile(base, 'tampered');
    const logged = [];
    const result = await rebuildStale({ installed: createInstalled(dir), log: (...args) => logged.push(args) });
    assert.deepEqual(result, { rebuilt: [], failed: ['https://example.com/a.user.js'] });
    assert.equal(logged.length, 1);
    const [record] = await createInstalled(dir).list();
    assert.equal(record.format, 'old');
  });

  it('reports records saved without a script and keeps their bundle', async () => {
    await installed.save({ url: 'https://example.com/c.user.js', name: 'Gamma', id: 'c', version: '1', meta: {}, bundle: 'b', format: 'old' });
    const logged = [];
    const result = await rebuildStale({ installed, log: (...args) => logged.push(args) });
    assert.deepEqual(result, { rebuilt: [], failed: ['https://example.com/c.user.js'] });
    assert.equal(logged.length, 1);
    assert.equal((await installed.enabledBundles())[0].bundle, 'b');
  });
});
