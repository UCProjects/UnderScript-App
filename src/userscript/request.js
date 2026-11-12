import { Buffer } from 'node:buffer';

export const limits = {
  body: 10 * 1024 * 1024,
  response: 10 * 1024 * 1024,
  timeout: 60000,
  maxTimeout: 120000,
  redirects: 5,
  headers: 100,
};

const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const bodyless = new Set(['GET', 'HEAD']);
const types = new Set(['', 'text', 'json', 'arraybuffer']);
const blockedHeaders = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'upgrade', 'keep-alive', 'te', 'trailer']);
const ignoredConnects = new Set(['*', 'self', 'localhost']);
const privateV4 = [
  [0, 0, 255],
  [10, 0, 255],
  [127, 0, 255],
  [169, 254, 254],
  [172, 16, 31],
  [192, 168, 168],
  [100, 64, 127],
];

export class RequestError extends Error {}

function privateIPv4(host) {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return privateV4.some(([first, from, to]) => parts[0] === first && parts[1] >= from && parts[1] <= to);
}

export function isPrivateHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (privateIPv4(host)) return true;
  if (!host.includes(':')) return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
  if (mapped) return privateIPv4(mapped[1]);
  return host === '::' || host === '::1' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host);
}

export function hostAllowed(hostname, connects = []) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return connects
    .map((entry) => String(entry).trim().toLowerCase())
    .filter((entry) => entry && !ignoredConnects.has(entry))
    .some((entry) => host === entry || host.endsWith(`.${entry}`));
}

function checkUrl(value, connects) {
  let url;
  try {
    url = new URL(value);
  } catch (e) {
    throw new RequestError('Invalid url');
  }
  if (url.protocol !== 'https:') throw new RequestError(`Only https requests are allowed (${url.protocol})`);
  if (url.username || url.password) throw new RequestError('Urls with credentials are not allowed');
  if (isPrivateHost(url.hostname)) throw new RequestError(`Requests to local addresses are not allowed (${url.hostname})`);
  if (!hostAllowed(url.hostname, connects)) throw new RequestError(`${url.hostname} is not in the script's @connect list`);
  return url;
}

function checkHeaders(headers) {
  if (headers === undefined || headers === null) return {};
  if (typeof headers !== 'object' || Array.isArray(headers)) throw new RequestError('Headers must be an object');
  const entries = Object.entries(headers);
  if (entries.length > limits.headers) throw new RequestError('Too many headers');
  const result = {};
  for (const [name, value] of entries) {
    if (typeof value !== 'string' || !/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name)) throw new RequestError(`Invalid header ${name}`);
    if (!blockedHeaders.has(name.toLowerCase())) result[name] = value;
  }
  return result;
}

export function checkRequest(details, connects) {
  if (!details || typeof details !== 'object') throw new RequestError('Missing request details');
  const method = String(details.method ?? 'GET').toUpperCase();
  if (!methods.has(method)) throw new RequestError(`Unsupported method ${method}`);
  const url = checkUrl(details.url, connects);
  const data = details.data;
  if (data !== undefined && data !== null && typeof data !== 'string') throw new RequestError('Only text request bodies are supported');
  if (data && bodyless.has(method)) throw new RequestError(`${method} requests cannot have a body`);
  if (data && Buffer.byteLength(data) > limits.body) throw new RequestError('The request body is too large');
  const responseType = details.responseType ?? '';
  if (!types.has(responseType)) throw new RequestError(`Unsupported responseType ${responseType}`);
  const timeout = Number(details.timeout);
  return {
    url,
    method,
    headers: checkHeaders(details.headers),
    body: data || undefined,
    responseType,
    timeout: timeout > 0 ? Math.min(timeout, limits.maxTimeout) : limits.timeout,
  };
}

async function readBody(res, controller) {
  const length = Number(res.headers.get('content-length'));
  if (length > limits.response) {
    controller.abort();
    throw new RequestError('The response is too large');
  }
  if (!res.body) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limits.response) {
      controller.abort();
      throw new RequestError('The response is too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function describe(res, body, responseType, finalUrl) {
  const text = responseType === 'arraybuffer' ? '' : body.toString('utf8');
  let response = text;
  if (responseType === 'arraybuffer') {
    response = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
  } else if (responseType === 'json') {
    try {
      response = JSON.parse(text);
    } catch (e) {
      response = null;
    }
  }
  return {
    readyState: 4,
    status: res.status,
    statusText: res.statusText,
    finalUrl,
    responseHeaders: [...res.headers].map(([name, value]) => `${name}: ${value}`).join('\r\n'),
    response,
    responseText: text,
  };
}

export function createRequester({ fetchImpl = (...args) => fetch(...args) } = {}) {
  return async function request(details, connects, signal) {
    let plan;
    try {
      plan = checkRequest(details, connects);
    } catch (error) {
      return { type: 'error', response: { status: 0, error: error.message } };
    }
    const controller = new AbortController();
    let reason;
    const stop = (why) => {
      reason ??= why;
      controller.abort();
    };
    const timer = setTimeout(() => stop('timeout'), plan.timeout);
    const onAbort = () => stop('abort');
    if (signal?.aborted) onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      let { url, method, body } = plan;
      for (let hop = 0; ; hop++) {
        const res = await fetchImpl(url, {
          method,
          headers: plan.headers,
          body,
          redirect: 'manual',
          signal: controller.signal,
        });
        const location = res.headers.get('location');
        if (res.status >= 300 && res.status < 400 && location) {
          if (hop >= limits.redirects) throw new RequestError('Too many redirects');
          url = checkUrl(new URL(location, url).href, connects);
          if (res.status === 303 || (res.status < 307 && method === 'POST')) {
            method = method === 'HEAD' ? 'HEAD' : 'GET';
            body = undefined;
          }
          continue;
        }
        const buffer = await readBody(res, controller);
        return { type: 'load', response: describe(res, buffer, plan.responseType, url.href) };
      }
    } catch (error) {
      if (reason) return { type: reason, response: { status: 0, error: reason === 'timeout' ? 'Request timed out' : 'Request aborted' } };
      const message = error instanceof RequestError ? error.message : String(error?.cause?.message ?? error?.message ?? error);
      return { type: 'error', response: { status: 0, error: message } };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  };
}
