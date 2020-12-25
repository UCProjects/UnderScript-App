const { ipcRenderer } = require('electron')

function setup() {
  const form = document.querySelector('form[action="SignIn"]');
  const username = document.querySelector('input[name="login"]');
  const password = document.querySelector('input[name="password"]');
  form.addEventListener('submit', () => {
    const save = document.querySelector('input[name="stayConnected"]').checked;
    const user = username.value;
    const pass = password.value;

    if (save && user && pass) {
      localStorage.setItem('underscript.login.lastUser', user);
      setPassword(user, pass);
    }
  });

  password.addEventListener('focus', () => {
    const user = username.value;
    if (user) getPassword(user).then((value) => password.value = (value || ''));
  });

  const lastUser = localStorage.getItem('underscript.login.lastUser');
  if (lastUser) {
    getPassword(lastUser).then((value) => {
      if (value) {
        username.value = lastUser;
        password.value = value;
      }
    });
  }
}

function getPassword(username) {
  return ipcRenderer.invoke('get-password', username);
}

function setPassword(username, password) {
  ipcRenderer.send('set-password', username, password);
}

if (location.pathname === '/SignIn') window.addEventListener('DOMContentLoaded', setup);
