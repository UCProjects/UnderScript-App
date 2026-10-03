import { app } from 'electron';
import crypto from 'crypto';
import { promises as file } from 'fs';
import path from 'path';
import { bundleVersion, createBundle } from './userscript/bundle.js';
import { cachedDownload, request } from './userscript/download.js';
import { parseMeta } from './userscript/meta.js';

const repository = 'UCProjects/UnderScript';

function bundlePath() {
  return path.resolve(app.getPath('userData'), 'scripts', 'underscript.bundle.js');
}

export default async function checkVersion() {
  const localDir = process.env.LOCAL_DIR;
  if (localDir) { // Local testing takes priority
    const script = await file.readFile(path.resolve(localDir, 'undercards.user.js'), 'utf8');
    return bundleScript(script, await loadResources());
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
    return bundleVersion(await file.readFile(bundlePath(), 'utf8'));
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
  const res = await request(`https://api.github.com/repos/${repository}/releases/latest`, {
    Accept: 'application/vnd.github+json',
  });
  if (res.status !== 200) throw new Error(`Unable to find latest release (${res.status})`);
  const release = await res.json();
  if (typeof release.tag_name !== 'string' || !Array.isArray(release.assets)) throw new Error('Unexpected release response');
  return release;
}

async function loadResources() {
  const entries = (process.env.LOCAL_RESOURCES || '').split(path.delimiter).filter(Boolean);
  return Object.fromEntries(await Promise.all(entries.map(async (entry) => {
    const split = entry.indexOf('=');
    if (split < 1) throw new Error(`Invalid LOCAL_RESOURCES entry: ${entry}`);
    return [entry.slice(0, split), await file.readFile(path.resolve(entry.slice(split + 1)), 'utf8')];
  })));
}

async function downloadScript(release) {
  await bundleScript(await downloadAsset(release, 'undercards.user.js'));
  return true;
}

async function downloadAsset(release, name) {
  const asset = release.assets.find((a) => a.name === name);
  if (!asset) throw new Error(`Release ${release.tag_name} is missing ${name}`);
  const [algorithm, expected] = String(asset.digest).split(':');
  if (algorithm !== 'sha256' || !expected) throw new Error(`Release ${release.tag_name} has no checksum for ${name}`);

  const res = await request(asset.browser_download_url);
  if (res.status !== 200) throw new Error(`Unable to download ${name} (${res.status})`);
  const body = Buffer.from(await res.arrayBuffer());
  const actual = crypto.createHash('sha256').update(body).digest('hex');
  if (actual !== expected.toLowerCase()) throw new Error(`Checksum mismatch for ${name}`);
  return String(body);
}

async function bundleScript(script, localResources = {}) {
  const meta = parseMeta(script);
  if (!meta?.version) throw new Error('Unable to determine UnderScript version');
  const requires = await Promise.all(meta.requires.map(cachedDownload));
  const resources = Object.fromEntries(await Promise.all(
    Object.entries(meta.resources).map(async ([name, target]) => [name, await cachedDownload(target)]),
  ));
  const bundle = createBundle(meta, script, { requires, resources, localResources });
  const target = bundlePath();
  const temp = `${target}.tmp`;
  await file.mkdir(path.dirname(target), { recursive: true });
  await file.writeFile(temp, bundle);
  await file.rename(temp, target);
  return bundle;
}
