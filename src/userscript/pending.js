export const pendingPrefix = 'underscript.pending.';

export function pruneScript(plugins) {
  const stopped = plugins
    .filter(({ enabled }) => enabled === false)
    .map(({ name, version }) => ({ name, version }));
  if (!stopped.length) return '';
  return [
    '(() => {',
    `  const installed = ${JSON.stringify(stopped)};`,
    '  installed.forEach(({ name, version }) => {',
    `    const key = ${JSON.stringify(pendingPrefix)} + name;`,
    '    try {',
    '      const pending = JSON.parse(localStorage.getItem(key));',
    '      if (!pending || typeof pending !== \'object\') return;',
    '      const recorded = pending.version === undefined || pending.version === version;',
    '      if (!recorded || pending.newVersion === version) localStorage.removeItem(key);',
    '    } catch (e) {',
    '      return;',
    '    }',
    '  });',
    '})();',
  ].join('\n');
}
