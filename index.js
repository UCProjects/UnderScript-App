import { app } from 'electron';
import init from './src/electron.js';
import update from './src/underscript.js';

(async () => {
  try {
    await update();
    await init();
  } catch (err) {
    console.error(err);
    app.quit();
  }
})();
