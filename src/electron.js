import { app, BrowserWindow, dialog, shell, ipcMain } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';
import keytar from 'keytar';
import updater from 'electron-updater';
import contextMenu from 'electron-context-menu';
import checkVersion, { readBundle } from './underscript.js';
import { bundleInfo, runsOn } from './userscript/bundle.js';
import { buildBundle } from './userscript/build.js';
import { download } from './userscript/download.js';
import { scriptId } from './userscript/gm.js';
import { createInstaller } from './userscript/install.js';
import { createInstalled } from './userscript/installed.js';
import { loadRegistry } from './userscript/registry.js';
import { createStore } from './userscript/store.js';

const { autoUpdater } = updater;

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
    webPreferences: {
      nodeIntegration: false,
      sandbox: true,
      contextIsolation: true,
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

  contextMenu({
    window: win,
    showLookUpSelection: false,
    showSearchWithGoogle: false,
    append: (actions, params, window) => [{
      label: 'Toggle fullscreen',
      click: () => win.setFullScreen(!win.isFullScreen()),
    }],
  });

  win.loadURL('https://undercards.net/SignIn');
  win.setMenu(null);
  win.maximize();

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyUp') return;
    if (input.control && input.shift && input.key.toLowerCase() === 'i' || input.key === 'F12') {
      event.preventDefault();
      win.webContents.openDevTools();
    } else if (input.key === 'F5' || input.control && input.key.toLowerCase() === 'r') {
      win.reload();
    } else if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
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

  async function confirmInstall({ kind, name, version, previousVersion, details }) {
    const shown = details.slice(0, 20);
    if (details.length > shown.length) shown.push(`...and ${details.length - shown.length} more`);
    const { response } = await dialog.showMessageBox(win, kind === 'new' ? {
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

  const installer = createInstaller({
    loadRegistry,
    fetchScript: (url) => download({ url }),
    build: (source) => buildBundle(source),
    installed: getInstalled(),
    confirm: confirmInstall,
  });

  async function installPlugin(url) {
    try {
      const result = await installer(url);
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
const served = new Set();

function getStore() {
  store ??= createStore(path.resolve(app.getPath('userData'), 'scripts', 'values'));
  return store;
}

function getInstalled() {
  installed ??= createInstalled(path.resolve(app.getPath('userData'), 'scripts', 'plugins'));
  return installed;
}

ipcMain.handle('inject:scripts', async (event) => {
  const none = { scripts: [], values: {} };
  if (!trusted(event)) return none;
  const bundle = await readBundle();
  if (!bundle || !runsOn(bundle, event.senderFrame.url)) return none;
  const plugins = await getInstalled().bundlesFor(event.senderFrame.url);
  const ids = [bundle, ...plugins.map((plugin) => plugin.bundle)].map((text) => scriptId(bundleInfo(text)));
  ids.forEach((id) => served.add(id));
  const [values, ...scripts] = await Promise.all([
    Promise.all(ids.map(async (id) => [id, await getStore().get(id)])),
    ...['wait.js', 'app.js', 'signin.js'].map((name) => {
      return fs.readFile(path.resolve(app.getAppPath(), 'src', 'inject', name), 'utf8');
    }),
  ]);
  return {
    scripts: [bundle, ...scripts, ...plugins.map((plugin) => plugin.bundle)],
    values: Object.fromEntries(values),
  };
});

ipcMain.on('gm:set', (event, id, key, raw) => {
  if (!trusted(event) || !served.has(id)) return;
  getStore().set(id, key, raw).catch(console.error);
});

ipcMain.on('gm:delete', (event, id, key) => {
  if (!trusted(event) || !served.has(id)) return;
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


export default async () => {
  await app.whenReady();
  createWindow();
};
