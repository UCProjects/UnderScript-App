const { app } = require('electron');
const crypto = require('crypto');
const file = require('fs').promises;
const needle = require('needle');
const path = require('path');

const repository = 'UCProjects/UnderScript';
const regex = /^\/\/ @version\s+((?:[0-9]+\.?){3})$/m;

const needleOptions = {
  follow_max: 5,
  open_timeout: 15000,
  read_timeout: 60000,
};

function bundlePath() {
  return path.resolve(app.getPath('userData'), 'scripts', 'underscript.bundle.js');
}

function checkVersion() {
  const localDir = process.env.LOCAL_DIR;
  if (localDir) { // Local testing takes priority
    return loadFiles(path.resolve(localDir)).then(([...args]) => bundleScript(...args));
  }
  return getVersion().then(checkForUpdates);
}

function readBundle() {
  return file.readFile(bundlePath(), 'utf8').catch(() => null);
}

function getVersion() {
  return file.readFile(bundlePath())
    .then((buffer) => regex.exec(String(buffer))[1])
    .catch(() => undefined);
}

function checkForUpdates(localVersion) {
  return getLatestRelease().then((release) => {
    if (release.tag_name !== localVersion) return downloadScript(release);
    return file.readFile(bundlePath()).then(() => false);
  });
}

function getLatestRelease() {
  return needle('get', `https://api.github.com/repos/${repository}/releases/latest`, {
    ...needleOptions,
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'UnderScript-App',
    },
  }).then((res) => {
    if (res.statusCode !== 200) throw new Error(`Unable to find latest release (${res.statusCode})`);
    const { tag_name: tag, assets } = res.body;
    if (typeof tag !== 'string' || !Array.isArray(assets)) throw new Error('Unexpected release response');
    return res.body;
  });
}

function loadFiles(dir) {
  return Promise.all([
    file.readFile(path.resolve(dir, 'dependencies.js')).then((buffer) => String(buffer)),
    file.readFile(path.resolve(dir, 'undercards.user.js')).then((buffer) => String(buffer)),
  ]);
}

function downloadScript(release) {
  return Promise.all([
    downloadAsset(release, 'dependencies.js'),
    downloadAsset(release, 'undercards.user.js'),
  ]).then(([...args]) => bundleScript(...args)).then(() => true);
}

function downloadAsset(release, name) {
  const asset = release.assets.find((a) => a.name === name);
  if (!asset) throw new Error(`Release ${release.tag_name} is missing ${name}`);
  const [algorithm, expected] = String(asset.digest).split(':');
  if (algorithm !== 'sha256' || !expected) throw new Error(`Release ${release.tag_name} has no checksum for ${name}`);

  return needle('get', asset.browser_download_url, {
    ...needleOptions,
    parse_response: false,
    headers: {
      'User-Agent': 'UnderScript-App',
    },
  }).then((res) => {
    if (res.statusCode !== 200) throw new Error(`Unable to download ${name} (${res.statusCode})`);
    const actual = crypto.createHash('sha256').update(res.body).digest('hex');
    if (actual !== expected.toLowerCase()) throw new Error(`Checksum mismatch for ${name}`);
    return String(res.body);
  });
}

function bundleScript(depends, script) {
  const version = regex.exec(script);
  if (!version) throw new Error('Unable to determine UnderScript version');
  const GM_info = {
    scriptHandler: 'UnderScriptApp',
    script: {
      version: version[1],
    },
  };
  const bundle = [
    'function UnderScriptWrapper() {',
    `const GM_info = ${JSON.stringify(GM_info)};`,
    depends,
    // Encapsulate script code!
    '(function () {',
    script,
    '})();',
    '}',
    `document.addEventListener('readystatechange', () => {`,
    '  UnderScriptWrapper();',
    '}, { once: true });',
  ].join('\n');
  const target = bundlePath();
  const temp = `${target}.tmp`;
  return file.mkdir(path.dirname(target), { recursive: true })
    .then(() => file.writeFile(temp, bundle))
    .then(() => file.rename(temp, target))
    .then(() => bundle);
}

module.exports = checkVersion;
module.exports.readBundle = readBundle;
