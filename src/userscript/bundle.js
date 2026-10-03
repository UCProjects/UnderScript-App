import { gmApi } from './gm.js';
import { matchesUrl } from './match.js';

const infoPattern = /^const GM_info = (\{.*\});$/m;

export function createBundle(meta, script, { requires = [], resources = {}, localResources = {} } = {}) {
  const GM_info = {
    scriptHandler: 'UnderScriptApp',
    script: {
      name: meta.name,
      namespace: meta.namespace,
      version: meta.version,
      description: meta.description,
      author: meta.author,
      matches: meta.matches,
      includes: meta.includes,
      excludes: meta.excludes,
      excludeMatches: meta.excludeMatches,
      grants: meta.grants,
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
    `document.addEventListener('readystatechange', () => {`,
    '  UnderScriptWrapper();',
    '}, { once: true });',
  ].join('\n');
}

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
