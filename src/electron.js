import { app, BrowserWindow, dialog, shell, ipcMain } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import keytar from 'keytar';
import updater from 'electron-updater';
import contextMenu from 'electron-context-menu';
import checkVersion, { readBundle } from './underscript.js';
import { bundleInfo, injectable, runsOn } from './userscript/bundle.js';
import { buildBundle } from './userscript/build.js';
import { download } from './userscript/download.js';
import { scriptId } from './userscript/gm.js';
import { createInstaller, describeResult } from './userscript/install.js';
import { createInstalled } from './userscript/installed.js';
import { createSettings } from './launcher/settings.js';
import { createLauncher } from './launcher/window.js';
import { loadRegistry, registryWarnings } from './userscript/registry.js';
import { rebuildStale } from './userscript/rebuild.js';
import { createRequester } from './userscript/request.js';
import { createStore } from './userscript/store.js';
import { isOffscreen, offscreenSwitches, offscreenWindowOptions } from './offscreen.js';

const { autoUpdater } = updater;

offscreenSwitches.forEach(([name, value]) => app.commandLine.appendSwitch(name, value));

const origin = 'https://undercards.net';
const permissions = new Set([
  'fullscreen',
  'notifications',
  'clipboard-sanitized-write',
]);

function isOrigin(url) {
  try {
    return new URL(url).origin === origin;
  } catch (e) {
    return false;
  }
}

function trusted(event) {
  return isOrigin(event.senderFrame?.url);
}

function createWindow() {
  app.userAgentFallback = app.userAgentFallback.replace(/\s?underscript-app\/\S+/, '');
  const win = new BrowserWindow({
    ...offscreenWindowOptions,
    webPreferences: {
      nodeIntegration: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegrationInSubFrames: true,
      additionalArguments: [`--app-version=${app.getVersion()}`],
    },
    icon: path.resolve(app.getAppPath(), 'src', 'uc.png'),
  });

  ['inject', 'rememberMe', 'zoom'].forEach((name) => {
    win.webContents.session.registerPreloadScript({
      type: 'frame',
      filePath: path.resolve(app.getAppPath(), 'src', 'preload', `${name}.cjs`),
    });
  });

  win.webContents.session.setPermissionRequestHandler((_, permission, callback, details) => {
    callback(permissions.has(permission) && isOrigin(details.requestingUrl));
  });
  win.webContents.session.setPermissionCheckHandler((_, permission, requestingOrigin) => {
    return permissions.has(permission) && isOrigin(requestingOrigin);
  });

  win.webContents.session.webRequest.onHeadersReceived({ urls: [`${origin}/*`] }, (details, callback) => {
    if (details.resourceType !== 'mainFrame' && details.resourceType !== 'subFrame') {
      callback({});
      return;
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          [
            'script-src',
            "'self'",
            "'unsafe-eval'",
            "'unsafe-inline'",
            'https://www.google-analytics.com',
            'https://www.googletagmanager.com',
            'https://*.cloudflare.com',
            ';',
            'worker-src',
            'blob:',
          ].join(' '),
        ],
      }
    });
  });

  function showDevTools() {
    const { webContents } = win;
    if (webContents.isDevToolsOpened()) {
      webContents.devToolsWebContents?.focus();
    } else {
      webContents.openDevTools();
    }
  }

  contextMenu({
    window: win,
    showLookUpSelection: false,
    showSearchWithGoogle: false,
    append: (actions, params, window) => [{
      label: 'Toggle fullscreen',
      click: () => win.setFullScreen(!win.isFullScreen()),
    }, {
      label: 'Manage plugins',
      click: () => getLauncher().show('manager'),
    }, {
      label: 'Open DevTools',
      click: showDevTools,
    }],
  });

  win.loadURL('https://undercards.net/SignIn');
  win.setMenu(null);
  if (!isOffscreen) win.maximize();

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyUp') return;
    if (input.control && input.shift && input.key.toLowerCase() === 'i' || input.key === 'F12') {
      event.preventDefault();
      showDevTools();
    } else if (input.key === 'F5' || input.control && input.key.toLowerCase() === 'r') {
      win.reload();
    } else if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
    } else if (input.control && input.shift && input.key.toLowerCase() === 'p') {
      event.preventDefault();
      getLauncher().show('manager');
    }
  });

  function toast(data) {
    win.webContents.send('toast', data);
  }

  async function update() {
    try {
      if (!await checkVersion()) return;
      toast({
        title: 'Updated UnderScript',
        text: 'Refresh page to finish update',
        refresh: true,
      });
    } catch (error) {
      toast({
        title: 'Error updating UnderScript',
        error,
      });
    }
  }

  async function installPlugin(url) {
    try {
      const result = await getInstaller()(url);
      if (result.status === 'installed') {
        toast({ title: `Installed ${result.name}`, text: 'Refresh the page to load it' });
      } else if (result.status === 'updated') {
        toast({ title: `Updated ${result.name}`, text: `v${result.previousVersion} to v${result.version}. Refresh the page to load it` });
      } else if (result.status === 'rejected') {
        await dialog.showMessageBox(win, {
          type: 'warning',
          title: 'Plugin not installed',
          message: 'That plugin is not in the community plugin list',
          detail: `The app only installs plugins listed in the community registry.\n\n${result.url}`,
        });
      } else if (result.status === 'failed') {
        await dialog.showMessageBox(win, {
          type: 'error',
          title: 'Plugin not installed',
          message: 'The plugin could not be installed',
          detail: String(result.error?.message ?? result.error),
        });
      }
    } catch (error) {
      console.error(error);
    }
  }

  function open(url) {
    const target = new URL(url);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return;

    if (target.host === 'undercards.net' || target.host === 'www.undercards.net') {
      target.host = 'undercards.net';
      target.protocol = 'https:';
      win.loadURL(target.href);
    } else if (url.endsWith('undercards.user.js')) {
      update();
    } else if (target.pathname.endsWith('.user.js')) {
      installPlugin(url);
    } else {
      shell.openExternal(url);
    }
  }

  function navigate(event, url) {
    const { host, protocol } = new URL(url);
    if (host === 'undercards.net' && protocol === 'https:') return;

    event.preventDefault();
    open(url);
  }

  win.webContents.on('will-navigate', (event, url) => {
    if (process.env.LOCAL_DIR) checkVersion().catch(console.error);
    navigate(event, url);
  });
  win.webContents.on('will-redirect', navigate);
  win.webContents.once('did-finish-load', async () => {
    const { length } = await getWarnings();
    if (!length) return;
    toast({
      title: 'Plugin warning',
      text: `${length} installed plugin${length === 1 ? ' needs' : 's need'} a look. Open the plugin manager with Ctrl+Shift+P`,
    });
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    open(url);
    return { action: 'deny' };
  });

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (info) => {
    toast({
      title: 'UnderScript App Update Available',
      text: `Now downloading v${info.version}`,
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    toast({
      title: `UnderScript App Updated: v${info.version}`,
      notes: Array.isArray(info.releaseNotes) ? info.releaseNotes.map(({ note }) => note).join('') : info.releaseNotes,
      text: 'Restart App to finish update',
    });
  });
  if (app.isPackaged) autoUpdater.checkForUpdates().catch(console.error);
}

