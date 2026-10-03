const { ipcRenderer } = require('electron');

function getPassword(username) {
  return ipcRenderer.invoke('get-password', username);
}

function setPassword(username, password) {
  ipcRenderer.send('set-password', username, password);
}

function setup() {
  const form = document.querySelector('form[action="SignIn"]');
  const username = document.querySelector('input[name="login"]');
  const password = document.querySelector('input[name="password"]');
  if (!form) return;

  async function updatePassword(user) {
    if (!user) return;
    const value = await getPassword(user);
    if (value) {
      username.value = user;
      password.value = value;
    }
  }

  form.addEventListener('submit', () => {
    const save = document.querySelector('input[name="stayConnected"]').checked;
    const user = username.value;
    const pass = password.value;

    if (save && user && pass) {
      localStorage.setItem('underscript.login.lastUser', user);
      setPassword(user, pass);
    }
  });

  password.addEventListener('focus', () => updatePassword(username.value));

  updatePassword(localStorage.getItem('underscript.login.lastUser'));
}

if (location.pathname === '/SignIn') document.addEventListener('DOMContentLoaded', setup);
