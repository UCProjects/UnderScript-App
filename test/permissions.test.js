import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describePermissions } from '../src/userscript/permissions.js';

describe('describePermissions', () => {
  it('lists nothing for no grants or none', () => {
    assert.deepEqual(describePermissions(), []);
    assert.deepEqual(describePermissions([]), []);
    assert.deepEqual(describePermissions(['none']), []);
  });

  it('groups the value functions into one entry', () => {
    assert.deepEqual(describePermissions(['GM_getValue', 'GM_setValue', 'GM_listValues']), [
      { text: 'Save and read its own data', names: ['GM_getValue', 'GM_setValue', 'GM_listValues'] },
    ]);
  });

  it('explains requests, resources and the page window', () => {
    const result = describePermissions(['GM_xmlhttpRequest', 'GM.xmlHttpRequest', 'GM_getResourceText', 'unsafeWindow']);
    assert.deepEqual(result.map(({ text }) => text), [
      'Make web requests, only to the sites listed under Can reach',
      'Read the text files it comes with',
      "Use the page's own window",
    ]);
    assert.deepEqual(result[0].names, ['GM_xmlhttpRequest', 'GM.xmlHttpRequest']);
  });

  it('names grants it does not know', () => {
    assert.deepEqual(describePermissions(['GM_notification']), [{ text: 'Use GM_notification', names: ['GM_notification'] }]);
  });
});