ipcMain.on('set-password', (event, username, password) => {
  if (!trusted(event) || typeof username !== 'string' || typeof password !== 'string') return;
  keytar.setPassword('UnderScript', username, password);
});

ipcMain.handle('get-password', (event, username) => {
  if (!trusted(event) || typeof username !== 'string') return null;
  return keytar.getPassword('UnderScript', username);
});

let store;
let installed;
const grants = new Map();

function frameKey(event) {
  return `${event.processId}:${event.frameId}`;
}

function grantFor(event, token) {
  if (!trusted(event) || typeof token !== 'string') return undefined;
  return grants.get(frameKey(event))?.get(token);
}

function scriptFor(event, token) {
  return grantFor(event, token)?.id;
}

function getStore() {
  store ??= createStore(path.resolve(app.getPath('userData'), 'scripts', 'values'));
  return store;
}

async function getWarnings() {
  try {
    return registryWarnings(await loadRegistry(), await getInstalled().list());
  } catch (e) {
    return [];
  }
}

function getInstalled() {
  installed ??= createInstalled(path.resolve(app.getPath('userData'), 'scripts', 'plugins'));
  return installed;
}

async function confirmInstall({ kind, name, version, previousVersion, details }) {
  const shown = details.slice(0, 20);
  if (details.length > shown.length) shown.push(`...and ${details.length - shown.length} more`);
  const { response } = await dialog.showMessageBox(BrowserWindow.getFocusedWindow() ?? undefined, kind === 'new' ? {
    type: 'question',
    buttons: ['Install', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Install plugin',
    message: `Install "${name}" v${version}?`,
    detail: `${shown.join('\n')}\n\nPlugins run on undercards.net with access to your account. Only install plugins you trust.`,
  } : {
    type: 'warning',
    buttons: ['Update', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Update plugin',
    message: `"${name}" changed more than its version (v${previousVersion} to v${version})`,
    detail: `${shown.join('\n')}\n\nOnly update if you still trust this plugin.`,
  });
  return response === 0;
}

let installer;

function getInstaller() {
  installer ??= createInstaller({
    loadRegistry,
    fetchScript: (url) => download({ url }),
    build: (source) => buildBundle(source),
    installed: getInstalled(),
    confirm: confirmInstall,
  });
  return installer;
}

async function reinstall(url) {
  return describeResult(await getInstaller()(url));
}

function embedded(event) {
  const frame = event.senderFrame;
  if (!frame?.parent) return false;
  try {
    return new URL(frame.url).protocol === 'https:';
  } catch (e) {
    return false;
  }
}

async function injectEmbedded(event) {
  const plugins = await getInstalled().bundlesFor(event.senderFrame.url);
  return {
    scripts: plugins.map((plugin) => injectable(plugin.bundle, randomUUID())),
    values: {},
  };
}

async function injectGame(event) {
  const none = { scripts: [], values: {} };
  const bundle = await readBundle();
  if (!bundle || !runsOn(bundle, event.senderFrame.url)) return none;
  const plugins = await getInstalled().enabledBundles();
  const infos = [bundle, ...plugins.map((plugin) => plugin.bundle)].map((text) => bundleInfo(text));
  const ids = infos.map((info) => scriptId(info));
  const tokens = ids.map(() => randomUUID());
  grants.set(frameKey(event), new Map(tokens.map((token, index) => [token, {
    id: ids[index],
    connects: Array.isArray(infos[index]?.connects) ? infos[index].connects : [],
  }])));
  const [values, ...scripts] = await Promise.all([
    Promise.all(ids.map(async (id, index) => [tokens[index], await getStore().get(id)])),
    ...['wait.js', 'app.js', 'signin.js'].map((name) => {
      return fs.readFile(path.resolve(app.getAppPath(), 'src', 'inject', name), 'utf8');
    }),
  ]);
  return {
    scripts: [
      injectable(bundle, tokens[0]),
      ...scripts,
      ...plugins.map((plugin, index) => injectable(plugin.bundle, tokens[index + 1])),
    ],
    values: Object.fromEntries(values),
  };
}

ipcMain.handle('inject:scripts', async (event) => {
  if (trusted(event)) return injectGame(event);
  if (embedded(event)) return injectEmbedded(event);
  return { scripts: [], values: {} };
});

const requester = createRequester();
const requests = new Map();
const maxRequests = 10;

ipcMain.handle('gm:request', async (event, token, id, details) => {
  const grant = grantFor(event, token);
  const prefix = `${frameKey(event)}:${token}:`;
  const key = `${prefix}${id}`;
  const refuse = (error) => ({ type: 'error', response: { status: 0, error } });
  if (!grant) return refuse('Requests are not allowed here');
  if (!Number.isInteger(id) || requests.has(key)) return refuse('Invalid request');
  if ([...requests.keys()].filter((entry) => entry.startsWith(prefix)).length >= maxRequests) return refuse('Too many requests at once');
  const controller = new AbortController();
  requests.set(key, controller);
  try {
    return await requester(details, grant.connects, controller.signal);
  } finally {
    requests.delete(key);
  }
});

ipcMain.on('gm:request:abort', (event, token, id) => {
  if (!grantFor(event, token)) return;
  requests.get(`${frameKey(event)}:${token}:${id}`)?.abort();
});

ipcMain.on('gm:set', (event, token, key, raw) => {
  const id = scriptFor(event, token);
  if (id === undefined) return;
  getStore().set(id, key, raw).catch(console.error);
});

ipcMain.on('gm:delete', (event, token, key) => {
  const id = scriptFor(event, token);
  if (id === undefined) return;
  getStore().remove(id, key).catch(console.error);
});

let flushed = false;

app.on('before-quit', (event) => {
  if (flushed || !store) return;
  event.preventDefault();
  store.flush().finally(() => {
    flushed = true;
    app.quit();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});


let launcher;
let launcherSettings;

function getLauncher() {
  launcherSettings ??= createSettings(path.resolve(app.getPath('userData'), 'scripts', 'launcher.json'));
  launcher ??= createLauncher({ getInstalled, getWarnings, reinstall, settings: launcherSettings });
  return launcher;
}

export default async () => {
  await app.whenReady();
  await rebuildStale({ installed: getInstalled() }).catch(console.error);
  const shown = getLauncher();
  if ((await getInstalled().list()).length && (await launcherSettings.read()).showAtStartup) {
    const { outcome, close } = await shown.show('launcher');
    if (outcome !== 'done') {
      app.quit();
      return;
    }
    createWindow();
    close();
    return;
  }
  createWindow();
};
