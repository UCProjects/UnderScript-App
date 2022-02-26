const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const keytar = require('keytar');
const { autoUpdater } = require('electron-updater');
const contextMenu = require('electron-context-menu');

function createWindow() {
  const win = new BrowserWindow({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: false,
      enableRemoteModule: false,
    },
    icon: path.resolve(app.getAppPath(), 'src', 'uc.png'),
  });

  win.webContents.session.setPreloads([
    path.resolve(app.getPath('userData'), 'underscript.bundle.js'),
    path.resolve(app.getAppPath(), 'src', 'preload', 'rememberMe.js'),
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
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      event.preventDefault();
      win.webContents.openDevTools();
    } else if (input.key === 'F5' || input.control && input.key.toLowerCase() === 'r') {
      win.reload();
    }
  });

  win.webContents.on('will-navigate', (event, url) => {
    const { host } = new URL(url);
    if (host === 'undercards.net') return;
    
    event.preventDefault();
    if (host === 'www.undercards.net') {
      win.loadURL(url.replace('www.', ''));
    } else if (host === 'unpkg.com' && url.endsWith('undercards.user.js')) {
      // Trigger update
    } else {
      shell.openExternal(url);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    // win.webContents.send('message', 'Restart to update.');
  })

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
