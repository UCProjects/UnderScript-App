(() => new Promise((resolve) => {
  const started = Date.now();
  const timer = setInterval(() => {
    if (typeof underscript !== 'undefined' || Date.now() - started > 15000) {
      clearInterval(timer);
      resolve();
    }
  }, 25);
}))();
