const { app, BrowserWindow } = require('electron');
const path = require('path');

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
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});


module.exports = (dir) => app.whenReady().then(() => createWindow(dir));
