const store = (id) => `const __GM_store = ((id) => {
  const api = typeof underscriptApp === 'object' ? underscriptApp : {};
  const map = new Map(Object.entries(api.getValues ? api.getValues(id) : {}));
  return {
    map,
    set: (key, raw) => {
      map.set(key, raw);
      if (api.setValue) api.setValue(id, key, raw);
    },
    remove: (key) => {
      map.delete(key);
      if (api.deleteValue) api.deleteValue(id, key);
    },
  };
})(${JSON.stringify(id)});`;

const definitions = {
  GM_getValue: `const GM_getValue = (key, fallback) => {
  const raw = __GM_store.map.get(String(key));
  if (raw === undefined) return fallback;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
};`,
  GM_setValue: `const GM_setValue = (key, value) => {
  const raw = JSON.stringify(value);
  if (raw === undefined) {
    __GM_store.remove(String(key));
  } else {
    __GM_store.set(String(key), raw);
  }
};`,
  GM_deleteValue: `const GM_deleteValue = (key) => {
  __GM_store.remove(String(key));
};`,
  GM_listValues: `const GM_listValues = () => [...__GM_store.map.keys()];`,
  unsafeWindow: 'const unsafeWindow = window;',
};

const values = ['GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_listValues'];

const request = [
  'const __GM_request = (details, finish) => {',
  "  const api = typeof underscriptApp === 'object' ? underscriptApp : {};",
  '  const { method, url, headers, data, timeout, responseType } = details;',
  '  try {',
  '    const id = api.request({ method, url, headers, data, timeout, responseType }, finish);',
  '    return { abort: () => api.abortRequest(id) };',
  '  } catch (e) {',
  "    Promise.resolve().then(() => finish('error', { status: 0, error: 'Requests are not available' }));",
  '    return { abort: () => {} };',
  '  }',
  '};',
  'const __GM_xhr = (details = {}) => __GM_request(details, (type, response) => {',
  '  const handler = details[`on${type}`];',
  "  if (typeof handler !== 'function') return;",
  '  try {',
  '    handler(response);',
  '  } catch (e) {',
  '    console.error(e);',
  '  }',
  '});',
].join('\n');

const promiseRequest = [
  'const GM = {',
  '  xmlHttpRequest: (details = {}) => {',
  '    let control;',
  '    const promise = new Promise((resolve, reject) => {',
  '      const settle = (name, done) => (response) => {',
  '        try {',
  "          if (typeof details[name] === 'function') details[name](response);",
  '        } finally {',
  '          done(response);',
  '        }',
  '      };',
  '      control = __GM_xhr({',
  '        ...details,',
  "        onload: settle('onload', resolve),",
  "        onerror: settle('onerror', reject),",
  "        ontimeout: settle('ontimeout', reject),",
  "        onabort: settle('onabort', reject),",
  '      });',
  '    });',
  '    promise.abort = () => control.abort();',
  '    return promise;',
  '  },',
  '};',
].join('\n');

function requestApi(grants) {
  return [
    request,
    ...grants.includes('GM_xmlhttpRequest') ? ['const GM_xmlhttpRequest = __GM_xhr;'] : [],
    ...grants.includes('GM.xmlHttpRequest') ? [promiseRequest] : [],
  ];
}

export function scriptId({ namespace = '', name = 'unnamed' } = {}) {
  return `${namespace}|${name}`;
}

export function gmApi(meta) {
  const grants = meta.grants ?? [];
  const granted = Object.entries(definitions).filter(([name]) => grants.includes(name));
  const needsStore = values.some((name) => grants.includes(name));
  const needsRequest = ['GM_xmlhttpRequest', 'GM.xmlHttpRequest'].some((name) => grants.includes(name));
  return [
    ...needsStore ? [store(scriptId(meta))] : [],
    ...granted.map(([, definition]) => definition),
    ...needsRequest ? requestApi(grants) : [],
  ];
}
