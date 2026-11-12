import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { diffLines } from '../userscript/diff.js';

const sourceLimit = 2 * 1024 * 1024;

function pick({ kind, name, version, previousVersion, info, changes, script, previous }) {
  return {
    kind,
    name,
    version,
    previousVersion,
    info,
    changes,
    hasSource: typeof script === 'string',
    canDiff: typeof script === 'string' && typeof previous === 'string',
  };
}

export function createConfirmation() {
  let current;
  let details;
  let sources;
  let finish;
  let queue = Promise.resolve();

  const isCurrent = (event) => current && !current.isDestroyed() && event.sender === current.webContents;

  ipcMain.handle('confirm:details', (event) => (isCurrent(event) ? details : undefined));

  ipcMain.handle('confirm:source', (event) => {
    if (!isCurrent(event) || typeof sources?.script !== 'string') return undefined;
    const { script } = sources;
    const truncated = script.length > sourceLimit;
    return { text: truncated ? script.slice(0, sourceLimit) : script, truncated, total: script.length };
  });

  ipcMain.handle('confirm:diff', (event) => {
    if (!isCurrent(event) || typeof sources?.script !== 'string' || typeof sources.previous !== 'string') return undefined;
    return diffLines(sources.previous, sources.script);
  });

  ipcMain.on('confirm:answer', (event, accepted) => {
    if (isCurrent(event) && finish) finish(accepted === true);
  });

  function open(request, parent) {
    return new Promise((resolve) => {
      details = pick(request);
      sources = { script: request.script, previous: request.previous };
      const hasParent = Boolean(parent) && !parent.isDestroyed();
      const win = new BrowserWindow({
        width: 560,
        height: 680,
        minWidth: 440,
        minHeight: 460,
        show: false,
        parent: hasParent ? parent : undefined,
        modal: hasParent,
        title: request.kind === 'changed' ? 'Update plugin' : 'Install plugin',
        icon: path.resolve(app.getAppPath(), 'src', 'uc.png'),
        webPreferences: {
          partition: 'plugin-confirm',
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          preload: path.resolve(app.getAppPath(), 'src', 'preload', 'confirm.cjs'),
        },
      });
      current = win;
      let settled = false;
      const settle = (accepted) => {
        if (settled) return;
        settled = true;
        finish = undefined;
        resolve(accepted);
      };
      finish = (accepted) => {
        settle(accepted);
        if (!win.isDestroyed()) win.close();
      };
      win.setMenu(null);
      win.webContents.session.setPermissionRequestHandler((_, __, callback) => callback(false));
      win.webContents.on('will-navigate', (event) => event.preventDefault());
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.on('closed', () => {
        if (current === win) current = undefined;
        settle(false);
      });
      win.loadFile(path.resolve(app.getAppPath(), 'src', 'launcher', 'confirm.html'));
      win.once('ready-to-show', () => win.show());
    });
  }

  return function confirm(request, parent) {
    const run = queue.then(() => open(request, parent));
    queue = run.catch(() => {});
    return run;
  };
}
