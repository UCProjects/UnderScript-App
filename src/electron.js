const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const keytar = require('keytar');

function createWindow(dir = '') {
  const win = new BrowserWindow({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: false,
      enableRemoteModule: false,
    },
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
  
  win.loadURL('https://undercards.net');
  win.setMenu(null);
  win.maximize();

  win.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      event.preventDefault();
      win.webContents.openDevTools();
    } else if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
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
}

ipcMain.on('set-password', (_, username, password) => keytar.setPassword('UnderScript', username, password));

ipcMain.handle('get-password', (_, username) => keytar.getPassword('UnderScript', username));

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});


module.exports = (dir) => app.whenReady().then(() => createWindow(dir));
