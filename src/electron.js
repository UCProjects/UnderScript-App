import { app, BrowserWindow, shell, ipcMain } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';
import keytar from 'keytar';
import updater from 'electron-updater';
import contextMenu from 'electron-context-menu';
import checkVersion, { readBundle } from './underscript.js';

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

  function open(url) {
    const target = new URL(url);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return;

    if (target.host === 'undercards.net' || target.host === 'www.undercards.net') {
      target.host = 'undercards.net';
      target.protocol = 'https:';
      win.loadURL(target.href);
    } else if (url.endsWith('undercards.user.js')) {
      update();
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

ipcMain.handle('inject:scripts', async (event) => {
  if (!trusted(event)) return [];
  const bundle = await readBundle();
  if (!bundle) return [];
  const scripts = await Promise.all(['wait.js', 'app.js', 'signin.js'].map((name) => {
    return fs.readFile(path.resolve(app.getAppPath(), 'src', 'inject', name), 'utf8');
  }));
  return [bundle, ...scripts];
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
