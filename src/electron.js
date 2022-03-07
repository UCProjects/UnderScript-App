const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const keytar = require('keytar');
const { autoUpdater } = require('electron-updater');
const contextMenu = require('electron-context-menu');
const checkVersion = require('./underscript');

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

  // TODO: make a script manager, instead of using this thing
  win.webContents.session.setPreloads([
    path.resolve(app.getPath('userData'), 'scripts', 'underscript.bundle.js'),
  ]);

  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ['script-src \'self\' \'unsafe-eval\' \'unsafe-inline\' https://www.google-analytics.com'],
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

  autoUpdater.on('update-downloaded', (info) => {
    toast('Restart to update.');
  });

  autoUpdater.checkForUpdatesAndNotify();
}

ipcMain.on('set-password', (_, username, password) => keytar.setPassword('UnderScript', username, password));

ipcMain.handle('get-password', (_, username) => keytar.getPassword('UnderScript', username));

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});


module.exports = () => app.whenReady().then(() => createWindow());
