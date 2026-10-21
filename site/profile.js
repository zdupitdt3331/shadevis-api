(() => {
  const API = '';
  const STORAGE = 'shadevisuals.token';

  const authCard = document.getElementById('authCard');
  const profileView = document.getElementById('profileView');
  const authStatus = document.getElementById('authStatus');
  const deviceMessage = document.getElementById('deviceMessage');

  const params = new URLSearchParams(location.search);
  if (params.get('token')) {
    localStorage.setItem(STORAGE, params.get('token'));
    history.replaceState(null, '', location.pathname);
  }

  let launcher = { hwid: null, hwidDisplay: null, accounts: [] };

  const token = () => localStorage.getItem(STORAGE) || '';
  const setToken = (value) => value ? localStorage.setItem(STORAGE, value) : localStorage.removeItem(STORAGE);

  const isFile = location.protocol === 'file:';

  async function api(path, options = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    if (token()) headers.Authorization = 'Bearer ' + token();
    let response;
    try {
      response = await fetch(API + path, Object.assign({}, options, { headers }));
    } catch {
      throw new Error(isFile
        ? 'Профиль работает только через сервер. Запусти node server/server.js и открой http://127.0.0.1:8090/profile.html'
        : 'Сервер профиля недоступен — проверь, что он запущен');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Ошибка ' + response.status);
    return data;
  }

  function showAuth() {
    authCard.classList.remove('is-hidden');
    profileView.classList.add('is-hidden');
  }

  function formatHwid(value) {
    return String(value).toUpperCase().replace(/(.{4})(?!$)/g, '$1-');
  }

  function renderProfile(profile) {
    authCard.classList.add('is-hidden');
    profileView.classList.remove('is-hidden');

    document.getElementById('nickText').textContent = profile.nick;
    document.getElementById('avatar').textContent = profile.nick.slice(0, 1).toUpperCase();
    document.getElementById('roleTag').textContent = profile.role.toUpperCase();
    document.getElementById('planTag').textContent = profile.plan || 'Classic';

    const hwidValue = document.getElementById('hwidValue');
    const deviceText = document.getElementById('deviceStatusText');
    const status = document.getElementById('deviceStatus');

    updatePcRow(profile);

    if (profile.hwid) {
      hwidValue.textContent = formatHwid(profile.hwid);
      hwidValue.classList.remove('is-empty');
      status.classList.add('is-ok');
      deviceText.textContent = 'Подтверждён ' + new Date(profile.confirmedAt).toLocaleDateString('ru-RU');
    } else {
      hwidValue.textContent = 'не привязан';
      hwidValue.classList.add('is-empty');
      status.classList.remove('is-ok');
      deviceText.textContent = 'Устройство не подтверждено';
    }
  }

  function updatePcRow(profile) {
    const row = document.querySelector('.pc-row');
    const code = document.getElementById('pcHwid');
    if (!row || !code) return;
    if (!launcher.hwid) {
      code.textContent = launcher.available ? 'HWID лаунчера не найден' : 'лаунчер не найден на этом ПК';
      row.classList.remove('is-match');
      return;
    }
    code.textContent = launcher.hwidDisplay || launcher.hwid;
    const match = profile && profile.hwid === launcher.hwid;
    row.classList.toggle('is-match', Boolean(match));
    const button = document.getElementById('bindPc');
    if (button) button.textContent = match ? 'Привязан к этому ПК' : 'Привязать этот ПК';
    if (button) button.disabled = Boolean(match);
    const input = document.querySelector('#hwidForm input[name="hwid"]');
    if (input && !input.value) input.placeholder = launcher.hwidDisplay || launcher.hwid;
  }

  async function loadLauncher() {
    try {
      const data = await api('/api/launcher');
      launcher = { hwid: data.hwid, hwidDisplay: data.hwidDisplay, available: data.available, accounts: data.accounts || [] };
      updatePcRow(null);
    } catch {
      launcher.available = false;
      updatePcRow(null);
    }
  }

  async function loadProfile() {
    if (!token()) return showAuth();
    try {
      const data = await api('/api/profile');
      renderProfile(data.profile);
    } catch {
      setToken('');
      showAuth();
    }
  }

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((item) => item.classList.toggle('is-active', item === tab));
      const isLogin = tab.dataset.tab === 'login';
      document.getElementById('loginForm').classList.toggle('is-hidden', !isLogin);
      document.getElementById('registerForm').classList.toggle('is-hidden', isLogin);
      authStatus.textContent = '';
    });
  });

  async function submitAuth(form, path) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      authStatus.textContent = '…';
      try {
        const result = await api(path, {
          method: 'POST',
          body: JSON.stringify({ nick: data.get('nick'), password: data.get('password') }),
        });
        setToken(result.token);
        renderProfile(result.profile);
        authStatus.textContent = '';
        form.reset();
      } catch (error) {
        authStatus.textContent = error.message;
      }
    });
  }

  submitAuth(document.getElementById('loginForm'), '/api/login');
  submitAuth(document.getElementById('registerForm'), '/api/register');

  document.getElementById('hwidForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const raw = new FormData(event.target).get('hwid');
    deviceMessage.textContent = '…';
    try {
      const result = await api('/api/profile/hwid', {
        method: 'POST',
        body: JSON.stringify({ hwid: raw }),
      });
      renderProfile(result.profile);
      deviceMessage.textContent = 'Вход подтверждён: ' + result.display;
      event.target.reset();
    } catch (error) {
      deviceMessage.textContent = error.message;
    }
  });

  document.getElementById('copyHwid').addEventListener('click', async () => {
    const text = document.getElementById('hwidValue').textContent;
    if (!text || text === 'не привязан') return;
    try {
      await navigator.clipboard.writeText(text);
      deviceMessage.textContent = 'HWID скопирован';
    } catch {
      deviceMessage.textContent = text;
    }
  });

  document.getElementById('logoutButton').addEventListener('click', async () => {
    try { await api('/api/logout', { method: 'POST' }); } catch {}
    setToken('');
    showAuth();
  });

  document.getElementById('bindPc')?.addEventListener('click', async () => {
    if (!launcher.hwid) return;
    deviceMessage.textContent = '…';
    try {
      const result = await api('/api/profile/hwid', {
        method: 'POST',
        body: JSON.stringify({ hwid: launcher.hwid }),
      });
      renderProfile(result.profile);
      deviceMessage.textContent = 'Этот ПК привязан: ' + (launcher.hwidDisplay || launcher.hwid);
    } catch (error) {
      deviceMessage.textContent = error.message;
    }
  });

  if (isFile) {
    authStatus.textContent = 'Открыт локальный файл: войти можно только через сервер — node server/server.js → http://127.0.0.1:8090/profile.html';
  } else {
    loadLauncher().then(loadProfile);
  }
})();
