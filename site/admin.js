(() => {
  const STORAGE = 'shadevisuals.token';
  const token = () => localStorage.getItem(STORAGE) || '';
  const gate = document.getElementById('gate');
  const denied = document.getElementById('denied');
  const panel = document.getElementById('panel');
  const rows = document.getElementById('rows');
  const status = document.getElementById('status');
  const search = document.getElementById('search');

  let accounts = [];

  async function api(path, options = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    if (token()) headers.Authorization = 'Bearer ' + token();
    let response;
    try {
      response = await fetch(path, Object.assign({}, options, { headers }));
    } catch {
      throw new Error('Сервер недоступен');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || ('Ошибка ' + response.status));
    return data;
  }

  function show(el) {
    [gate, denied, panel].forEach((node) => node.classList.toggle('is-hidden', node !== el));
  }

  function shortHwid(hwid) {
    if (!hwid) return '—';
    return hwid.slice(0, 8).toUpperCase() + '…' + hwid.slice(-4).toUpperCase();
  }

  function roleSelect(nick, role) {
    const select = document.createElement('select');
    select.className = 'admin__select';
    ['Admin', 'Media', 'User'].forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      if (value === role) option.selected = true;
      select.appendChild(option);
    });
    select.addEventListener('change', () => update(nick, { role: select.value }));
    return select;
  }

  function planSelect(nick, plan) {
    const select = document.createElement('select');
    select.className = 'admin__select';
    ['Classic', 'Classic+Plus', 'None'].forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      if (value === plan) option.selected = true;
      select.appendChild(option);
    });
    select.addEventListener('change', () => update(nick, { plan: select.value }));
    return select;
  }

  function render() {
    const query = search.value.trim().toLowerCase();
    rows.innerHTML = '';
    accounts
      .filter((account) => !query || account.nick.toLowerCase().includes(query))
      .forEach((account) => {
        const tr = document.createElement('tr');

        const nickTd = document.createElement('td');
        nickTd.textContent = account.nick;
        nickTd.className = 'admin__nick';
        tr.appendChild(nickTd);

        const roleTd = document.createElement('td');
        roleTd.appendChild(roleSelect(account.nick, account.role));
        tr.appendChild(roleTd);

        const planTd = document.createElement('td');
        planTd.appendChild(planSelect(account.nick, account.plan));
        tr.appendChild(planTd);

        const hwidTd = document.createElement('td');
        hwidTd.textContent = shortHwid(account.hwid);
        hwidTd.title = account.hwid || '';
        hwidTd.className = 'admin__hwid';
        tr.appendChild(hwidTd);

        const confirmedTd = document.createElement('td');
        confirmedTd.textContent = account.confirmedAt ? new Date(Number(account.confirmedAt)).toLocaleDateString('ru-RU') : '—';
        tr.appendChild(confirmedTd);

        const actionTd = document.createElement('td');
        const reset = document.createElement('button');
        reset.className = 'btn btn--ghost btn--small';
        reset.type = 'button';
        reset.textContent = 'Сбросить HWID';
        reset.disabled = !account.hwid;
        reset.addEventListener('click', () => resetHwid(account.nick));
        actionTd.appendChild(reset);
        tr.appendChild(actionTd);

        rows.appendChild(tr);
      });
  }

  async function update(nick, changes) {
    status.textContent = '…';
    try {
      await api('/api/admin/update', { method: 'POST', body: JSON.stringify(Object.assign({ nick }, changes)) });
      const target = accounts.find((a) => a.nick === nick);
      if (target) Object.assign(target, changes);
      status.textContent = 'Сохранено: ' + nick;
      render();
    } catch (error) {
      status.textContent = error.message;
      load();
    }
  }

  async function resetHwid(nick) {
    status.textContent = '…';
    try {
      await api('/api/admin/reset-hwid', { method: 'POST', body: JSON.stringify({ nick }) });
      status.textContent = 'HWID сброшен: ' + nick;
      await load(false);
    } catch (error) {
      status.textContent = error.message;
    }
  }

  async function load(showStatus = true) {
    if (!token()) return show(gate);
    try {
      const me = await api('/api/admin/me');
      if (!me.admin) {
        document.getElementById('deniedText').textContent = 'Аккаунт ' + me.nick + ' (роль ' + me.role + ') без прав Admin.';
        return show(denied);
      }
      const data = await api('/api/admin/accounts');
      accounts = data.accounts || [];
      document.getElementById('adminSub').textContent = accounts.length + ' аккаунтов · база: ' + data.backend + ' · админ: ' + data.admin;
      show(panel);
      render();
      if (showStatus) status.textContent = '';
    } catch (error) {
      if (String(error.message).includes('401')) return show(gate);
      document.getElementById('deniedText').textContent = error.message;
      show(denied);
    }
  }

  document.getElementById('refresh').addEventListener('click', () => load());
  search.addEventListener('input', render);
  load();
})();
