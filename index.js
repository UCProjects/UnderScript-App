import { app, dialog } from 'electron';
import init from './src/electron.js';
import update, { readBundle } from './src/underscript.js';

(async () => {
  try {
    let failure;
    await update().catch((err) => {
      failure = err;
      console.error(err);
    });
    await init();
    if (failure && !await readBundle()) {
      dialog.showMessageBox({
        type: 'warning',
        title: 'UnderScript',
        message: 'UnderScript could not be downloaded',
        detail: `${failure.cause?.message || failure.cause?.code || failure.message}\n\nThe app will keep running without it. Restart the app to try again.`,
      });
    }
  } catch (err) {
    console.error(err);
    app.quit();
  }
})();
