import assert from 'node:assert/strict';
import { promises as file } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createBundle } from '../src/userscript/bundle.js';
import { createInstalled, describeChanges, sameMeta } from '../src/userscript/installed.js';
import { parseMeta } from '../src/userscript/meta.js';

const URL_A = 'https://example.com/a.user.js';
const URL_B = 'https://example.com/b.user.js';

function script(name, extra = [], version = '1.0.0', match = 'https://undercards.net/*') {
  return [
    '// ==UserScript==',
    `// @name ${name}`,
    '// @namespace https://example.com/',
    `// @version ${version}`,
    `// @match ${match}`,
    '// @grant none',
    ...extra,
    '// ==/UserScript==',
    `window.${name.replace(/\W/g, '')} = true;`,
  ].join('\n');
}

function build(name, extra, version, match) {
  const source = script(name, extra, version, match);
  const meta = parseMeta(source);
  return { name, id: `${meta.namespace}|${meta.name}`, version: meta.version, meta, bundle: createBundle(meta, source) };
}

const assetsOf = () => ({
  requires: [{ url: 'https://example.com/lib.js', integrity: [], code: 'lib code' }],
  resources: { css: { url: 'https://example.com/a.css', integrity: [{ algorithm: 'sha256', hash: 'ab' }], code: 'body {}' } },
});

let dir;
let installed;

beforeEach(async () => {
  dir = await file.mkdtemp(path.join(os.tmpdir(), 'installed-'));
  installed = createInstalled(dir);
});

afterEach(() => file.rm(dir, { recursive: true, force: true }));

describe('sameMeta', () => {
  it('ignores the version only', () => {
    const a = parseMeta(script('A', [], '1.0.0'));
    assert.equal(sameMeta(a, parseMeta(script('A', [], '2.5.1'))), true);
    assert.equal(sameMeta(a, parseMeta(script('A', ['// @version:fr 9'], '1.0.0'))), true);
  });

  it('notices every other change', () => {
    const a = parseMeta(script('A'));
    for (const extra of [
      ['// @description changed'],
      ['// @grant GM_setValue'],
      ['// @match https://example.com/*'],
      ['// @require https://example.com/lib.js'],
      ['// @connect evil.example'],
      ['// @author someone'],
    ]) {
      assert.equal(sameMeta(a, parseMeta(script('A', extra))), false, extra.join());
    }
    assert.equal(sameMeta(a, parseMeta(script('B'))), false);
  });

  it('treats order of repeated keys as a change', () => {
    const a = parseMeta(script('A', ['// @require https://e.com/1.js', '// @require https://e.com/2.js']));
    const b = parseMeta(script('A', ['// @require https://e.com/2.js', '// @require https://e.com/1.js']));
    assert.equal(sameMeta(a, b), false);
  });

  it('copes with missing meta', () => {
    assert.equal(sameMeta(undefined, undefined), true);
    assert.equal(sameMeta(undefined, parseMeta(script('A'))), false);
  });
});

describe('describeChanges', () => {
  it('lists added, removed and reordered values', () => {
    const before = parseMeta(script('A', ['// @grant GM_getValue', '// @require https://e.com/1.js', '// @require https://e.com/2.js']));
    const after = parseMeta(script('A', ['// @grant GM_xmlhttpRequest', '// @require https://e.com/2.js', '// @require https://e.com/1.js'], '2.0.0'));
    assert.deepEqual(describeChanges(before, after), [
      '- @grant GM_getValue',
      '+ @grant GM_xmlhttpRequest',
      '~ @require (order changed)',
    ]);
  });

  it('lists nothing when only the version changed', () => {
    assert.deepEqual(describeChanges(parseMeta(script('A')), parseMeta(script('A', [], '3.0.0'))), []);
  });

  it('shows new and dropped keys', () => {
    const lines = describeChanges(parseMeta(script('A', ['// @author old'])), parseMeta(script('A', ['// @homepage https://h.example'])));
    assert.deepEqual(lines, ['- @author old', '+ @homepage https://h.example']);
  });
});

