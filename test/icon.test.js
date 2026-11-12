import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fetchIcon, iconLimit } from '../src/userscript/icon.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const reply = (body, init = {}) => async () => new Response(body, init);

describe('fetchIcon', () => {
  it('returns the type and bytes of an image', async () => {
    const icon = await fetchIcon('https://example.com/icon.png', { fetchImpl: reply(PNG) });
    assert.equal(icon.type, 'image/png');
    assert.deepEqual([...icon.data], [...PNG]);
  });

  it('recognizes the other image formats by their bytes, not by what the server claims', async () => {
    const cases = [
      ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0])],
      ['image/gif', Buffer.from('GIF89a....')],
      ['image/x-icon', Buffer.from([0, 0, 1, 0, 1, 0])],
      ['image/webp', Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBPVP8 ')])],
      ['image/svg+xml', Buffer.from('<?xml version="1.0"?>\n<!-- c -->\n<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
      ['image/svg+xml', Buffer.from('<svg viewBox="0 0 1 1"></svg>')],
    ];
    for (const [type, data] of cases) {
      const icon = await fetchIcon('https://example.com/i', { fetchImpl: reply(data, { headers: { 'content-type': 'text/html' } }) });
      assert.equal(icon?.type, type, type);
    }
  });

  it('refuses things that are not images', async () => {
    for (const body of ['<html><body>hi</body></html>', 'plain text', '', Buffer.from('<script>alert(1)</script>')]) {
      assert.equal(await fetchIcon('https://example.com/i', { fetchImpl: reply(body, { headers: { 'content-type': 'image/png' } }) }), undefined);
    }
  });

  it('refuses addresses that are not https and failed requests', async () => {
    assert.equal(await fetchIcon('http://example.com/i.png', { fetchImpl: reply(PNG) }), undefined);
    assert.equal(await fetchIcon('file:///C:/i.png', { fetchImpl: reply(PNG) }), undefined);
    assert.equal(await fetchIcon('not a url', { fetchImpl: reply(PNG) }), undefined);
    assert.equal(await fetchIcon(undefined, { fetchImpl: reply(PNG) }), undefined);
    assert.equal(await fetchIcon('https://example.com/i.png', { fetchImpl: reply(PNG, { status: 404 }) }), undefined);
    assert.equal(await fetchIcon('https://example.com/i.png', { fetchImpl: async () => { throw new Error('offline'); } }), undefined);
  });

  it('refuses an image that ends up on an insecure address', async () => {
    const fetchImpl = async () => Object.defineProperty(new Response(PNG), 'url', { value: 'http://example.com/i.png' });
    assert.equal(await fetchIcon('https://example.com/i.png', { fetchImpl }), undefined);
  });

  it('refuses images over the size limit', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(iconLimit)]);
    assert.equal(await fetchIcon('https://example.com/i.png', { fetchImpl: reply(big) }), undefined);
    const declared = async () => new Response(PNG, { headers: { 'content-length': String(iconLimit + 1) } });
    assert.equal(await fetchIcon('https://example.com/i.png', { fetchImpl: declared }), undefined);
  });
});
