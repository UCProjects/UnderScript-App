const { app } = require('electron');
const init = require('./src/electron');
const update = require('./src/underscript');

update().then(init).catch((err) => {
  console.error(err);
  app.quit();
});
