const { app } = require('electron');
const file = require('fs').promises;
const needle = require('needle');
const path = require('path');

const regex = /^\/\/ @version\s+((?:[0-9]+\.?){3})$/gm;

const needleOptions = {
  follow_max: 1,
};

function checkVersion() {
  const localDir = process.env.LOCAL_DIR;
  if (localDir) { // Local testing takes priority
    return loadFiles(path.resolve(localDir)).then(([...args]) => bundleScript(...args));
  }
  return getVersion().then(checkForUpdates);
}

function getVersion() {
  return file.readFile(path.resolve(app.getPath('userData'), 'underscript.bundle.js'))
  .then((buffer) => regex.exec(new String(buffer))[1])
  .catch(() => undefined);
}

function checkForUpdates(localVersion) {
  // Get local version
  return needle('https://unpkg.com/underscript@latest/package.json', needleOptions).then((res) => {
    const version = res.body.version;
    if (version !== localVersion) return downloadScript(version);
    return file.readFile(path.resolve(app.getPath('userData'), 'underscript.bundle.js')).then((buffer) => new String(buffer))
  });
}

function loadFiles(dir) {
  return Promise.all([
    file.readFile(path.resolve(dir, 'dependencies.js')).then((buffer) => new String(buffer)),
    file.readFile(path.resolve(dir, 'undercards.user.js')).then((buffer) => new String(buffer)),
  ]);
}

function downloadScript(version) {
  return Promise.all([
    downloadFile('dependencies.js', version),
    downloadFile('undercards.user.js', version),
  ]).then(([...args]) => bundleScript(...args));
}

function bundleScript(depends, script) {
  if (typeof script !== 'string') {
    script = `${script}`;
  }
  regex.lastIndex = 0; // Reset the regex, just in case
  const GM_info = {
    scriptHandler: 'UnderScriptApp',
    script: {
      version: regex.exec(script)[1],
    },
  };
  const bundle = [
    'function UnderScriptWrapper() {',
    `const GM_info = ${JSON.stringify(GM_info)};`,
    depends,
    script,
    '}',
    'window.addEventListener(\'DOMContentLoaded\', UnderScriptWrapper);',
  ].join('\n');
  return file.writeFile(path.resolve(app.getPath('userData'), 'underscript.bundle.js'), bundle).then(() => bundle);
}

function downloadFile(name, version = 'latest') {
  return needle(`https://unpkg.com/underscript@${version}/dist/${name}`, needleOptions)
    .then((res) => res.body);
}

module.exports = checkVersion;