describe('createInstalled', () => {
  it('starts empty', async () => {
    assert.deepEqual(await installed.list(), []);
    assert.equal(await installed.get(URL_A), undefined);
    assert.deepEqual(await installed.bundlesFor('https://undercards.net/'), []);
  });

  it('saves a new script enabled and persists it', async () => {
    const saved = await installed.save({ url: URL_A, ...build('Alpha') });
    assert.equal(saved.enabled, true);
    assert.equal(saved.version, '1.0.0');
    assert.equal('bundle' in saved, false);
    const again = createInstalled(dir);
    const [record] = await again.list();
    assert.equal(record.name, 'Alpha');
    assert.equal(record.url, URL_A);
    assert.equal(record.meta.version, '1.0.0');
    assert.equal((await again.bundlesFor('https://undercards.net/Game'))[0].url, URL_A);
  });

  it('records where a script came from and treats old records as registry installs', async () => {
    assert.equal((await installed.save({ url: URL_A, ...build('Alpha') })).source, 'registry');
    assert.equal((await installed.save({ url: URL_B, ...build('Beta'), source: 'local' })).source, 'local');
    assert.equal((await installed.save({ url: URL_B, ...build('Beta', [], '2.0.0') })).source, 'local');
    const base = path.join(dir, (await file.readdir(dir))[0], 'record.json');
    const record = JSON.parse(await file.readFile(base, 'utf8'));
    delete record.source;
    await file.writeFile(base, JSON.stringify(record));
    const sources = (await createInstalled(dir).list()).map(({ source }) => source);
    assert.ok(sources.includes('registry'));
    assert.equal(sources.length, 2);
  });

  it('keeps the enabled state, order and install time when updating', async () => {
    await installed.save({ url: URL_A, ...build('Alpha') });
    await installed.save({ url: URL_B, ...build('Beta') });
    const first = await installed.get(URL_A);
    await installed.setEnabled(URL_A, false);
    const updated = await installed.save({ url: URL_A, ...build('Alpha', [], '2.0.0') });
    assert.equal(updated.version, '2.0.0');
    assert.equal(updated.enabled, false);
    assert.equal(updated.installedAt, first.installedAt);
    assert.equal(updated.order, first.order);
    assert.deepEqual((await installed.list()).map((record) => record.name), ['Alpha', 'Beta']);
    assert.equal((await createInstalled(dir).get(URL_A)).version, '2.0.0');
  });

  it('returns every enabled script whatever pages it matches, in install order', async () => {
    await installed.save({ url: URL_A, ...build('Alpha') });
    await installed.save({ url: URL_B, ...build('Beta', [], '1.0.0', 'https://example.org/*') });
    await installed.save({ url: 'https://example.com/c.user.js', ...build('Gamma') });
    await installed.setEnabled('https://example.com/c.user.js', false);
    assert.deepEqual((await installed.enabledBundles()).map((entry) => entry.url), [URL_A, URL_B]);
  });

  it('leaves scripts marked noframes out of subframes only', async () => {
    await installed.save({ url: URL_A, ...build('Alpha') });
    await installed.save({ url: URL_B, ...build('Beta', ['// @noframes']) });
    const urls = (list) => list.map((entry) => entry.url);
    assert.deepEqual(urls(await installed.enabledBundles()), [URL_A, URL_B]);
    assert.deepEqual(urls(await installed.enabledBundles({ subframe: false })), [URL_A, URL_B]);
    assert.deepEqual(urls(await installed.enabledBundles({ subframe: true })), [URL_A]);
    assert.deepEqual(urls(await installed.bundlesFor('https://undercards.net/')), [URL_A, URL_B]);
    assert.deepEqual(urls(await installed.bundlesFor('https://undercards.net/', { subframe: true })), [URL_A]);
  });

  it('only returns enabled scripts that match the page, in install order', async () => {
    await installed.save({ url: URL_A, ...build('Alpha') });
    await installed.save({ url: URL_B, ...build('Beta', [], '1.0.0', 'https://example.org/*') });
    await installed.save({ url: 'https://example.com/c.user.js', ...build('Gamma') });
    assert.deepEqual((await installed.bundlesFor('https://undercards.net/')).map((entry) => entry.url), [URL_A, 'https://example.com/c.user.js']);
    assert.deepEqual((await installed.bundlesFor('https://example.org/x')).map((entry) => entry.url), [URL_B]);
    await installed.setEnabled(URL_A, false);
    assert.deepEqual((await installed.bundlesFor('https://undercards.net/')).map((entry) => entry.url), ['https://example.com/c.user.js']);
    await installed.setEnabled(URL_A, true);
    assert.equal((await installed.bundlesFor('https://undercards.net/')).length, 2);
  });

  it('persists toggles', async () => {
    await installed.save({ url: URL_A, ...build('Alpha') });
    assert.equal(await installed.setEnabled(URL_A, false), true);
    assert.equal((await createInstalled(dir).get(URL_A)).enabled, false);
    assert.equal(await installed.setEnabled('https://example.com/none.user.js', true), false);
  });

  it('removes scripts and their files', async () => {
    await installed.save({ url: URL_A, ...build('Alpha') });
    await installed.save({ url: URL_B, ...build('Beta') });
    assert.equal(await installed.remove(URL_A), true);
    assert.equal(await installed.remove(URL_A), false);
    assert.deepEqual((await createInstalled(dir).list()).map((record) => record.name), ['Beta']);
    assert.equal((await file.readdir(dir)).length, 1);
  });

  it('skips records it cannot read', async () => {
    await installed.save({ url: URL_A, ...build('Alpha') });
    await installed.save({ url: URL_B, ...build('Beta') });
    const [first] = await file.readdir(dir);
    await file.writeFile(path.join(dir, first, 'record.json'), '{broken');
    await file.mkdir(path.join(dir, 'orphan'));
    await file.writeFile(path.join(dir, 'orphan', 'record.json'), JSON.stringify({ url: 'https://example.com/orphan.user.js', order: 9 }));
    await file.writeFile(path.join(dir, 'stray.json'), '{}');
    assert.equal((await createInstalled(dir).list()).length, 1);
  });

  it('keeps each script in a folder named by a hash, with no temporary files left', async () => {
    await installed.save({ url: '../../evil/x.user.js', ...build('Alpha'), script: 'code', assets: assetsOf() });
    const folders = await file.readdir(dir);
    assert.equal(folders.length, 1);
    assert.match(folders[0], /^[0-9a-f]{64}$/);
    const inside = [];
    const walk = async (target) => {
      for (const entry of await file.readdir(target, { withFileTypes: true })) {
        if (entry.isDirectory()) await walk(path.join(target, entry.name));
        else inside.push(path.relative(path.join(dir, folders[0]), path.join(target, entry.name)).split(path.sep).join('/'));
      }
    };
    await walk(path.join(dir, folders[0]));
    assert.deepEqual(inside.sort(), ['assets/require-0.js', 'assets/resource-0.txt', 'bundle.js', 'record.json', 'script.user.js']);
  });

  it('gives back the script and assets it was saved with', async () => {
    await installed.save({ url: URL_A, ...build('Alpha'), script: 'the script', assets: assetsOf() });
    assert.deepEqual(await createInstalled(dir).assetsOf(URL_A), { script: 'the script', assets: assetsOf() });
    assert.equal(await installed.assetsOf(URL_B), undefined);
  });

  it('drops assets that a newer save no longer has', async () => {
    await installed.save({ url: URL_A, ...build('Alpha'), script: 'one', assets: assetsOf() });
    await installed.save({ url: URL_A, ...build('Alpha', [], '2.0.0'), script: 'two' });
    assert.deepEqual(await createInstalled(dir).assetsOf(URL_A), { script: 'two', assets: { requires: [], resources: {} } });
  });

  it('finds records built with another bundle format and updates them in place', async () => {
    await installed.save({ url: URL_A, ...build('Alpha'), script: 's', format: 'old' });
    await installed.save({ url: URL_B, ...build('Beta'), script: 's' });
    assert.deepEqual((await installed.stale('current')).map((record) => record.name), ['Alpha', 'Beta']);
    assert.deepEqual((await installed.stale()).map((record) => record.name), ['Alpha']);
    const before = await installed.get(URL_A);
    await installed.setEnabled(URL_A, false);
    assert.equal(await installed.rebuilt(URL_A, { bundle: 'new bundle', meta: build('Alpha').meta }), true);
    assert.equal(await installed.rebuilt('https://example.com/none.user.js', { bundle: 'x', meta: {} }), false);
    const after = await createInstalled(dir).get(URL_A);
    assert.equal(after.updatedAt, before.updatedAt);
    assert.equal(after.enabled, false);
    assert.equal(after.format, (await installed.get(URL_B)).format);
    assert.deepEqual(await installed.stale(), []);
  });

  it('applies concurrent saves in order', async () => {
    await Promise.all(Array.from({ length: 10 }, (_, i) => installed.save({ url: `https://example.com/${i}.user.js`, ...build(`Script${i}`) })));
    const list = await installed.list();
    assert.deepEqual(list.map((record) => record.order), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal((await createInstalled(dir).list()).length, 10);
  });
});
