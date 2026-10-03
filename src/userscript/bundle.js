const infoPattern = /^const GM_info = (\{.*\});$/m;

export function createBundle({ version }, script, { requires = [], resources = {} } = {}) {
  const GM_info = {
    scriptHandler: 'UnderScriptApp',
    script: { version },
  };
  const names = Object.keys(resources);
  return [
    'function UnderScriptWrapper() {',
    `const GM_info = ${JSON.stringify(GM_info)};`,
    ...names.length
      ? [`const GM_getResourceText = ((map) => (name) => map.get(name))(new Map(${JSON.stringify(Object.entries(resources))}));`]
      : [],
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

export function bundleVersion(bundle) {
  try {
    return JSON.parse(infoPattern.exec(bundle)[1]).script.version;
  } catch (e) {
    return undefined;
  }
}
