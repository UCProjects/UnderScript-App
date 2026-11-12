import assert from 'node:assert/strict';
import { promises as file } from 'node:fs';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const source = await file.readFile(new URL('../src/launcher/fold.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(`${source}\nthis.foldLine = foldLine;`, context);
const fold = (line, options) => {
  const result = context.foldLine(line, options);
  return result && JSON.parse(JSON.stringify(result));
};
const joined = (segments) => segments.map(({ text }) => text).join('');
const payload = (length, fill = 'A') => fill.repeat(length);

describe('foldLine', () => {
  it('leaves short and ordinary lines alone', () => {
    assert.equal(fold(''), undefined);
    assert.equal(fold('const a = 1;'), undefined);
    assert.equal(fold('x'.repeat(1500)), undefined);
  });

  it('folds the base64 of a data uri and keeps the prefix readable', () => {
    const data = payload(1250, 'Qk1u');
    const line = `const logo = "data:image/png;base64,${data}";`;
    const segments = fold(line);
    assert.deepEqual(segments.map(({ folded }) => folded), [false, true, false]);
    assert.equal(segments[0].text, 'const logo = "data:image/png;base64,');
    assert.equal(segments[1].text, data);
    assert.equal(segments[1].label, '5 KB of base64');
    assert.equal(segments[2].text, '";');
    assert.equal(joined(segments), line);
  });

  it('does not fold a short data uri', () => {
    assert.equal(fold(`${'x'.repeat(300)} data:image/png;base64,${payload(100)}`, { maxPlain: 5000 }), undefined);
  });

  it('folds several data uris in one line and accepts url safe characters and padding', () => {
    const first = `${payload(300, 'a-_b')}==`;
    const second = payload(1200, 'Zg9+/');
    const line = `a("data:image/svg+xml;charset=utf-8;base64,${first}", "DATA:font/woff2;BASE64,${second}")`;
    const segments = fold(line);
    assert.deepEqual(segments.filter(({ folded }) => folded).map(({ text }) => text), [first, second]);
    assert.equal(joined(segments), line);
  });

  it('splits a very long ordinary line after the part worth reading', () => {
    const line = 'word '.repeat(1000);
    const segments = fold(line);
    assert.equal(segments.length, 2);
    assert.equal(segments[0].text.length, 400);
    assert.equal(segments[1].folded, true);
    assert.equal(segments[1].label, '4,600 more characters');
    assert.equal(joined(segments), line);
  });

  it('splits long text around a folded data uri too', () => {
    const line = `${'k'.repeat(2000)}data:a/b;base64,${payload(500)}";${'m'.repeat(2000)}`;
    const segments = fold(line);
    assert.deepEqual(segments.map(({ folded }) => folded), [false, true, true, false, true]);
    assert.equal(joined(segments), line);
  });

  it('respects the options', () => {
    const segments = fold('abcdefghij'.repeat(10), { minData: 10, maxPlain: 20, keep: 5 });
    assert.equal(segments[0].text, 'abcde');
    assert.equal(segments[1].folded, true);
  });
});
