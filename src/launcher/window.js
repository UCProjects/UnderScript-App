import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';

export function createLauncher({ getInstalled, settings }) {
  let current;
  let finish;

  const isCurrent = (event) => current && !current.isDestroyed() && event.sender === current.webContents;

  ipcMain.handle('plugins:list', async (event) => {
    if (!isCurrent(event)) return [];
    const records = await getInstalled().list();
    return records.map(({ url, name, version, enabled }) => ({ url, name, version, enabled }));
  });

  ipcMain.handle('plugins:enable', async (event, url, enabled) => {
    if (!isCurrent(event) || typeof url !== 'string') return false;
    return getInstalled().setEnabled(url, enabled === true);
  });

  ipcMain.handle('plugins:remove', async (event, url) => {
    if (!isCurrent(event) || typeof url !== 'string') return false;
    return getInstalled().remove(url);
  });

  ipcMain.handle('plugins:show-at-startup', async (event) => {
    return isCurrent(event) ? (await settings.read()).showAtStartup : true;
  });

  ipcMain.handle('plugins:set-show-at-startup', async (event, value) => {
    if (!isCurrent(event) || typeof value !== 'boolean') return false;
    await settings.write({ showAtStartup: value });
    return true;
  });

  ipcMain.on('plugins:done', (event) => {
    if (isCurrent(event) && finish) finish('done');
  });

  return {
    show(mode = 'launcher') {
      if (current && !current.isDestroyed()) {
        current.focus();
        return Promise.resolve({ outcome: 'focused', close() {} });
      }
      const win = new BrowserWindow({
        width: 520,
        height: 580,
        minWidth: 400,
        minHeight: 360,
        show: false,
        title: 'UnderScript Plugins',
        icon: path.resolve(app.getAppPath(), 'src', 'uc.png'),
        webPreferences: {
          partition: 'plugin-manager',
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          preload: path.resolve(app.getAppPath(), 'src', 'preload', 'launcher.cjs'),
        },
      });
      current = win;
      win.setMenu(null);
      win.webContents.session.setPermissionRequestHandler((_, __, callback) => callback(false));
      win.webContents.on('will-navigate', (event) => event.preventDefault());
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.loadFile(path.resolve(app.getAppPath(), 'src', 'launcher', 'index.html'), { query: { mode } });
      win.once('ready-to-show', () => win.show());

      return new Promise((resolve) => {
        finish = (outcome) => {
          finish = undefined;
          resolve({
            outcome,
            close() {
              if (!win.isDestroyed()) win.close();
            },
          });
          if (mode === 'manager' && !win.isDestroyed()) win.close();
        };
        win.on('closed', () => {
          if (current === win) current = undefined;
          if (finish) finish('closed');
        });
      });
    },
  };
}
