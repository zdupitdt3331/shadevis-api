'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const store = require('./store');

const PORT = Number(process.env.PORT || 8090);
const SITE_DIR = process.env.SITE_DIR
  || (fs.existsSync(path.join(__dirname, '..', 'site')) ? path.join(__dirname, '..', 'site') : path.join(__dirname, 'site'));
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'accounts.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

fs.mkdirSync(DATA_DIR, { recursive: true });



function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  cors(res);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, useSalt, 120000, 32, 'sha256').toString('hex');
  return { salt: useSalt, hash };
}




function normalizeHwid(value) {
  const clean = String(value || '').replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  return clean.length === 64 ? clean : null;
}

function formatHwid(hwid) {
  return hwid.toUpperCase().replace(/(.{4})(?!$)/g, '$1-');
}


// ---------- support chat ----------
const SUPPORT_FILE = path.join(DATA_DIR, 'support.json');
const SUPPORT_TOKEN = process.env.SUPPORT_BOT_TOKEN || '8956579827:AAHo-nHHU69HKA9UPlYa6htjVxk_bo1K-6c';
const TG = 'https://api.telegram.org/bot' + SUPPORT_TOKEN;

function loadSupport() {
  try {
    return JSON.parse(fs.readFileSync(SUPPORT_FILE, 'utf8'));
  } catch {
    return { ownerChatId: null, lastUpdateId: 0, threads: {}, inbox: {} };
  }
}

function saveSupport(state) {
  fs.writeFileSync(SUPPORT_FILE, JSON.stringify(state, null, 2));
}

let supportState = loadSupport();

