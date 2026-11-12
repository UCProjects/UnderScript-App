import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkRequest, createRequester, hostAllowed, isPrivateHost, limits } from '../src/userscript/request.js';

const connects = ['raw.githubusercontent.com', 'example.com'];

function reply(body = '', init = {}) {
  return new Response(body, init);
}

function scripted(...responses) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), ...options });
    const next = responses.shift();
    return typeof next === 'function' ? next(options) : next;
  };
  return { calls, request: createRequester({ fetchImpl }) };
}

function hanging() {
  return createRequester({
    fetchImpl: (url, { signal }) => new Promise((resolve, reject) => {
      if (signal.aborted) reject(new Error('aborted'));
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    }),
  });
}

describe('hostAllowed', () => {
  it('matches the host and its subdomains only', () => {
    assert.equal(hostAllowed('example.com', connects), true);
    assert.equal(hostAllowed('API.Example.com', connects), true);
    assert.equal(hostAllowed('notexample.com', connects), false);
    assert.equal(hostAllowed('example.com.evil.test', connects), false);
  });

  it('never treats wildcards and special names as an allow list', () => {
    for (const entry of ['*', 'self', 'localhost']) {
      assert.equal(hostAllowed('example.com', [entry]), false, entry);
    }
    assert.equal(hostAllowed('example.com', []), false);
  });
});

describe('isPrivateHost', () => {
  it('flags local and private addresses', () => {
    for (const host of ['localhost', 'a.localhost', 'printer.local', 'x.internal', '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.1', '169.254.1.1', '100.64.0.1', '0.0.0.0', '[::1]', '[fd00::1]', '[fe80::1]', '[::ffff:10.0.0.1]']) {
      assert.equal(isPrivateHost(host), true, host);
    }
  });

  it('sees through the forms a url normalizes embedded ipv4 addresses to', () => {
    for (const url of ['https://[::ffff:127.0.0.1]/', 'https://[::ffff:10.0.0.1]/', 'https://[::ffff:c0a8:1]/', 'https://[::127.0.0.1]/', 'https://[64:ff9b::7f00:1]/', 'https://[64:ff9b::a9fe:a9fe]/', 'https://2130706433/']) {
      assert.equal(isPrivateHost(new URL(url).hostname), true, url);
    }
    for (const url of ['https://[::ffff:8.8.8.8]/', 'https://[::ffff:808:808]/', 'https://[64:ff9b::808:808]/']) {
      assert.equal(isPrivateHost(new URL(url).hostname), false, url);
    }
  });

  it('leaves public addresses alone', () => {
    for (const host of ['example.com', '8.8.8.8', '172.32.0.1', '100.128.0.1', '[2606:4700::1111]']) {
      assert.equal(isPrivateHost(host), false, host);
    }
  });
});

describe('checkRequest', () => {
  const ok = { url: 'https://example.com/a' };

  it('applies defaults', () => {
    const plan = checkRequest(ok, connects);
    assert.equal(plan.method, 'GET');
    assert.equal(plan.url.href, 'https://example.com/a');
    assert.equal(plan.timeout, limits.timeout);
    assert.equal(plan.responseType, '');
  });

  it('clamps the timeout', () => {
    assert.equal(checkRequest({ ...ok, timeout: 5 }, connects).timeout, 5);
    assert.equal(checkRequest({ ...ok, timeout: 10 ** 9 }, connects).timeout, limits.maxTimeout);
  });

  it('rejects what the script is not allowed to reach', () => {
    for (const url of [
      'http://example.com/',
      'https://other.test/',
      'https://user:pw@example.com/',
      'file:///C:/x',
      'not a url',
      undefined,
    ]) {
      assert.throws(() => checkRequest({ url }, connects), Error, String(url));
    }
    assert.throws(() => checkRequest({ url: 'https://127.0.0.1/' }, ['127.0.0.1']), /local addresses/);
  });

  it('rejects bad methods, bodies, headers and response types', () => {
    assert.throws(() => checkRequest({ ...ok, method: 'TRACE' }, connects), /method/);
    assert.throws(() => checkRequest({ ...ok, data: 'x' }, connects), /cannot have a body/);
    assert.throws(() => checkRequest({ ...ok, method: 'POST', data: {} }, connects), /text request bodies/);
    assert.throws(() => checkRequest({ ...ok, headers: [] }, connects), /Headers/);
    assert.throws(() => checkRequest({ ...ok, headers: { 'bad name': 'x' } }, connects), /Invalid header/);
    assert.throws(() => checkRequest({ ...ok, headers: { a: 1 } }, connects), /Invalid header/);
    assert.throws(() => checkRequest({ ...ok, responseType: 'blob' }, connects), /responseType/);
  });

  it('drops headers the transport must control', () => {
    const { headers } = checkRequest({ ...ok, headers: { Host: 'evil', 'Content-Length': '1', 'X-One': '1', 'Content-Type': 'application/json' } }, connects);
    assert.deepEqual(headers, { 'X-One': '1', 'Content-Type': 'application/json' });
  });
});

