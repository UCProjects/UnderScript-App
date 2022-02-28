const { webFrame } = require('electron');

function handle(event) {
  if (!event.ctrlKey) return;
  const adjust = event.deltaY < 0 ? -0.1 : 0.1;
  const factor = Math.max(Math.min(webFrame.getZoomFactor() + adjust, 2), 0.5);
  webFrame.setZoomFactor(factor);
}

document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('wheel', handle, { 
    passive: true,
  });
});