async function tg(method, payload) {
  const response = await fetch(TG + '/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  return response.json().catch(() => ({ ok: false }));
}

function supportThread(nick) {
  const key = String(nick || '').toLowerCase();
  if (!supportState.threads[key]) supportState.threads[key] = { messages: [], cursor: 0 };
  return supportState.threads[key];
}

function pushSupportMessage(nick, from, text) {
  const thread = supportThread(nick);
  thread.cursor += 1;
  thread.messages.push({ id: thread.cursor, from, text, at: Date.now() });
  if (thread.messages.length > 200) thread.messages.splice(0, thread.messages.length - 200);
  saveSupport(supportState);
  return thread.cursor;
}

async function pollSupport() {
  try {
    const params = supportState.lastUpdateId ? '?offset=' + (supportState.lastUpdateId + 1) + '&timeout=0' : '?timeout=0';
    const response = await fetch(TG + '/getUpdates' + params);
    const data = await response.json();
    if (!data.ok || !Array.isArray(data.result)) return;
    for (const update of data.result) {
      supportState.lastUpdateId = Math.max(supportState.lastUpdateId, update.update_id);
      const message = update.message;
      if (!message || !message.text) continue;
      const chatId = message.chat && message.chat.id;
      if (supportState.ownerChatId && Number(chatId) !== Number(supportState.ownerChatId)) continue;
      if (!supportState.ownerChatId) {
        supportState.ownerChatId = chatId;
      }
      const replyTo = message.reply_to_message && message.reply_to_message.message_id;
      let nick = null;
      if (replyTo && supportState.inbox[String(replyTo)]) nick = supportState.inbox[String(replyTo)];
      if (!nick && message.text.startsWith('#')) nick = message.text.split(' ')[0].slice(1);
      if (!nick) {
        await tg('sendMessage', { chat_id: chatId, text: 'Ответь реплаем на сообщение пользователя или начни текст с #ника.', reply_to_message_id: message.message_id });
        continue;
      }
      const clean = message.text.replace(/^#[^\s]+\s*/, '');
      pushSupportMessage(nick, 'support', clean);
    }
    saveSupport(supportState);
  } catch {
    // network hiccup, next tick
  }
}

setInterval(pollSupport, 4000);

// ---------- launcher integration ----------
const LAUNCHER_DIR = path.join(process.env.APPDATA || '', 'ShadeVis');

function launcherHwid() {
  try {
    const raw = fs.readFileSync(path.join(LAUNCHER_DIR, 'hwid.txt'), 'utf8').trim();
    return normalizeHwid(raw);
  } catch {
    return null;
  }
}

function launcherAccounts() {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(LAUNCHER_DIR, 'accounts.json'), 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function launcherAccount(nick) {
  const key = String(nick || '').toLowerCase();
  return launcherAccounts().find((item) => String(item.Nick || '').toLowerCase() === key) || null;
}

function launcherPasswordOk(record, password) {
  try {
    const salt = Buffer.from(String(record.Salt || ''), 'base64');
    const expected = Buffer.from(String(record.Hash || ''), 'base64');
    if (!salt.length || !expected.length) return false;
    const actual = crypto.pbkdf2Sync(String(password || ''), salt, 120000, expected.length, 'sha256');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function adoptLauncherAccount(record) {
  const hwid = launcherHwid();
  const account = {
    nick: record.Nick,
    salt: '',
    hash: '',
    launcher: true,
    role: record.Role || 'User',
    plan: 'Classic',
    hwid,
    confirmedAt: hwid ? Date.now() : null,
    createdAt: Date.now(),
  };
  return account;
}

function sitePasswordOk(account, password) {
  if (account.launcher) return false;
  const { hash } = hashPassword(String(password || ''), account.salt);
  return hash === account.hash;
}


function publicProfile(account) {
  return {
    nick: account.nick,
    role: account.role || 'User',
    plan: account.plan || 'Classic',
    hwid: account.hwid || null,
    confirmed: Boolean(account.confirmedAt),
    confirmedAt: account.confirmedAt || null,
    createdAt: account.createdAt || null,
    admin: isAdminAccount(account),
  };
}

async function issueToken(nick) {
  const token = crypto.randomBytes(32).toString('hex');
  await store.createSession(token, nick, Date.now() + 30 * 24 * 3600 * 1000);
  return token;
}

function isAdminAccount(account) {
  if (!account) return false;
  if (String(account.role || '').toLowerCase() === 'admin') return true;
  const owner = (process.env.ADMIN_NICK || 'art1x').toLowerCase();
  return String(account.nick || '').toLowerCase() === owner;
}

async function requireAdmin(req) {
  const account = await authAccount(req);
  if (!account || !isAdminAccount(account)) return null;
  return account;
}

async function authAccount(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const session = await store.findSession(token);
  if (!session || session.expiresAt < Date.now()) return null;
  return store.findAccount(session.nick);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const route = url.pathname;

  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (route === '/api/register' && req.method === 'POST') {
      const body = await readBody(req);
      const nick = String(body.nick || '').trim();
      const password = String(body.password || '');
      if (!/^[A-Za-z0-9_]{3,16}$/.test(nick)) return json(res, 400, { error: 'Ник: 3-16 символов, латиница, цифры и _' });
      if (password.length < 6) return json(res, 400, { error: 'Пароль минимум 6 символов' });

      if (await store.findAccount(nick)) {
        return json(res, 409, { error: 'Этот ник уже занят — войди в аккаунт' });
      }

      const launcher = launcherAccount(nick);
      if (launcher) {
        if (!launcherPasswordOk(launcher, password)) {
          return json(res, 409, { error: 'Ник занят аккаунтом лаунчера — входи с его паролем' });
        }
        const adopted = await store.createAccount(adoptLauncherAccount(launcher));
        const token = await issueToken(adopted.nick);
        return json(res, 201, { token, profile: publicProfile(adopted), launcher: true });
      }

      const { salt, hash } = hashPassword(password);
      const providedHwid = normalizeHwid(body.hwid) || launcherHwid();
      const ownerNick = (process.env.ADMIN_NICK || 'art1x').toLowerCase();
      const account = await store.createAccount({
        nick,
        salt,
        hash,
        role: nick.toLowerCase() === ownerNick ? 'Admin' : 'User',
        plan: 'Classic',
        hwid: providedHwid,
        confirmedAt: providedHwid ? Date.now() : null,
        createdAt: Date.now(),
      });
      const token = await issueToken(account.nick);
      return json(res, 201, { token, profile: publicProfile(account) });
    }

    if (route === '/api/login' && req.method === 'POST') {
      const body = await readBody(req);
      let account = await store.findAccount(body.nick);
      if (account) {
        if (!sitePasswordOk(account, body.password)) return json(res, 401, { error: 'Неверный пароль' });
      } else {
        const launcher = launcherAccount(body.nick);
        if (!launcher) return json(res, 401, { error: 'Аккаунт не найден — зарегистрируйся' });
        if (!launcherPasswordOk(launcher, body.password)) return json(res, 401, { error: 'Неверный пароль' });
        account = await store.createAccount(adoptLauncherAccount(launcher));
      }
      const token = await issueToken(account.nick);
      return json(res, 200, { token, profile: publicProfile(account) });
    }

    if (route === '/api/launcher' && req.method === 'GET') {
      const hwid = launcherHwid();
      const accounts = launcherAccounts().map((item) => ({ nick: item.Nick, role: item.Role || 'User' }));
      return json(res, 200, {
        available: fs.existsSync(LAUNCHER_DIR),
        hwid,
        hwidDisplay: hwid ? formatHwid(hwid) : null,
        accounts,
        backend: store.backend(),
      });
    }

    if (route === '/api/profile' && req.method === 'GET') {
      const account = await authAccount(req);
      if (!account) return json(res, 401, { error: 'Нужен вход' });
      return json(res, 200, { profile: publicProfile(account) });
    }

    if (route === '/api/profile/hwid' && req.method === 'POST') {
      const account = await authAccount(req);
      if (!account) return json(res, 401, { error: 'Нужен вход' });
      const body = await readBody(req);
      const hwid = normalizeHwid(body.hwid);
      if (!hwid) return json(res, 400, { error: 'HWID должен содержать 64 hex-символа' });
      const owner = await store.hwidOwner(hwid);
      if (owner && owner.toLowerCase() !== account.nick.toLowerCase()) {
        return json(res, 409, { error: 'Этот HWID уже привязан к другому аккаунту' });
      }
      const updated = await store.setHwid(account.nick, hwid);
      return json(res, 200, { profile: publicProfile(updated), display: formatHwid(hwid) });
    }

    if (route === '/api/logout' && req.method === 'POST') {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      await store.deleteSession(token);
      return json(res, 200, { ok: true });
    }

    if (route === '/api/admin/accounts' && req.method === 'GET') {
      const admin = await requireAdmin(req);
      if (!admin) return json(res, 403, { error: 'Нужна роль Admin' });
      const accounts = (await store.listAccounts()).map((item) => ({
        nick: item.nick,
        role: item.role,
        plan: item.plan,
        hwid: item.hwid,
        confirmedAt: item.confirmedAt,
        createdAt: item.createdAt,
        launcher: item.launcher,
      }));
      return json(res, 200, { accounts, admin: admin.nick, backend: store.backend() });
    }

    if (route === '/api/admin/update' && req.method === 'POST') {
      const admin = await requireAdmin(req);
      if (!admin) return json(res, 403, { error: 'Нужна роль Admin' });
      const body = await readBody(req);
      const nick = String(body.nick || '').trim();
      if (!nick) return json(res, 400, { error: 'Укажи ник' });
      const role = body.role ? String(body.role) : null;
      const plan = body.plan ? String(body.plan) : null;
      if (role && !['Admin', 'Media', 'User'].includes(role)) return json(res, 400, { error: 'Неизвестная роль' });
      if (plan && !['Classic', 'Classic+Plus', 'None'].includes(plan)) return json(res, 400, { error: 'Неизвестный план' });
      const updated = await store.updateAccount(nick, { role, plan });
      if (!updated) return json(res, 404, { error: 'Аккаунт не найден' });
      return json(res, 200, { profile: publicProfile(updated) });
    }

    if (route === '/api/admin/reset-hwid' && req.method === 'POST') {
      const admin = await requireAdmin(req);
      if (!admin) return json(res, 403, { error: 'Нужна роль Admin' });
      const body = await readBody(req);
      const updated = await store.clearHwid(String(body.nick || '').trim());
      if (!updated) return json(res, 404, { error: 'Аккаунт не найден' });
      return json(res, 200, { profile: publicProfile(updated) });
    }

    if (route === '/api/admin/me' && req.method === 'GET') {
      const account = await authAccount(req);
      if (!account) return json(res, 401, { error: 'Нужен вход' });
      return json(res, 200, { admin: isAdminAccount(account), nick: account.nick, role: account.role });
    }

    if (route === '/api/support/send' && req.method === 'POST') {
      const body = await readBody(req);
      const nick = String(body.nick || '').trim();
      const text = String(body.text || '').trim().slice(0, 2000);
      if (nick.length < 3) return json(res, 400, { error: 'Укажи ник' });
      if (!text) return json(res, 400, { error: 'Пустое сообщение' });
      const hwid = normalizeHwid(body.hwid);
      pushSupportMessage(nick, 'user', text);
      if (supportState.ownerChatId) {
        const header = '🎫 ' + nick + (hwid ? ' · ' + formatHwid(hwid) : '') + '\n\n' + text;
        const sent = await tg('sendMessage', { chat_id: supportState.ownerChatId, text: header });
        if (sent.ok && sent.result) {
          supportState.inbox[String(sent.result.message_id)] = nick;
          saveSupport(supportState);
        }
      }
      return json(res, 200, { ok: true, delivered: Boolean(supportState.ownerChatId) });
    }

    if (route === '/api/support/messages' && req.method === 'GET') {
      const nick = String(url.searchParams.get('nick') || '').trim();
      const after = Number(url.searchParams.get('after') || 0);
      if (nick.length < 3) return json(res, 400, { error: 'Укажи ник' });
      const thread = supportThread(nick);
      const messages = thread.messages.filter((item) => item.id > after);
      return json(res, 200, { messages, cursor: thread.cursor, online: Boolean(supportState.ownerChatId) });
    }

    if (route.startsWith('/api/')) {
      return json(res, 404, { error: 'Неизвестный метод API' });
    }

    const relative = route === '/' ? 'index.html' : decodeURIComponent(route.replace(/^\//, ''));
    const filePath = path.join(SITE_DIR, relative);
    if (!filePath.startsWith(SITE_DIR)) {
      res.writeHead(403);
      return res.end('forbidden');
    }
    fs.readFile(filePath, (error, data) => {
      if (error) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    });
  } catch (error) {
    json(res, 500, { error: error.message || 'internal error' });
  }
});

server.listen(PORT, process.env.HOST || '0.0.0.0', () => {
  console.log('ShadeVisuals site + API: http://127.0.0.1:' + PORT);
  console.log('profile: http://127.0.0.1:' + PORT + '/profile.html');
});