describe('request', () => {
  it('returns the response of a successful request', async () => {
    const { request, calls } = scripted(reply('{"a":1}', { status: 200, statusText: 'OK', headers: { 'x-test': 'yes' } }));
    const result = await request({ url: 'https://example.com/x', responseType: 'json' }, connects);
    assert.equal(result.type, 'load');
    assert.deepEqual(result.response.response, { a: 1 });
    assert.equal(result.response.responseText, '{"a":1}');
    assert.equal(result.response.status, 200);
    assert.equal(result.response.finalUrl, 'https://example.com/x');
    assert.match(result.response.responseHeaders, /x-test: yes/);
    assert.equal(calls[0].redirect, 'manual');
  });

  it('reports http errors as a load', async () => {
    const { request } = scripted(reply('nope', { status: 404, statusText: 'Not Found' }));
    const result = await request({ url: 'https://example.com/x' }, connects);
    assert.equal(result.type, 'load');
    assert.equal(result.response.status, 404);
  });

  it('returns arraybuffers and null for broken json', async () => {
    const first = await scripted(reply(new Uint8Array([1, 2, 3]))).request({ url: 'https://example.com/x', responseType: 'arraybuffer' }, connects);
    assert.deepEqual([...new Uint8Array(first.response.response)], [1, 2, 3]);
    const second = await scripted(reply('{')).request({ url: 'https://example.com/x', responseType: 'json' }, connects);
    assert.equal(second.response.response, null);
  });

  it('sends the method, headers and body', async () => {
    const { request, calls } = scripted(reply('ok'));
    await request({ url: 'https://example.com/x', method: 'post', headers: { 'X-A': 'b' }, data: '{"k":1}' }, connects);
    assert.equal(calls[0].method, 'POST');
    assert.deepEqual(calls[0].headers, { 'X-A': 'b' });
    assert.equal(calls[0].body, '{"k":1}');
  });

  it('follows redirects that stay on allowed hosts', async () => {
    const { request, calls } = scripted(
      reply('', { status: 302, headers: { location: '/next' } }),
      reply('done'),
    );
    const result = await request({ url: 'https://example.com/start', method: 'POST', data: 'x' }, connects);
    assert.equal(result.response.finalUrl, 'https://example.com/next');
    assert.equal(calls[1].method, 'GET');
    assert.equal(calls[1].body, undefined);
  });

  it('keeps the method and body on a 307', async () => {
    const { request, calls } = scripted(
      reply('', { status: 307, headers: { location: '/next' } }),
      reply('done'),
    );
    await request({ url: 'https://example.com/start', method: 'POST', data: 'x' }, connects);
    assert.equal(calls[1].method, 'POST');
    assert.equal(calls[1].body, 'x');
  });

  it('refuses a redirect to a host that is not allowed', async () => {
    const { request, calls } = scripted(reply('', { status: 302, headers: { location: 'https://evil.test/' } }));
    const result = await request({ url: 'https://example.com/start' }, connects);
    assert.equal(result.type, 'error');
    assert.match(result.response.error, /@connect/);
    assert.equal(calls.length, 1);
  });

  it('ignores connects the script passes in its own request details', async () => {
    const { request } = scripted(reply('x'));
    const result = await request({ url: 'https://evil.test/', connects: ['evil.test'] }, connects);
    assert.equal(result.type, 'error');
  });

  it('stops after too many redirects', async () => {
    const { request } = scripted(...Array.from({ length: 10 }, () => reply('', { status: 302, headers: { location: '/again' } })));
    const result = await request({ url: 'https://example.com/start' }, connects);
    assert.match(result.response.error, /redirects/);
  });

  it('turns a rejected request into an error', async () => {
    const request = createRequester({
      fetchImpl: async () => {
        throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND') });
      },
    });
    const result = await request({ url: 'https://example.com/x' }, connects);
    assert.equal(result.type, 'error');
    assert.match(result.response.error, /ENOTFOUND/);
  });

  it('reports a request that exceeds its timeout', async () => {
    const result = await hanging()({ url: 'https://example.com/x', timeout: 20 }, connects);
    assert.equal(result.type, 'timeout');
  });

  it('reports an aborted request', async () => {
    const request = hanging();
    const controller = new AbortController();
    const pending = request({ url: 'https://example.com/x' }, connects, controller.signal);
    controller.abort();
    assert.equal((await pending).type, 'abort');
    const already = new AbortController();
    already.abort();
    assert.equal((await request({ url: 'https://example.com/x' }, connects, already.signal)).type, 'abort');
  });

  it('refuses a response that is too large', async () => {
    const result = await scripted(reply(new Uint8Array(limits.response + 1))).request({ url: 'https://example.com/x' }, connects);
    assert.equal(result.type, 'error');
    assert.match(result.response.error, /too large/);
  });

  it('returns validation errors as an error result', async () => {
    const result = await scripted().request({ url: 'http://example.com/' }, connects);
    assert.equal(result.type, 'error');
    assert.match(result.response.error, /https/);
  });
});
