const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const keytar = require('keytar');
const { autoUpdater } = require('electron-updater');
const contextMenu = require('electron-context-menu');
const checkVersion = require('./underscript');

const origin = 'https://undercards.net';
const permissions = new Set([
  'fullscreen',
  'notifications',
  'clipboard-sanitized-write',
]);

function trusted(event) {
  try {
    return new URL(event.senderFrame.url).origin === origin;
  } catch (e) {
    return false;
  }
}

function createWindow() {
  app.userAgentFallback = app.userAgentFallback.replace(/\s?underscript-app\/\S+/, '');
  const win = new BrowserWindow({
    webPreferences: {
      nodeIntegration: false,
      sandbox: false,
      contextIsolation: false,
      enableRemoteModule: false,
      worldSafeExecuteJavaScript: false,
      preload: path.resolve(app.getAppPath(), 'src', 'preload', 'index.js'),
    },
    icon: path.resolve(app.getAppPath(), 'src', 'uc.png'),
  });

  win.webContents.session.setPermissionRequestHandler((_, permission, callback, details) => {
    callback(permissions.has(permission) && details.requestingUrl.startsWith(`${origin}/`));
  });
  win.webContents.session.setPermissionCheckHandler((_, permission, requestingOrigin) => {
    return permissions.has(permission) && requestingOrigin === origin;
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

  function update() {
    checkVersion().then((updated) => {
      if (!updated) return;
      toast({
        title: 'Updated UnderScript',
        text: 'Refresh page to finish update',
        refresh: true,
      });
    }).catch((error) => {
      toast({
        title: 'Error updating UnderScript',
        error,
      });
    });
  }

  function navigate(event, url) {
    const { host, protocol } = new URL(url);
    if (host === 'undercards.net' && protocol === 'https:') return;

    event.preventDefault();
    if (protocol !== 'http:' && protocol !== 'https:') return;
    if (host === 'undercards.net' || host === 'www.undercards.net') {
      win.loadURL(url.replace('www.', '').replace(/^http:/, 'https:'));
    } else if (url.endsWith('undercards.user.js')) {
      update();
    } else {
      shell.openExternal(url);
    }
  }
  win.webContents.on('will-navigate', (event, url) => {
    if (process.env.LOCAL_DIR) checkVersion().catch(console.error);
    navigate(event, url);
  });
  win.webContents.on('will-redirect', navigate);
  win.webContents.setWindowOpenHandler(({ url }) => {
    const { host, protocol } = new URL(url);
    if (protocol !== 'http:' && protocol !== 'https:') return { action: 'deny' };

    if (host === 'undercards.net' || host === 'www.undercards.net') {
      win.loadURL(url.replace('www.', ''));
    } else if (url.endsWith('undercards.user.js')) {
      update();
    } else {
      shell.openExternal(url);
    }
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
      text: `${info.releaseNotes}\n\nRestart App to finish update`
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

ipcMain.handle('dir:scripts', () => path.resolve(app.getPath('userData'), 'scripts'));

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});


module.exports = () => app.whenReady().then(() => createWindow());
