import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { diffLines } from '../src/userscript/diff.js';

const numbered = (count, prefix = 'line') => Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`);
const text = (lines) => lines.join('\n');
const show = ({ hunks }) => hunks.map((hunk) => hunk.lines.map(({ type, text: line }) => `${type}${line}`));

describe('diffLines', () => {
  it('finds no changes in identical or empty text', () => {
    assert.deepEqual(diffLines('a\nb', 'a\nb'), { added: 0, removed: 0, hunks: [], truncated: false, tooLarge: false });
    assert.equal(diffLines('', '').hunks.length, 0);
  });

  it('ignores line ending differences', () => {
    assert.equal(diffLines('a\r\nb\r\nc', 'a\nb\nc').hunks.length, 0);
  });

  it('shows a changed line with context and line numbers', () => {
    const before = numbered(10);
    const after = [...before];
    after[4] = 'changed';
    const result = diffLines(text(before), text(after));
    assert.equal(result.added, 1);
    assert.equal(result.removed, 1);
    assert.deepEqual(show(result), [[' line 2', ' line 3', ' line 4', '-line 5', '+changed', ' line 6', ' line 7', ' line 8']]);
    const [hunk] = result.hunks;
    assert.equal(hunk.oldStart, 2);
    assert.equal(hunk.newStart, 2);
    assert.deepEqual(hunk.lines.map(({ old, new: next }) => [old, next]), [[2, 2], [3, 3], [4, 4], [5, undefined], [undefined, 5], [6, 5 + 1], [7, 7], [8, 8]]);
  });

  it('numbers lines correctly after earlier insertions', () => {
    const before = numbered(20);
    const after = [...before.slice(0, 3), 'new a', 'new b', ...before.slice(3, 15), 'late change', ...before.slice(16)];
    const result = diffLines(text(before), text(after));
    assert.equal(result.hunks.length, 2);
    const late = result.hunks[1].lines.find(({ text: line }) => line === 'late change');
    assert.equal(late.new, 18);
    assert.equal(late.old, undefined);
    assert.equal(result.hunks[1].lines.find(({ text: line }) => line === 'line 16').old, 16);
  });

  it('shows added and removed lines at the ends', () => {
    assert.deepEqual(show(diffLines('b\nc', 'a\nb\nc')), [['+a', ' b', ' c']]);
    assert.deepEqual(show(diffLines('a\nb\nc', 'a\nb')), [[' a', ' b', '-c']]);
    assert.deepEqual(show(diffLines('', 'only')), [['-', '+only']]);
  });

  it('merges hunks that touch and keeps distant ones apart', () => {
    const before = numbered(30);
    const near = [...before];
    near[5] = 'x';
    near[9] = 'y';
    assert.equal(diffLines(text(before), text(near)).hunks.length, 1);
    const far = [...before];
    far[2] = 'x';
    far[25] = 'y';
    assert.equal(diffLines(text(before), text(far)).hunks.length, 2);
  });

  it('copes with duplicated lines and rewrites', () => {
    const result = diffLines('a\na\na\nb', 'a\nb\na\na');
    assert.equal(result.added, result.removed);
    const rebuilt = [];
    for (const hunk of result.hunks) for (const line of hunk.lines) if (line.type !== '-') rebuilt.push(line.text);
    assert.deepEqual(rebuilt, ['a', 'b', 'a', 'a']);
  });

  it('rebuilds the new text from a diff of unrelated text', () => {
    const before = text(numbered(40, 'old'));
    const after = text(numbered(35, 'new'));
    const result = diffLines(before, after, { context: 0 });
    assert.equal(result.added, 35);
    assert.equal(result.removed, 40);
    assert.equal(result.tooLarge, false);
  });

  it('stops when there are too many differences', () => {
    const result = diffLines(text(numbered(100, 'old')), text(numbered(100, 'new')), { maxEdits: 20 });
    assert.deepEqual(result, { added: 100, removed: 100, hunks: [], truncated: false, tooLarge: true });
  });

  it('caps the number of lines it returns', () => {
    const result = diffLines(text(numbered(50, 'old')), text(numbered(50, 'new')), { maxLines: 30 });
    assert.equal(result.truncated, true);
    assert.equal(result.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0), 30);
    assert.equal(result.added, 50);
  });

  it('shortens very long lines', () => {
    const result = diffLines('short', `short\n${'x'.repeat(5000)}`);
    const long = result.hunks[0].lines.find(({ type }) => type === '+');
    assert.equal(long.text.length < 700, true);
    assert.equal(long.text.endsWith('...'), true);
  });
});
