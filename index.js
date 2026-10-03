import { app } from 'electron';
import init from './src/electron.js';
import update from './src/underscript.js';

update().then(init).catch((err) => {
  console.error(err);
  app.quit();
});
