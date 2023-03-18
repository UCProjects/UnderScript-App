const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const keytar = require('keytar');
const { autoUpdater } = require('electron-updater');
const contextMenu = require('electron-context-menu');
const checkVersion = require('./underscript');
const isDev = require('electron-is-dev');

function createWindow() {
  const win = new BrowserWindow({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: false,
      enableRemoteModule: false,
      worldSafeExecuteJavaScript: false,
      preload: path.resolve(app.getAppPath(), 'src', 'preload', 'index.js'),
    },
    icon: path.resolve(app.getAppPath(), 'src', 'uc.png'),
  });

  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
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
            'https://*.cloudflare.com',
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

  win.webContents.on('will-navigate', (event, url) => {
    if (process.env.LOCAL_DIR) checkVersion().catch(console.error);
    const { host, protocol } = new URL(url);
    if (host === 'undercards.net') return;
    
    event.preventDefault();
    if (protocol !== 'http:' && protocol !== 'https:') return;
    if (host === 'www.undercards.net') {
      win.loadURL(url.replace('www.', ''));
    } else if (url.endsWith('undercards.user.js')) {
      update();
    } else {
      shell.openExternal(url);
    }
  });
  win.webContents.on('new-window', function(e, url) {
    e.preventDefault();
    const { host, protocol } = new URL(url);
    if (protocol !== 'http:' && protocol !== 'https:') return;

    if (host === 'undercards.net' || host === 'www.undercards.net') {
      win.loadURL(url.replace('www.', ''));
    } else if (url.endsWith('undercards.user.js')) {
      update();
    } else {
      shell.openExternal(url);
    }
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
  if (!isDev) autoUpdater.checkForUpdates();
}

ipcMain.on('set-password', (_, username, password) => keytar.setPassword('UnderScript', username, password));

ipcMain.handle('get-password', (_, username) => keytar.getPassword('UnderScript', username));

ipcMain.handle('dir:scripts', () => path.resolve(app.getPath('userData'), 'scripts'));

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});


module.exports = () => app.whenReady().then(() => createWindow());
