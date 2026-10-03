import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import vm from 'node:vm';
import { bundleInfo, bundleVersion, createBundle, runsOn } from '../src/userscript/bundle.js';

function run(bundle, readyState = 'loading') {
  const handlers = [];
  const sandbox = {
    document: {
      readyState,
      addEventListener: (type, handler, options) => handlers.push({ type, handler, options }),
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(bundle, sandbox);
  return { sandbox, handlers };
}

describe('createBundle', () => {
  it('records the script version in GM_info and reads it back', () => {
    const bundle = createBundle({ version: '1.2.3' }, 'window.ok = 1;');
    assert.match(bundle, /^const GM_info = \{"scriptHandler":"UnderScriptApp","script":\{"version":"1.2.3"\}\};$/m);
    assert.equal(bundleVersion(bundle), '1.2.3');
  });

  it('reads the version from bundles in the older format too', () => {
    const old = [
      'function UnderScriptWrapper() {',
      'const GM_info = {"scriptHandler":"UnderScriptApp","script":{"version":"0.63.9"}};',
      '/* dependencies */',
      '(function () {',
      '// @version      0.0.1',
      '})();',
      '}',
    ].join('\n');
    assert.equal(bundleVersion(old), '0.63.9');
  });

  it('returns undefined for text that is not a bundle', () => {
    assert.equal(bundleVersion('console.log(1)'), undefined);
    assert.equal(bundleVersion(''), undefined);
    assert.equal(bundleVersion(undefined), undefined);
  });

  it('only defines GM_getResourceText when it is granted', () => {
    const resources = { a: 'x' };
    assert.doesNotMatch(createBundle({ version: '1' }, ''), /const GM_getResourceText/);
    assert.doesNotMatch(createBundle({ version: '1', grants: ['none'] }, '', { resources }), /const GM_getResourceText/);
    assert.doesNotMatch(createBundle({ version: '1', grants: ['GM_getValue'] }, '', { resources }), /const GM_getResourceText/);
    assert.match(createBundle({ version: '1', grants: ['GM_getResourceText'] }, ''), /const GM_getResourceText/);
    assert.match(createBundle({ version: '1', grants: ['GM_getResourceText'] }, '', { resources }), /const GM_getResourceText/);
  });

  it('treats local resources as an implicit grant', () => {
    assert.doesNotMatch(createBundle({ version: '1' }, '', { localResources: {} }), /const GM_getResourceText/);
    assert.match(createBundle({ version: '1', grants: ['none'] }, '', { localResources: { a: 'x' } }), /const GM_getResourceText/);
  });

  it('always provides GM_info, with or without grants', () => {
    for (const grants of [undefined, [], ['none'], ['GM_getValue']]) {
      assert.match(createBundle({ version: '1', grants }, ''), /^const GM_info = /m);
    }
  });

  it('waits for the next readystatechange before running the script', () => {
    const { sandbox, handlers } = run(createBundle({ version: '1' }, 'window.ran = true;'));
    assert.equal(sandbox.ran, undefined);
    assert.equal(handlers.length, 1);
    assert.equal(handlers[0].type, 'readystatechange');
    assert.equal(handlers[0].options.once, true);
    handlers[0].handler();
    assert.equal(sandbox.ran, true);
  });

  it('runs right away when the document has already finished loading', () => {
    for (const state of ['interactive', 'complete']) {
      const { sandbox, handlers } = run(createBundle({ version: '1' }, 'window.ran = true;'), state);
      assert.equal(sandbox.ran, true, state);
      assert.equal(handlers.length, 0, state);
    }
  });

  it('runs requires first, in order, in scope of the script', () => {
    const bundle = createBundle(
      { version: '1' },
      'window.result = [typeof luxon, base(), order.join(">")].join(",");',
      {
        requires: [
          'var order = ["a"]; var luxon = { id: "luxon" }',
          'var base = function () { return 1 }',
          'order.push("b")',
        ],
      },
    );
    const { sandbox, handlers } = run(bundle);
    handlers[0].handler();
    assert.equal(sandbox.result, 'object,1,a>b');
  });

  it('survives requires that end without a semicolon before the script', () => {
    const bundle = createBundle(
      { version: '1' },
      '(function () { window.sawScript = true; })();',
      { requires: ['var last = function () { return 5 }'] },
    );
    const { sandbox, handlers } = run(bundle);
    handlers[0].handler();
    assert.equal(sandbox.sawScript, true);
  });

  it('serves resources through GM_getResourceText', () => {
    const bundle = createBundle(
      { version: '1', grants: ['GM_getResourceText'] },
      'window.got = [GM_getResourceText("data"), GM_getResourceText("missing"), GM_getResourceText("constructor")].join("|");',
      { resources: { data: '{"a":1}' } },
    );
    const { sandbox, handlers } = run(bundle);
    handlers[0].handler();
    assert.equal(sandbox.got, '{"a":1}||');
  });

  it('lets local resources add to and override the declared ones', () => {
    const bundle = createBundle(
      { version: '1', grants: ['none'] },
      'window.got = [GM_getResourceText("declared"), GM_getResourceText("shared"), GM_getResourceText("local")].join("|");',
      { resources: { declared: 'D', shared: 'old' }, localResources: { shared: 'new', local: 'L' } },
    );
    const { sandbox, handlers } = run(bundle);
    handlers[0].handler();
    assert.equal(sandbox.got, 'D|new|L');
  });

  it('leaves GM_getResourceText undefined for scripts that do not grant it', () => {
    const bundle = createBundle(
      { version: '1', grants: ['none'] },
      'window.type = typeof GM_getResourceText;',
      { resources: { data: 'x' } },
    );
    const { sandbox, handlers } = run(bundle);
    handlers[0].handler();
    assert.equal(sandbox.type, 'undefined');
  });

  it('exposes GM_info to the script', () => {
    const bundle = createBundle({ version: '9.9.9' }, 'window.info = JSON.stringify(GM_info);');
    const { sandbox, handlers } = run(bundle);
    handlers[0].handler();
    assert.deepEqual(JSON.parse(sandbox.info), { scriptHandler: 'UnderScriptApp', script: { version: '9.9.9' } });
  });
});

describe('bundle info and matching', () => {
  const meta = {
    name: 'Test script',
    version: '2.0.0',
    matches: ['https://*.example.com/*'],
    includes: [],
    excludes: ['https://*.example.com/skip/*'],
    excludeMatches: [],
    grants: ['none'],
    runAt: 'document-body',
  };

  it('records the script details in GM_info', () => {
    const info = bundleInfo(createBundle(meta, ''));
    assert.deepEqual(info, meta);
    const { sandbox, handlers } = run(createBundle(meta, 'window.seen = JSON.stringify(GM_info.script.matches);'));
    handlers[0].handler();
    assert.equal(sandbox.seen, '["https://*.example.com/*"]');
  });

  it('only runs on urls the script matches', () => {
    const bundle = createBundle(meta, '');
    assert.equal(runsOn(bundle, 'https://www.example.com/page'), true);
    assert.equal(runsOn(bundle, 'https://www.example.com/skip/page'), false);
    assert.equal(runsOn(bundle, 'https://other.com/'), false);
    assert.equal(runsOn(bundle, 'not a url'), false);
  });

  it('runs bundles that predate pattern matching everywhere', () => {
    const old = 'function UnderScriptWrapper() {\nconst GM_info = {"scriptHandler":"UnderScriptApp","script":{"version":"0.63.9"}};\n}';
    assert.equal(runsOn(old, 'https://anything.example/'), true);
  });

  it('does not run text that is not a bundle', () => {
    assert.equal(runsOn('console.log(1)', 'https://www.example.com/'), false);
    assert.equal(runsOn(undefined, 'https://www.example.com/'), false);
  });
});
