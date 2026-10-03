import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { afterEach, describe, it, mock } from 'node:test';
import { cachedDownload, clearDownloads, download } from '../src/userscript/download.js';

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const sha512 = (text) => crypto.createHash('sha512').update(text).digest('hex');

function respond(body, status = 200) {
  return mock.method(globalThis, 'fetch', async () => new Response(body, { status }));
}

describe('download', () => {
  afterEach(() => mock.restoreAll());

  it('returns the body as text', async () => {
    respond('hello');
    assert.equal(await download({ url: 'https://example.com/a.js' }), 'hello');
  });

  it('sends the app user agent and a timeout', async () => {
    const fetchMock = respond('x');
    await download({ url: 'https://example.com/a.js' });
    const [url, options] = fetchMock.mock.calls[0].arguments;
    assert.equal(url, 'https://example.com/a.js');
    assert.equal(options.headers['User-Agent'], 'UnderScript-App');
    assert.ok(options.signal instanceof AbortSignal);
  });

  it('rejects other statuses', async () => {
    respond('nope', 404);
    await assert.rejects(download({ url: 'https://example.com/a.js' }), /\(404\)/);
  });

  it('refuses anything but https without making a request', async () => {
    const fetchMock = respond('x');
    for (const url of ['http://example.com/a.js', 'file:///C:/a.js', 'ftp://example.com/a.js']) {
      await assert.rejects(download({ url }), /Refusing to download/, url);
    }
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('refuses redirects that end up on http', async () => {
    mock.method(globalThis, 'fetch', async () => ({
      status: 200,
      url: 'http://example.com/a.js',
      arrayBuffer: async () => Buffer.from('x'),
    }));
    await assert.rejects(download({ url: 'https://example.com/a.js' }), /insecure redirect/);
  });

  it('allows redirects that stay on https', async () => {
    mock.method(globalThis, 'fetch', async () => ({
      status: 200,
      url: 'https://cdn.example.com/a.js',
      arrayBuffer: async () => Buffer.from('payload'),
    }));
    assert.equal(await download({ url: 'https://example.com/a.js' }), 'payload');
  });

  it('accepts a matching digest', async () => {
    respond('payload');
    const url = 'https://example.com/a.js';
    assert.equal(await download({ url, integrity: [{ algorithm: 'sha256', hash: sha256('payload') }] }), 'payload');
  });

  it('rejects a digest mismatch', async () => {
    respond('tampered');
    const integrity = [{ algorithm: 'sha256', hash: sha256('payload') }];
    await assert.rejects(download({ url: 'https://example.com/a.js', integrity }), /Checksum mismatch/);
  });

  it('requires every listed digest to match', async () => {
    respond('payload');
    const url = 'https://example.com/a.js';
    const good = { algorithm: 'sha256', hash: sha256('payload') };
    const bad = { algorithm: 'sha512', hash: sha512('other') };
    await assert.rejects(download({ url, integrity: [good, bad] }), /Checksum mismatch/);
    mock.restoreAll();
    respond('payload');
    assert.equal(await download({ url, integrity: [good, { algorithm: 'sha512', hash: sha512('payload') }] }), 'payload');
  });

  it('rejects oversized responses', async () => {
    respond(Buffer.alloc(10 * 1024 * 1024 + 1));
    await assert.rejects(download({ url: 'https://example.com/big.js' }), /too large/);
  });

  describe('cachedDownload', () => {
    afterEach(() => clearDownloads());

    it('fetches each url once', async () => {
      const fetchMock = respond('payload');
      const target = { url: 'https://example.com/a.js', integrity: [] };
      const results = await Promise.all([cachedDownload(target), cachedDownload(target)]);
      assert.deepEqual(results, ['payload', 'payload']);
      assert.equal(await cachedDownload({ url: 'https://example.com/a.js' }), 'payload');
      assert.equal(fetchMock.mock.callCount(), 1);
    });

    it('keeps different urls and different pins apart', async () => {
      const fetchMock = respond('payload');
      await cachedDownload({ url: 'https://example.com/a.js' });
      await cachedDownload({ url: 'https://example.com/b.js' });
      await cachedDownload({ url: 'https://example.com/a.js', integrity: [{ algorithm: 'sha256', hash: sha256('payload') }] });
      assert.equal(fetchMock.mock.callCount(), 3);
    });

    it('does not cache failures', async () => {
      respond('nope', 500);
      const target = { url: 'https://example.com/a.js' };
      await assert.rejects(cachedDownload(target), /\(500\)/);
      mock.restoreAll();
      respond('ok');
      assert.equal(await cachedDownload(target), 'ok');
    });
  });

  it('passes network errors through', async () => {
    mock.method(globalThis, 'fetch', async () => { throw new TypeError('fetch failed'); });
    await assert.rejects(download({ url: 'https://example.com/a.js' }), /fetch failed/);
  });
});
