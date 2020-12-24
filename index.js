const init = require('./src/electron');
const update = require('./src/underscript');

update().then(init);
