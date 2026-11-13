import crypto from 'crypto';
import { gmApi } from './gm.js';
import { matchesUrl } from './match.js';

const infoPattern = /^const GM_info = (\{.*\});$/m;

export function createBundle(meta, script, { requires = [], resources = {}, localResources = {} } = {}) {
  const first = (key) => meta.values?.[key]?.[0];
  const GM_info = {
    scriptHandler: 'UnderScriptApp',
    script: {
      name: meta.name,
      namespace: meta.namespace,
      version: meta.version,
      description: meta.description,
      author: meta.author,
      homepage: meta.homepage,
      homepageURL: meta.homepage,
      icon: meta.icon,
      updateURL: meta.updateURL,
      downloadURL: meta.downloadURL,
      supportURL: first('supportURL'),
      copyright: first('copyright'),
      license: first('license'),
      matches: meta.matches,
      includes: meta.includes,
      excludes: meta.excludes,
      excludeMatches: meta.excludeMatches,
      grants: meta.grants,
      connects: meta.connects,
      noframes: meta.noframes,
      runAt: meta.runAt,
    },
  };
  const granted = (meta.grants ?? []).includes('GM_getResourceText') || Object.keys(localResources).length > 0;
  return [
    'function UnderScriptWrapper() {',
    `const GM_info = ${JSON.stringify(GM_info)};`,
    ...granted
      ? [`const GM_getResourceText = ((map) => (name) => map.get(name))(new Map(${JSON.stringify(Object.entries({ ...resources, ...localResources }))}));`]
      : [],
    ...gmApi(meta),
    ...requires.map((code) => `${code}\n;`),
    // Encapsulate script code!
    '(function () {',
    script,
    '})();',
    '}',
    "if (document.readyState === 'loading') {",
    "  document.addEventListener('readystatechange', () => UnderScriptWrapper(), { once: true });",
    '} else {',
    '  UnderScriptWrapper();',
    '}',
  ].join('\n');
}

export function injectable(bundle, token) {
  return [
    '(function () {',
    'const underscriptApp = (() => {',
    '  const bridge = window.underscriptApp;',
    `  const token = ${JSON.stringify(token)};`,
    '  return Object.freeze({',
    '    ...bridge,',
    '    request: (details, callback) => bridge.request(token, details, callback),',
    '    abortRequest: (id) => bridge.abortRequest(token, id),',
    '    getValues: () => bridge.getValues(token),',
    '    setValue: (id, key, raw) => bridge.setValue(token, key, raw),',
    '    deleteValue: (id, key) => bridge.deleteValue(token, key),',
    '  });',
    '})();',
    'const run = () => {',
    `  if ((document.title || '').includes(${JSON.stringify(challengeTitle)}) || typeof window._cf_chl_opt?.cType === 'string') return;`,
    bundle,
    '};',
    "if (document.readyState === 'loading') {",
    "  document.addEventListener('readystatechange', run, { once: true });",
    '} else {',
    '  run();',
    '}',
    '})();',
  ].join('\n');
}

export const challengeTitle = 'Just a moment';

const probeMeta = {
  name: 'probe',
  namespace: 'probe',
  version: '1',
  description: 'probe',
  author: 'probe',
  homepage: 'probe',
  icon: 'probe',
  updateURL: 'probe',
  downloadURL: 'probe',
  values: { supportURL: ['probe'], copyright: ['probe'], license: ['probe'] },
  matches: ['probe'],
  includes: ['probe'],
  excludes: ['probe'],
  excludeMatches: ['probe'],
  grants: ['GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_listValues', 'GM_getResourceText', 'unsafeWindow', 'GM_xmlhttpRequest', 'GM.xmlHttpRequest'],
  connects: ['probe'],
  noframes: true,
  runAt: 'document-idle',
};

export const bundleFormat = crypto
  .createHash('sha256')
  .update(createBundle(probeMeta, 'probe', { requires: ['probe'], resources: { probe: 'probe' } }))
  .digest('hex')
  .slice(0, 16);

export function bundleInfo(bundle) {
  try {
    return JSON.parse(infoPattern.exec(bundle)[1]).script;
  } catch (e) {
    return undefined;
  }
}

export function bundleVersion(bundle) {
  return bundleInfo(bundle)?.version;
}

export function runsOn(bundle, url) {
  const info = bundleInfo(bundle);
  if (!info) return false;
  if (!info.matches && !info.includes) return true;
  return matchesUrl(info, url);
}
