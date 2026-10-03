import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { findEntry, loadRegistry, parseRegistry, registryURL } from '../src/userscript/registry.js';

const GIST = 'https://gist.github.com/feildmaster/685b7cc68f747d5d1cce5de59cec2ef4/raw/playerInfo.user.js';
const RAW = 'https://raw.githubusercontent.com/theWiza2341/Wizascript/refs/heads/main/wizascript.user.js';
const RELEASE = 'https://github.com/elytrafae/prettycards/releases/latest/download/prettycards.user.js';

const entries = parseRegistry([
  { name: 'Player Info', author: 'feildmaster', updateURL: GIST },
  { name: 'Wizascript', author: 'TheWiza2341', updateURL: RAW },
  { name: 'PrettyCards', author: 'elytrafae', updateURL: RELEASE },
]);

describe('parseRegistry', () => {
  it('keeps entries that point at a user script over https', () => {
    assert.deepEqual(entries.map(({ name, author, url }) => [name, author, url]), [
      ['Player Info', 'feildmaster', GIST],
      ['Wizascript', 'TheWiza2341', RAW],
      ['PrettyCards', 'elytrafae', RELEASE],
    ]);
  });

  it('prefers downloadURL over updateURL', () => {
    const [entry] = parseRegistry([{
      name: 'X',
      updateURL: 'https://example.com/x.meta.js',
      downloadURL: 'https://example.com/x.user.js',
    }]);
    assert.equal(entry.url, 'https://example.com/x.user.js');
  });

  it('drops entries that cannot be installed', () => {
    assert.deepEqual(parseRegistry([
      { name: 'Meta only', updateURL: 'https://example.com/x.meta.js' },
      { name: 'Insecure', updateURL: 'http://example.com/x.user.js' },
      { name: 'Local', updateURL: 'file:///C:/x.user.js' },
      { name: 'No url' },
      { updateURL: 'https://example.com/nameless.user.js' },
      { name: '', updateURL: 'https://example.com/empty.user.js' },
      { name: 5, updateURL: 'https://example.com/five.user.js' },
      null,
      'text',
    ]), []);
  });

  it('strips fragments and ignores a non-string author', () => {
    const [entry] = parseRegistry([{ name: 'X', author: 7, updateURL: 'https://example.com/x.user.js#sha256=abc' }]);
    assert.equal(entry.url, 'https://example.com/x.user.js');
    assert.equal(entry.author, undefined);
  });

  it('rejects anything that is not a list', () => {
    assert.throws(() => parseRegistry({}), /Invalid registry/);
    assert.throws(() => parseRegistry(null), /Invalid registry/);
  });
});

describe('findEntry', () => {
  it('finds an entry by its exact url', () => {
    assert.equal(findEntry(entries, GIST).name, 'Player Info');
    assert.equal(findEntry(entries, RAW).name, 'Wizascript');
    assert.equal(findEntry(entries, RELEASE).name, 'PrettyCards');
  });

  it('ignores fragments on the clicked link', () => {
    assert.equal(findEntry(entries, `${GIST}#install`).name, 'Player Info');
  });

  it('accepts a tagged asset of the registered github release', () => {
    const tagged = 'https://github.com/elytrafae/prettycards/releases/download/v2.16.4/prettycards.user.js';
    assert.equal(findEntry(entries, tagged).name, 'PrettyCards');
    assert.equal(findEntry(entries, 'https://github.com/ElytraFae/PrettyCards/releases/latest/download/PrettyCards.user.js').name, 'PrettyCards');
  });

  it('rejects urls the registry does not list', () => {
    for (const clicked of [
      'https://evil.example/prettycards.user.js',
      'https://github.com/elytrafae/prettycards/releases/download/v1/other.user.js',
      'https://github.com/someone-else/prettycards/releases/download/v1/prettycards.user.js',
      'https://github.com/elytrafae/prettycards/raw/main/prettycards.user.js',
      'https://gist.github.com/feildmaster/other/raw/playerInfo.user.js',
      'https://gist.github.com/feildmaster/685b7cc68f747d5d1cce5de59cec2ef4/raw/other.user.js',
      'https://raw.githubusercontent.com/theWiza2341/Wizascript/refs/heads/dev/wizascript.user.js',
      'http://raw.githubusercontent.com/theWiza2341/Wizascript/refs/heads/main/wizascript.user.js',
      'file:///C:/wizascript.user.js',
      'not a url',
      '',
      undefined,
    ]) {
      assert.equal(findEntry(entries, clicked), undefined, String(clicked));
    }
  });

  it('does not treat a registered raw or gist url as a release', () => {
    assert.equal(findEntry(entries, 'https://github.com/theWiza2341/Wizascript/releases/download/v1/wizascript.user.js'), undefined);
  });
});

describe('loadRegistry', () => {
  afterEach(() => mock.restoreAll());

  it('loads and cleans the list from the registry url', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify([
      { name: 'A', updateURL: 'https://example.com/a.user.js' },
      { name: 'B', updateURL: 'https://example.com/b.meta.js' },
    ])));
    const list = await loadRegistry();
    assert.deepEqual(list.map(({ name }) => name), ['A']);
    assert.equal(fetchMock.mock.calls[0].arguments[0], registryURL);
  });

  it('rejects on errors and bad data', async () => {
    mock.method(globalThis, 'fetch', async () => new Response('no', { status: 500 }));
    await assert.rejects(loadRegistry(), /\(500\)/);
    mock.restoreAll();
    mock.method(globalThis, 'fetch', async () => new Response('{"not":"a list"}'));
    await assert.rejects(loadRegistry(), /Invalid registry/);
  });
});
