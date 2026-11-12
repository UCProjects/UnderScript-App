import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pluginLinks } from '../src/userscript/links.js';

const GIST = 'https://gist.github.com/feildmaster/685b7cc68f747d5d1cce5de59cec2ef4/raw/playerInfo.user.js';
const RAW = 'https://raw.githubusercontent.com/theWiza2341/Wizascript/refs/heads/main/wizascript.user.js';
const RELEASE = 'https://github.com/elytrafae/prettycards/releases/latest/download/prettycards.user.js';

describe('pluginLinks', () => {
  it('links a gist to its page and its comment box, and has no separate source', () => {
    assert.deepEqual(pluginLinks({ url: GIST, meta: {} }), {
      website: 'https://gist.github.com/feildmaster/685b7cc68f747d5d1cce5de59cec2ef4',
      source: undefined,
      support: 'https://gist.github.com/feildmaster/685b7cc68f747d5d1cce5de59cec2ef4#new_comment_field',
    });
    assert.equal(pluginLinks({ url: 'https://gist.githubusercontent.com/me/abc123/raw/x.user.js', meta: {} }).website, 'https://gist.github.com/me/abc123');
  });

  it('links a github file to its repository, the file and the issues', () => {
    assert.deepEqual(pluginLinks({ url: RAW, meta: {} }), {
      website: 'https://github.com/theWiza2341/Wizascript',
      source: 'https://github.com/theWiza2341/Wizascript/blob/main/wizascript.user.js',
      support: 'https://github.com/theWiza2341/Wizascript/issues',
    });
  });

  it('finds the file in every raw address form', () => {
    const base = 'https://raw.githubusercontent.com/owner/repo';
    const file = 'https://github.com/owner/repo/blob';
    assert.equal(pluginLinks({ url: `${base}/main/a/b.user.js`, meta: {} }).source, `${file}/main/a/b.user.js`);
    assert.equal(pluginLinks({ url: `${base}/refs/heads/dev/b.user.js`, meta: {} }).source, `${file}/dev/b.user.js`);
    assert.equal(pluginLinks({ url: `${base}/refs/tags/v1.2.0/b.user.js`, meta: {} }).source, `${file}/v1.2.0/b.user.js`);
    assert.equal(pluginLinks({ url: 'https://github.com/owner/repo/raw/main/b.user.js', meta: {} }).source, `${file}/main/b.user.js`);
    assert.equal(pluginLinks({ url: 'https://github.com/owner/repo/blob/main/b.user.js', meta: {} }).source, `${file}/main/b.user.js`);
  });

  it('has no separate source when the plugin is a release asset of the repository itself', () => {
    assert.deepEqual(pluginLinks({ url: RELEASE, meta: {} }), {
      website: 'https://github.com/elytrafae/prettycards',
      source: undefined,
      support: 'https://github.com/elytrafae/prettycards/issues',
    });
  });

  it('prefers what the script declares', () => {
    const meta = {
      homepage: 'https://example.com/home',
      values: { supportURL: ['https://example.com/help#top'], source: ['https://example.com/code'] },
    };
    assert.deepEqual(pluginLinks({ url: RAW, meta }), {
      website: 'https://example.com/home',
      source: 'https://example.com/code',
      support: 'https://example.com/help#top',
    });
  });

  it('hides a declared source that is the same place as the homepage', () => {
    const meta = { homepage: 'https://example.com/repo/', values: { source: ['https://example.com/repo#readme'] } };
    assert.equal(pluginLinks({ url: 'https://example.com/a.user.js', meta }).source, undefined);
  });

  it('reads the other names for a homepage, but not source', () => {
    for (const key of ['homepageURL', 'website']) {
      assert.equal(pluginLinks({ url: 'https://example.com/a.user.js', meta: { values: { [key]: ['https://example.com/site'] } } }).website, 'https://example.com/site', key);
    }
    const links = pluginLinks({ url: 'https://example.com/a.user.js', meta: { values: { source: ['https://example.com/site'] } } });
    assert.equal(links.website, undefined);
    assert.equal(links.source, 'https://example.com/site');
  });

  it('falls back to the install address as the source for hosts it does not know', () => {
    assert.deepEqual(pluginLinks({ url: 'https://example.com/a.user.js', meta: {} }), {
      website: undefined,
      source: 'https://example.com/a.user.js',
      support: undefined,
    });
  });

  it('derives the other links from the download addresses when the url itself says nothing', () => {
    const links = pluginLinks({
      url: 'https://cdn.example.com/a.user.js',
      meta: { homepage: 'https://example.com/home', downloadURL: RAW },
    });
    assert.deepEqual(links, {
      website: 'https://example.com/home',
      source: 'https://github.com/theWiza2341/Wizascript/blob/main/wizascript.user.js',
      support: 'https://github.com/theWiza2341/Wizascript/issues',
    });
  });

  it('gives nothing without an address', () => {
    assert.deepEqual(pluginLinks(), { website: undefined, source: undefined, support: undefined });
  });

  it('ignores addresses that are not https or are not addresses', () => {
    const meta = { homepage: 'http://example.com/', values: { supportURL: ['javascript:alert(1)'], website: ['not a url'], homepageURL: ['https://user:pw@example.com/'], source: ['ftp://example.com/x'] } };
    assert.deepEqual(pluginLinks({ url: 'http://example.com/a.user.js', meta }), { website: undefined, source: undefined, support: undefined });
  });

  it('does not build links out of odd repository paths', () => {
    for (const url of ['https://github.com/', 'https://github.com/only', 'https://github.com/a b/c', 'https://raw.githubusercontent.com/x%2Fy/z/file', 'https://gist.github.com/me/not-hex!/raw/x']) {
      const links = pluginLinks({ url, meta: {} });
      assert.equal(links.website, undefined, url);
      assert.equal(links.support, undefined, url);
    }
  });

  it('keeps odd file paths out of the github file link', () => {
    for (const path of ['main/../secret.user.js', 'main/$x.user.js', 'main/a;b.user.js']) {
      const links = pluginLinks({ url: `https://raw.githubusercontent.com/owner/repo/${path}`, meta: {} });
      assert.equal(links.source, undefined, path);
    }
  });

  it('keeps a space in a file name as an encoded space', () => {
    assert.equal(pluginLinks({ url: 'https://raw.githubusercontent.com/owner/repo/main/a b.user.js', meta: {} }).source, 'https://github.com/owner/repo/blob/main/a%20b.user.js');
  });
});
