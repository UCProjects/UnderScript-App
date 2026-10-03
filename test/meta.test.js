import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { parseMeta } from '../src/userscript/meta.js';

const wrap = (...lines) => ['// ==UserScript==', ...lines, '// ==/UserScript==', 'console.log(1);'].join('\n');
const HEX256 = 'a'.repeat(64);

describe('parseMeta', () => {
  it('returns null without a meta block', () => {
    assert.equal(parseMeta('console.log(1);'), null);
    assert.equal(parseMeta(''), null);
    assert.equal(parseMeta(undefined), null);
  });

  it('parses the common single value keys', () => {
    const meta = parseMeta(wrap(
      '// @name         UnderCards script',
      '// @namespace    https://feildmaster.com/',
      '// @version      0.64.0',
      '// @description  Various changes to undercards game',
      '// @author       feildmaster',
      '// @homepage     https://feildmaster.github.io/UnderScript/',
      '// @updateURL    https://example.com/meta.js',
      '// @downloadURL  https://example.com/script.js',
    ));
    assert.equal(meta.name, 'UnderCards script');
    assert.equal(meta.namespace, 'https://feildmaster.com/');
    assert.equal(meta.version, '0.64.0');
    assert.equal(meta.description, 'Various changes to undercards game');
    assert.equal(meta.author, 'feildmaster');
    assert.equal(meta.homepage, 'https://feildmaster.github.io/UnderScript/');
    assert.equal(meta.updateURL, 'https://example.com/meta.js');
    assert.equal(meta.downloadURL, 'https://example.com/script.js');
  });

  it('collects repeated keys in order', () => {
    const meta = parseMeta(wrap(
      '// @match   https://*.undercards.net/*',
      '// @match   https://feildmaster.github.io/UnderScript/*',
      '// @exclude  https://*.undercards.net/*/*',
      '// @include  https://example.com/*',
      '// @connect  github.com',
      '// @connect  githubusercontent.com',
      '// @grant    GM_getResourceText',
      '// @grant    unsafeWindow',
    ));
    assert.deepEqual(meta.matches, ['https://*.undercards.net/*', 'https://feildmaster.github.io/UnderScript/*']);
    assert.deepEqual(meta.excludes, ['https://*.undercards.net/*/*']);
    assert.deepEqual(meta.includes, ['https://example.com/*']);
    assert.deepEqual(meta.connects, ['github.com', 'githubusercontent.com']);
    assert.deepEqual(meta.grants, ['GM_getResourceText', 'unsafeWindow']);
  });

  it('defaults run-at and reads noframes as a flag', () => {
    assert.equal(parseMeta(wrap('// @name x')).runAt, 'document-idle');
    assert.equal(parseMeta(wrap('// @name x')).noframes, false);
    const meta = parseMeta(wrap('// @run-at document-body', '// @noframes'));
    assert.equal(meta.runAt, 'document-body');
    assert.equal(meta.noframes, true);
  });

  it('handles CRLF line endings and extra whitespace', () => {
    const text = '// ==UserScript==\r\n//   @name\t\tSpaced   out  \r\n// @version 1.0.0\r\n// ==/UserScript==\r\n';
    const meta = parseMeta(text);
    assert.equal(meta.name, 'Spaced   out');
    assert.equal(meta.version, '1.0.0');
  });

  it('accepts directives without a space after the slashes', () => {
    const meta = parseMeta(wrap('//@require\t\tfile://D:\\scripts\\a.js', '//@name no space'));
    assert.deepEqual(meta.requires.map((r) => r.url), ['file://D:\\scripts\\a.js']);
    assert.equal(meta.name, 'no space');
  });

  it('ignores commented out directives and non-directive lines', () => {
    const meta = parseMeta(wrap(
      '// @require https://example.com/a.js',
      '/// @require https://example.com/b.js',
      '// just a comment',
      '',
      '// @name kept',
    ));
    assert.deepEqual(meta.requires.map((r) => r.url), ['https://example.com/a.js']);
    assert.equal(meta.name, 'kept');
  });

  it('keeps localized keys and unknown keys in values', () => {
    const meta = parseMeta(wrap('// @name Hello', '// @name:fr Bonjour', '// @custom thing', '// @empty'));
    assert.equal(meta.name, 'Hello');
    assert.deepEqual(meta.values['name:fr'], ['Bonjour']);
    assert.deepEqual(meta.values.custom, ['thing']);
    assert.deepEqual(meta.values.empty, ['']);
  });

  it('is not tripped up by prototype keys', () => {
    const meta = parseMeta(wrap('// @__proto__ evil', '// @resource __proto__ https://example.com/x'));
    assert.deepEqual(meta.values.__proto__, ['evil']);
    assert.deepEqual(Object.keys(meta.resources), ['__proto__']);
    assert.equal({}.evil, undefined);
  });

  it('only reads the first meta block and ignores the rest of the file', () => {
    const text = `${wrap('// @name first')}\n${wrap('// @name second')}`;
    assert.equal(parseMeta(text).name, 'first');
  });

  describe('requires and resources', () => {
    it('parses require urls', () => {
      const meta = parseMeta(wrap(
        '// @require https://unpkg.com/showdown@2.0.0/dist/showdown.min.js',
        '// @require https://raw.githubusercontent.com/feildmaster/SimpleToast/2.0.3/simpletoast.js',
        '// @require',
      ));
      assert.deepEqual(meta.requires, [
        { url: 'https://unpkg.com/showdown@2.0.0/dist/showdown.min.js', integrity: [] },
        { url: 'https://raw.githubusercontent.com/feildmaster/SimpleToast/2.0.3/simpletoast.js', integrity: [] },
      ]);
    });

    it('parses resources by name', () => {
      const meta = parseMeta(wrap(
        '// @resource underscript.json https://example.com/lang.json',
        '// @resource   plugins.json\thttps://example.com/plugins.json',
        '// @resource broken',
      ));
      assert.deepEqual(meta.resources, {
        'underscript.json': { url: 'https://example.com/lang.json', integrity: [] },
        'plugins.json': { url: 'https://example.com/plugins.json', integrity: [] },
      });
    });

    it('splits integrity fragments from the url (hex)', () => {
      const meta = parseMeta(wrap(`// @require https://example.com/a.js#sha256=${HEX256}`));
      assert.deepEqual(meta.requires, [{
        url: 'https://example.com/a.js',
        integrity: [{ algorithm: 'sha256', hash: HEX256 }],
      }]);
    });

    it('normalizes base64 and base64url digests to hex', () => {
      const bytes = Buffer.alloc(32, 0xfb);
      const hex = bytes.toString('hex');
      const standard = bytes.toString('base64');
      const url = bytes.toString('base64url');
      for (const [sep, digest] of [['=', standard], ['-', standard], ['=', url]]) {
        const meta = parseMeta(wrap(`// @resource data https://example.com/d.json#sha256${sep}${digest}`));
        assert.deepEqual(meta.resources.data.integrity, [{ algorithm: 'sha256', hash: hex }]);
        assert.equal(meta.resources.data.url, 'https://example.com/d.json');
      }
    });

    it('supports several algorithms in one fragment', () => {
      const sha512 = 'b'.repeat(128);
      const meta = parseMeta(wrap(`// @require https://example.com/a.js#sha256=${HEX256},sha512=${sha512}`));
      assert.deepEqual(meta.requires[0].integrity, [
        { algorithm: 'sha256', hash: HEX256 },
        { algorithm: 'sha512', hash: sha512 },
      ]);
    });

    it('keeps ordinary fragments and rejects malformed digests', () => {
      for (const target of [
        'https://example.com/a.js#section',
        'https://example.com/a.js#sha256=tooshort',
        `https://example.com/a.js#sha256=${HEX256},nonsense`,
        `https://example.com/a.js#md5=${'c'.repeat(32)}`,
      ]) {
        const meta = parseMeta(wrap(`// @require ${target}`));
        assert.deepEqual(meta.requires, [{ url: target, integrity: [] }]);
      }
    });
  });

  describe('duplicates', () => {
    it('rejects keys that may only appear once', () => {
      for (const key of ['name', 'version', 'namespace', 'updateURL', 'downloadURL', 'run-at', 'noframes']) {
        assert.throws(
          () => parseMeta(wrap(`// @${key} one`, `// @${key} two`)),
          new RegExp(`Duplicate @${key} `),
          key,
        );
      }
    });

    it('rejects the same key even when the values match', () => {
      assert.throws(() => parseMeta(wrap('// @version 1.0.0', '// @version 1.0.0')), /Duplicate @version/);
    });

    it('treats each localized key as its own single value', () => {
      const meta = parseMeta(wrap('// @name Hello', '// @name:fr Bonjour', '// @name:de Hallo'));
      assert.equal(meta.name, 'Hello');
      assert.throws(() => parseMeta(wrap('// @name:fr Bonjour', '// @name:fr Salut')), /Duplicate @name:fr/);
    });

    it('rejects two resources with the same name', () => {
      assert.throws(
        () => parseMeta(wrap('// @resource data https://example.com/a.json', '// @resource data https://example.com/b.json')),
        /Duplicate @resource data/,
      );
    });

    it('still allows repeating the list keys', () => {
      const meta = parseMeta(wrap(
        '// @match https://a.example/*',
        '// @match https://b.example/*',
        '// @require https://example.com/a.js',
        '// @require https://example.com/a.js',
        '// @grant none',
        '// @grant unsafeWindow',
      ));
      assert.equal(meta.matches.length, 2);
      assert.equal(meta.requires.length, 2);
      assert.equal(meta.grants.length, 2);
    });
  });

  it('parses the real UnderScript release meta', () => {
    const meta = parseMeta(readFileSync(new URL('./fixtures/underscript.meta.js', import.meta.url), 'utf8'));
    assert.equal(meta.name, 'UnderCards script');
    assert.equal(meta.version, '0.64.0');
    assert.equal(meta.runAt, 'document-body');
    assert.deepEqual(meta.grants, ['none']);
    assert.equal(meta.matches.length, 2);
    assert.equal(meta.requires.length, 6);
    assert.equal(meta.requires[5].url, 'https://raw.githubusercontent.com/feildmaster/SimpleToast/2.0.3/simpletoast.js');
    assert.equal(meta.updateURL, 'https://github.com/UCProjects/UnderScript/releases/latest/download/undercards.meta.js');
  });
});
