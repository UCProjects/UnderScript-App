const definitions = {
  GM_getValue: (prefix) => `const GM_getValue = (key, fallback) => {
  try {
    const raw = localStorage.getItem(${prefix} + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
};`,
  GM_setValue: (prefix) => `const GM_setValue = (key, value) => {
  try {
    const raw = JSON.stringify(value);
    if (raw === undefined) {
      localStorage.removeItem(${prefix} + key);
    } else {
      localStorage.setItem(${prefix} + key, raw);
    }
  } catch (e) {
    return;
  }
};`,
  GM_deleteValue: (prefix) => `const GM_deleteValue = (key) => {
  try {
    localStorage.removeItem(${prefix} + key);
  } catch (e) {
    return;
  }
};`,
  GM_listValues: (prefix) => `const GM_listValues = () => {
  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith(${prefix})) keys.push(key.slice(${prefix}.length));
    }
  } catch (e) {
    return keys;
  }
  return keys;
};`,
};

export function storagePrefix({ namespace = '', name = 'unnamed' }) {
  return `GM:${namespace}|${name}:`;
}

export function gmApi(meta) {
  const grants = meta.grants ?? [];
  const prefix = JSON.stringify(storagePrefix(meta));
  return Object.entries(definitions)
    .filter(([name]) => grants.includes(name))
    .map(([, definition]) => definition(prefix));
}
