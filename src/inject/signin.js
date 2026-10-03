(() => {
  if (location.pathname !== '/SignIn') return;

  function setup() {
    const checkbox = document.querySelector('input[name="stayConnected"]');
    if (!checkbox || typeof underscript === 'undefined') return;
    underscript.lib.tippy(checkbox.parentElement, {
      content: 'Click here to save your username & password!<div style="width:100%;text-align:right;font-size:12px;font-family:monospace;">via UnderScript App</div>',
      showOnInit: !localStorage.getItem('underscript.login.lastUser'),
      placement: 'bottom-start',
      theme: 'undercards',
      animateFill: false,
      ignoreAttributes: true,
      duration: 0,
      arrow: true,
      a11y: false,
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup, { once: true });
  } else {
    setup();
  }
})();
