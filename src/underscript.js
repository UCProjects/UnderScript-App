import { app } from 'electron';
import crypto from 'crypto';
import { promises as file } from 'fs';
import needle from 'needle';
import path from 'path';

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

export default async function checkVersion() {
  const localDir = process.env.LOCAL_DIR;
  if (localDir) { // Local testing takes priority
    const [depends, script] = await loadFiles(path.resolve(localDir));
    return bundleScript(depends, script);
  }
  return checkForUpdates(await getVersion());
}

export async function readBundle() {
  try {
    return await file.readFile(bundlePath(), 'utf8');
  } catch (e) {
    return null;
  }
}

async function getVersion() {
  try {
    return regex.exec(String(await file.readFile(bundlePath())))[1];
  } catch (e) {
    return undefined;
  }
}

async function checkForUpdates(localVersion) {
  const release = await getLatestRelease();
  if (release.tag_name !== localVersion) return downloadScript(release);
  await file.readFile(bundlePath());
  return false;
}

async function getLatestRelease() {
  const res = await needle('get', `https://api.github.com/repos/${repository}/releases/latest`, {
    ...needleOptions,
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'UnderScript-App',
    },
  });
  if (res.statusCode !== 200) throw new Error(`Unable to find latest release (${res.statusCode})`);
  const { tag_name: tag, assets } = res.body;
  if (typeof tag !== 'string' || !Array.isArray(assets)) throw new Error('Unexpected release response');
  return res.body;
}

function loadFiles(dir) {
  return Promise.all([
    file.readFile(path.resolve(dir, 'dependencies.js'), 'utf8'),
    file.readFile(path.resolve(dir, 'undercards.user.js'), 'utf8'),
  ]);
}

async function downloadScript(release) {
  const [depends, script] = await Promise.all([
    downloadAsset(release, 'dependencies.js'),
    downloadAsset(release, 'undercards.user.js'),
  ]);
  await bundleScript(depends, script);
  return true;
}

async function downloadAsset(release, name) {
  const asset = release.assets.find((a) => a.name === name);
  if (!asset) throw new Error(`Release ${release.tag_name} is missing ${name}`);
  const [algorithm, expected] = String(asset.digest).split(':');
  if (algorithm !== 'sha256' || !expected) throw new Error(`Release ${release.tag_name} has no checksum for ${name}`);

  const res = await needle('get', asset.browser_download_url, {
    ...needleOptions,
    parse_response: false,
    headers: {
      'User-Agent': 'UnderScript-App',
    },
  });
  if (res.statusCode !== 200) throw new Error(`Unable to download ${name} (${res.statusCode})`);
  const actual = crypto.createHash('sha256').update(res.body).digest('hex');
  if (actual !== expected.toLowerCase()) throw new Error(`Checksum mismatch for ${name}`);
  return String(res.body);
}

async function bundleScript(depends, script) {
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
  await file.mkdir(path.dirname(target), { recursive: true });
  await file.writeFile(temp, bundle);
  await file.rename(temp, target);
  return bundle;
}
