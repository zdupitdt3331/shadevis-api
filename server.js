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
// ---------- обновления лаунчера + Telegram ----------
const UPDATE_FILE = path.join(DATA_DIR, 'update.json');
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_CHAT = process.env.TELEGRAM_ADMIN_ID || '';

const MOD_FILE = path.join(DATA_DIR, 'mod.json');
const MOD_JAR = path.join(DATA_DIR, 'shadevisuals.jar');

function readMod() {
  try {
    const raw = JSON.parse(fs.readFileSync(MOD_FILE, 'utf8'));
    return { version: String(raw.version || ''), url: String(raw.url || '') };
  } catch {
    return { version: '', url: '' };
  }
}

function writeMod(version, url) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(MOD_FILE, JSON.stringify({ version, url }, null, 2));
}

function readUpdate() {
  try {
    const raw = JSON.parse(fs.readFileSync(UPDATE_FILE, 'utf8'));
    return { version: String(raw.version || ''), url: String(raw.url || '') };
  } catch {
    return { version: '', url: '' };
  }
}

function writeUpdate(version, url) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(UPDATE_FILE, JSON.stringify({ version, url }, null, 2));
}

async function telegramSend(chatId, text) {
  if (!BOT_TOKEN) return;
  try {
    await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch {
    // ignore
  }
}

let telegramOffset = 0;
let telegramLastError = "";
let telegramHandled = 0;

async function telegramPoll() {
  if (!BOT_TOKEN) return;
  try {
    const response = await fetch(
      'https://api.telegram.org/bot' + BOT_TOKEN + '/getUpdates?timeout=0&offset=' + (telegramOffset + 1),
    );
    const data = await response.json();
    if (!data.ok || !Array.isArray(data.result)) return;
    for (const update of data.result) {
      telegramOffset = Math.max(telegramOffset, update.update_id);
      const message = update.message;
      if (!message) continue;
      const chatId = String(message.chat.id);

      // админ прислал jar мода — публикуем новую версию
      if (message.document && /.jar$/i.test(message.document.file_name || '')) {
        if (ADMIN_CHAT && chatId !== String(ADMIN_CHAT)) continue;
        try {
          const info = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/getFile?file_id=' + message.document.file_id).then((r) => r.json());
          const filePath = info?.result?.file_path;
          if (!filePath) {
            const sizeMb = Math.round((message.document.file_size || 0) / 1048576);
            await telegramSend(chatId,
              '⚠️ Файл ' + sizeMb + ' МБ — Telegram не даёт ботам скачивать файлы больше 20 МБ.\n' +
              'Залей jar по ссылке (например в репозиторий shadevis-api: site/update/shadevisuals.jar) и отправь:\n' +
              '/modadd <версия> <ссылка>');
            continue;
          }
          const fileResponse = await fetch('https://api.telegram.org/file/bot' + BOT_TOKEN + '/' + filePath);
          const buffer = Buffer.from(await fileResponse.arrayBuffer());
          fs.mkdirSync(DATA_DIR, { recursive: true });
          fs.writeFileSync(MOD_JAR, buffer);

          const caption = String(message.caption || '').trim();
          const detected = (caption.match(/\d+\.\d+\.\d+/) || [])[0];
          const version = detected || new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '.');
          const host = process.env.PUBLIC_HOST || 'shadevis-api.onrender.com';
          writeMod(version, 'https://' + host + '/v1/mod/download');
          telegramHandled += 1;
          console.log('[telegram] mod ' + version + ' (' + buffer.length + ' bytes)');
          await telegramSend(chatId, '✅ Обновление загружено: мод ' + version + ' (' + Math.round(buffer.length / 1048576) + ' МБ). Лаунчеры покажут окно ОБНОВЛЕНИЕ.');
        } catch (error) {
          console.log('[telegram] mod upload failed: ' + error.message);
          await telegramSend(chatId, '❌ Не удалось принять jar: ' + error.message);
        }
        continue;
      }

      if (!message.text) continue;
      if (ADMIN_CHAT && chatId !== String(ADMIN_CHAT)) {
        // подсказываем настоящий chat id, чтобы его можно было вписать в TELEGRAM_ADMIN_ID
        await telegramSend(chatId, 'Ваш chat id: ' + chatId + '\nВпишите его в TELEGRAM_ADMIN_ID на Render.');
        continue;
      }
      const text = message.text.trim();
      if (text.startsWith('/release')) {
        const [, version, url] = text.split(/\s+/);
        if (!version || !url) {
          await telegramSend(chatId, 'Формат: /release 1.0.2 https://.../ShadeVisualsLoader.zip');
          continue;
        }
        writeUpdate(version, url);
        telegramHandled += 1;
        console.log('[telegram] release ' + version + ' -> ' + url);
        await telegramSend(chatId, '✅ Версия ' + version + ' опубликована. Лаунчеры увидят обновление.');
      } else if (text.startsWith('/modversion')) {
        const [, version, url] = text.split(/\s+/);
        if (!version || !url) {
          await telegramSend(chatId, 'Формат: /modversion 0.0.52 https://.../shadevisuals.jar');
          continue;
        }
        writeMod(version, url);
        await telegramSend(chatId, '✅ Мод ' + version + ' опубликован. Лаунчеры покажут окно ОБНОВЛЕНИЕ.');
      } else if (text.startsWith('/modadd')) {
        const [, version, url] = text.split(/\s+/);
        if (!version || !url) {
          await telegramSend(chatId, 'Формат: /modadd 0.0.52 https://.../shadevisuals-0.0.52-release.jar');
          continue;
        }
        try {
          await telegramSend(chatId, '⏳ Скачиваю мод ' + version + '…');
          const response = await fetch(url);
          if (!response.ok) throw new Error('HTTP ' + response.status);
          const buffer = Buffer.from(await response.arrayBuffer());
          if (buffer.length < 1024 || buffer.slice(0, 2).toString() !== 'PK') throw new Error('это не jar/zip');
          fs.mkdirSync(DATA_DIR, { recursive: true });
          fs.writeFileSync(MOD_JAR, buffer);
          const host = process.env.PUBLIC_HOST || 'shadevis-api.onrender.com';
          writeMod(version, 'https://' + host + '/v1/mod/download');
          console.log('[telegram] modadd ' + version + ' (' + buffer.length + ' bytes)');
          await telegramSend(chatId, '✅ Обновление загружено: мод ' + version + ' (' + Math.round(buffer.length / 1048576) + ' МБ). Лаунчеры покажут окно ОБНОВЛЕНИЕ.');
        } catch (error) {
          await telegramSend(chatId, '❌ Не удалось скачать: ' + error.message);
        }
      } else if (text.startsWith('/status')) {
        const current = readUpdate();
        await telegramSend(chatId,
          'Версия: <b>' + (current.version || 'не задана') + '</b>\n' + (current.url || ''));
      } else if (text.startsWith('/start')) {
        writeUpdate(readUpdate().version, readUpdate().url);
        await telegramSend(chatId, 'Команды:\n/release <версия> <ссылка на zip>\n/status');
      }
    }
  } catch (error) {
    telegramLastError = String(error && error.message ? error.message : error);
  }
}

if (BOT_TOKEN) {
  console.log('[telegram] polling started, admin=' + (ADMIN_CHAT || 'any'));
  setInterval(telegramPoll, 5000);
} else {
  console.log('[telegram] TELEGRAM_BOT_TOKEN is not set');
}

// ---------- удалённые аккаунты (переживают рестарт процесса) ----------
const DELETED_FILE = path.join(DATA_DIR, 'deleted.json');
let deletedAccounts = new Set();
try {
  const raw = JSON.parse(fs.readFileSync(DELETED_FILE, 'utf8'));
  if (Array.isArray(raw)) deletedAccounts = new Set(raw.map((n) => String(n).toLowerCase()));
} catch {
  deletedAccounts = new Set();
}

function saveDeleted() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DELETED_FILE, JSON.stringify([...deletedAccounts], null, 2));
  } catch {
    // ignore
  }
}
const DB_FILE = path.join(DATA_DIR, 'accounts.json');
const presence = new Map(); // name -> lastSeenMs
// ---------- chat storage (Postgres, файл-фолбэк) ----------
const CHAT_MAX = 2000;         // сколько последних сообщений держим в файле
const CHAT_KEEP = 2000;        // сколько последних сообщений держим в БД (история для всех)
let lastChatTrimAt = 0;
const CHAT_FILE = path.join(DATA_DIR, 'chat.json');
let chatPool = null;
if (process.env.DATABASE_URL) {
  try {
    const { Pool } = require('pg');
    chatPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 3,
    });
    chatPool.query(
      'CREATE TABLE IF NOT EXISTS chat_messages (' +
      'id BIGSERIAL PRIMARY KEY, name VARCHAR(32) NOT NULL, ' +
      'text VARCHAR(200) NOT NULL, created_at BIGINT NOT NULL)'
    ).catch(() => {});
  } catch (error) {
    console.warn('[chat] pg недоступен, работаю на файле:', error.message);
    chatPool = null;
  }
}

function chatLoadFile() {
  try {
    const data = JSON.parse(fs.readFileSync(CHAT_FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function chatSaveFile(list) {
  try {
    fs.writeFileSync(CHAT_FILE, JSON.stringify(list.slice(-CHAT_MAX)));
  } catch {
    // ignore
  }
}

let chatMemory = chatLoadFile();
let chatSeq = chatMemory.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0);

async function chatAdd(name, text) {
  const now = Date.now();
  if (chatPool) {
    const result = await chatPool.query(
      'INSERT INTO chat_messages(name, text, created_at) VALUES($1, $2, $3) RETURNING id',
      [name, text, now]
    );
    return Number(result.rows[0].id);
  }
  chatSeq += 1;
  chatMemory.push({ id: chatSeq, name, text, ts: now });
  if (chatMemory.length > CHAT_MAX) chatMemory = chatMemory.slice(-CHAT_MAX);
  chatSaveFile(chatMemory);
  return chatSeq;
}

async function chatTrim() {
  if (chatPool) {
    await chatPool.query(
      'DELETE FROM chat_messages WHERE id NOT IN (' +
      'SELECT id FROM chat_messages ORDER BY id DESC LIMIT $1)',
      [CHAT_KEEP]
    );
    return;
  }
  if (chatMemory.length > CHAT_MAX) {
    chatMemory = chatMemory.slice(-CHAT_MAX);
    chatSaveFile(chatMemory);
  }
}

async function chatSince(since) {
  if (chatPool) {
    const result = await chatPool.query(
      'SELECT id, name, text, created_at FROM chat_messages WHERE id > $1 ORDER BY id ASC LIMIT 500',
      [since]
    );
    return result.rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      text: row.text,
      ts: Number(row.created_at),
    }));
  }
  return chatMemory.filter((item) => item.id > since).slice(-500);
}

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

      const existing = await store.findAccount(nick);
      if (existing) {
        const tombstoned = deletedAccounts.has(String(existing.nick).toLowerCase());
        const locked = tombstoned || existing.deleted || (existing.salt === 'reset' && existing.hash === 'reset');
        if (!locked) return json(res, 409, { error: 'Этот ник уже занят — войди в аккаунт' });
        // повторная регистрация после сброса HWID: новый пароль + привязка к этому ПК
        const { salt, hash } = hashPassword(password);
        let revived = await store.setPassword(existing.nick, salt, hash);
        revived = await store.updateAccount(existing.nick, { deleted: false, role: 'User', plan: 'Classic' }) || revived;
        if (tombstoned) {
          deletedAccounts.delete(String(existing.nick).toLowerCase());
          saveDeleted();
        }
        const newHwid = normalizeHwid(body.hwid);
        if (newHwid) revived = await store.setHwid(existing.nick, newHwid);
        const token = await issueToken(revived.nick);
        return json(res, 201, { token, profile: publicProfile(revived), reenrolled: true });
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
      if (providedHwid) {
        const owner = await store.hwidOwner(providedHwid);
        if (owner && owner.toLowerCase() !== nick.toLowerCase()) {
          return json(res, 409, {
            error: 'Этот ПК уже привязан к аккаунту «' + owner + '» — войди в него или сбрось HWID в админке',
          });
        }
      }
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
        if (deletedAccounts.has(String(account.nick).toLowerCase()) || account.deleted) {
          return json(res, 403, {
            error: 'Аккаунт удалён администратором — зарегистрируйся заново',
            code: 'REENROLL',
          });
        }
        if (account.salt === 'reset' && account.hash === 'reset') {
          return json(res, 403, {
            error: 'Доступ сброшен администратором — зарегистрируйся заново с тем же ником',
            code: 'REENROLL',
          });
        }
        if (!sitePasswordOk(account, body.password)) return json(res, 401, { error: 'Неверный пароль' });
      } else {
        const launcher = launcherAccount(body.nick);
        if (!launcher) return json(res, 401, { error: 'Аккаунт не найден — зарегистрируйся' });
        if (!launcherPasswordOk(launcher, body.password)) return json(res, 401, { error: 'Неверный пароль' });
        account = await store.createAccount(adoptLauncherAccount(launcher));
      }
      const loginHwid = normalizeHwid(body.hwid);
      if (loginHwid && !account.hwid) {
        const owner = await store.hwidOwner(loginHwid);
        if (!owner || owner.toLowerCase() === account.nick.toLowerCase()) {
          account = await store.setHwid(account.nick, loginHwid);
        }
      }
      const token = await issueToken(account.nick);
      return json(res, 200, { token, profile: publicProfile(account) });
    }

    if (route === '/api/account/recover' && req.method === 'POST') {
      const body = await readBody(req);
      const nick = String(body.nick || '').trim();
      const password = String(body.password || '');
      const hwid = normalizeHwid(body.hwid);
      if (!nick || password.length < 6 || !hwid) {
        return json(res, 400, { error: 'Нужны ник, новый пароль (6+) и HWID' });
      }
      const account = await store.findAccount(nick);
      if (!account) return json(res, 404, { error: 'Аккаунт не найден' });
      if (!account.hwid || account.hwid.toLowerCase() !== hwid) {
        return json(res, 403, { error: 'Восстановление доступно только с привязанного ПК' });
      }
      const { salt, hash } = hashPassword(password);
      const updated = await store.setPassword(nick, salt, hash);
      const token = await issueToken(updated.nick);
      return json(res, 200, { token, profile: publicProfile(updated), recovered: true });
    }

    if (route === '/api/account/owner-reset' && req.method === 'POST') {
      const body = await readBody(req);
      const key = String(body.key || '');
      const expected = process.env.OWNER_KEY || '';
      if (!expected || key !== expected) {
        return json(res, 403, { error: 'Неверный ключ владельца' });
      }
      const nick = String(body.nick || '').trim();
      const password = String(body.password || '');
      const ownerNick = (process.env.ADMIN_NICK || 'art1x').toLowerCase();
      if (nick.toLowerCase() !== ownerNick) {
        return json(res, 403, { error: 'Ключ подходит только для ника владельца' });
      }
      if (password.length < 6) {
        return json(res, 400, { error: 'Пароль минимум 6 символов' });
      }
      const account = await store.findAccount(nick);
      if (!account) return json(res, 404, { error: 'Аккаунт не найден' });
      const { salt, hash } = hashPassword(password);
      const updated = await store.setPassword(account.nick, salt, hash);
      return json(res, 200, { profile: publicProfile(updated), reset: true });
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
      const nowMs = Date.now();
      const isOnline = (nick) => {
        const seen = presence.get(String(nick || '').toLowerCase());
        return Boolean(seen) && nowMs - seen <= 90000;
      };
      const accounts = (await store.listAccounts())
        .filter((item) => !deletedAccounts.has(String(item.nick || '').toLowerCase()))
        .filter((item) => !item.deleted && !(item.salt === 'reset' && item.hash === 'reset' && !item.hwid))
        .map((item) => ({
        nick: item.nick,
        role: item.role,
        plan: item.plan,
        hwid: item.hwid,
        confirmedAt: item.confirmedAt,
        createdAt: item.createdAt,
        launcher: item.launcher,
        online: isOnline(item.nick),
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
      const nick = String(body.nick || '').trim();
      const cleared = await store.clearHwid(nick);
      if (!cleared) return json(res, 404, { error: 'Аккаунт не найден' });
      // помечаем аккаунт как сброшенный: войти нельзя, нужно зарегистрироваться заново
      const locked = await store.setPassword(cleared.nick, 'reset', 'reset');
      return json(res, 200, { profile: publicProfile(locked || cleared), reenroll: true });
    }

    if (route === '/api/admin/delete' && req.method === 'POST') {
      const admin = await requireAdmin(req);
      if (!admin) return json(res, 403, { error: 'Нужна роль Admin' });
      const body = await readBody(req);
      const nick = String(body.nick || '').trim();
      if (!nick) return json(res, 400, { error: 'Укажи ник' });
      const account = await store.findAccount(nick);
      if (!account) return json(res, 404, { error: 'Аккаунт не найден' });
      if ((account.role || '').toLowerCase() === 'admin') {
        return json(res, 403, { error: 'Нельзя удалить администратора' });
      }
      // помечаем удалённым, чистим HWID и пароль
      await store.clearHwid(account.nick);
      await store.setPassword(account.nick, 'reset', 'reset');
      deletedAccounts.add(String(account.nick).toLowerCase());
      saveDeleted();
      const updated = await store.updateAccount(account.nick, { deleted: true, role: 'User', plan: 'None' });
      return json(res, 200, { ok: true, profile: publicProfile(updated || account) });
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

    // ---------- presence ----------
    if ((route === '/v1/presence' || route === '/api/presence') && req.method === 'POST') {
      const body = await readBody(req);
      const name = String(body.name || '').trim().toLowerCase();
      if (!name || name.length > 32) return json(res, 400, { error: 'bad name' });
      if (body.hidden) presence.delete(name);
      else presence.set(name, Date.now());
      return json(res, 200, { ok: true, ttl: 90 });
    }

    if ((route === '/v1/presence' || route === '/api/presence') && req.method === 'GET') {
      const now = Date.now();
      const out = {};
      for (const [name, seen] of presence) {
        if (now - seen <= 90000) out[name] = '';
        else presence.delete(name);
      }
      return json(res, 200, out);
    }

    if (route === '/v1/telegram') {
      return json(res, 200, {
        configured: Boolean(BOT_TOKEN),
        admin: ADMIN_CHAT || 'any',
        handled: telegramHandled,
        lastError: telegramLastError,
        update: readUpdate(),
      });
    }

    if (route === '/v1/ping') return json(res, 200, { ok: true, ts: Date.now() });
    // ---------- /presence ----------

    // ---------- chat ----------
    if (route === '/v1/chat' && req.method === 'POST') {
      const body = await readBody(req);
      const name = String(body.name || '').trim().slice(0, 32);
      const text = String(body.text || '').trim().slice(0, 200);
      if (!name || !text) return json(res, 400, { error: 'bad message' });
      const id = await chatAdd(name, text);
      if (Date.now() - lastChatTrimAt > 60000) {
        lastChatTrimAt = Date.now();
        chatTrim().catch(() => {});
      }
      return json(res, 200, { ok: true, id });
    }

    if (route === '/v1/chat' && req.method === 'GET') {
      const since = Number(url.searchParams.get('since') || 0);
      const messages = await chatSince(since);
      return json(res, 200, { messages });
    }
    // ---------- /chat ----------

    // ---------- cosmetics ----------
    if (route === '/v1/cosmetics' && req.method === 'POST') {
      const body = await readBody(req);
      const name = String(body.name || '').trim().toLowerCase().slice(0, 32);
      if (!name) return json(res, 400, { error: 'bad cosmetic' });
      const clean = (value) => (value ? String(value).trim().slice(0, 32) : '');
      const look = {
        cape: clean(body.cape),
        wings: clean(body.wings),
        bodywear: clean(body.bodywear),
        pet: clean(body.pet),
      };
      cosmetics.set(name, look);
      return json(res, 200, { ok: true });
    }

    if (route === '/v1/cosmetics' && req.method === 'GET') {
      const out = {};
      for (const [name, look] of cosmetics) out[name] = look;
      return json(res, 200, out);
    }
    // ---------- /cosmetics ----------

    // ---------- updater ----------
    if (route === '/v1/mod') {
      const stored = readMod();
      const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
      const fallbackUrl = 'https://' + host + '/v1/mod/download';
      return json(res, 200, {
        version: stored.version || '0.0.51',
        url: stored.url || fallbackUrl,
      });
    }

    if (route === '/v1/mod/download') {
      try {
        const data = fs.readFileSync(MOD_JAR);
        res.writeHead(200, {
          'Content-Type': 'application/java-archive',
          'Content-Length': data.length,
        });
        res.end(data);
      } catch {
        json(res, 404, { error: 'mod not uploaded yet' });
      }
      return;
    }

    if (route === '/v1/update') {
      const stored = readUpdate();
      const version = stored.version || process.env.LAUNCHER_VERSION || '1.0.0';
      const url = stored.url || process.env.LAUNCHER_URL
        || ('http://' + (req.headers.host || 'localhost') + '/update/ShadeVisualsLoader.zip');
      return json(res, 200, { version, url });
    }
    // ---------- /updater ----------

    // ---------- party ----------
    if (route === '/v1/party/invite' && req.method === 'POST') {
      const body = await readBody(req);
      const from = String(body.from || '').trim().toLowerCase().slice(0, 32);
      const to = String(body.to || '').trim().toLowerCase().slice(0, 32);
      if (!from || !to || from === to) return json(res, 400, { error: 'bad invite' });
      partyInvites.set(to, { from, at: Date.now() });
      return json(res, 200, { ok: true });
    }

    if (route === '/v1/party/invites' && req.method === 'GET') {
      const name = String(url.searchParams.get('name') || '').trim().toLowerCase();
      const out = [];
      for (const [to, invite] of partyInvites) {
        if (Date.now() - invite.at > 120000) { partyInvites.delete(to); continue; }
        if (to === name) out.push(invite.from);
      }
      return json(res, 200, { invites: out });
    }

    if (route === '/v1/party/reply' && req.method === 'POST') {
      const body = await readBody(req);
      const from = String(body.from || '').trim().toLowerCase().slice(0, 32);
      const to = String(body.to || '').trim().toLowerCase().slice(0, 32);
      const accept = Boolean(body.accept);
      partyInvites.delete(to);
      if (!accept) return json(res, 200, { ok: true, joined: false });
      let id = partyMembers.get(from);
      if (!id) { id = 'p' + (++partySeq); partyMembers.set(from, id); }
      partyMembers.set(to, id);
      if (!partyMarkers.has(id)) partyMarkers.set(id, []);
      return json(res, 200, { ok: true, joined: true, party: id });
    }

    if (route === '/v1/party/leave' && req.method === 'POST') {
      const body = await readBody(req);
      const name = String(body.name || '').trim().toLowerCase();
      partyMembers.delete(name);
      return json(res, 200, { ok: true });
    }

    if (route === '/v1/party' && req.method === 'GET') {
      const name = String(url.searchParams.get('name') || '').trim().toLowerCase();
      const id = partyMembers.get(name) || null;
      const members = [];
      if (id) for (const [member, party] of partyMembers) if (party === id) members.push(member);
      return json(res, 200, { party: id, members });
    }

    if (route === '/v1/party/marker' && req.method === 'POST') {
      const body = await readBody(req);
      const name = String(body.name || '').trim().toLowerCase();
      const id = partyMembers.get(name);
      if (!id) return json(res, 403, { error: 'not in party' });
      const list = partyMarkers.get(id) || [];
      list.push({ name, x: Number(body.x || 0), y: Number(body.y || 0), z: Number(body.z || 0), at: Date.now() });
      while (list.length > 50) list.shift();
      partyMarkers.set(id, list);
      return json(res, 200, { ok: true });
    }

    if (route === '/v1/party/markers' && req.method === 'GET') {
      const name = String(url.searchParams.get('name') || '').trim().toLowerCase();
      const id = partyMembers.get(name);
      if (!id) return json(res, 200, { markers: [] });
      const list = (partyMarkers.get(id) || []).filter((m) => Date.now() - m.at < 300000);
      return json(res, 200, { markers: list });
    }
    // ---------- /party ----------

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
    const message = String(error && error.message ? error.message : '');
    if (message.includes('accounts_hwid_key')) {
      return json(res, 409, { error: 'Этот ПК уже привязан к другому аккаунту — войди в него или сбрось HWID в админке' });
    }
    if (message.includes('accounts_pkey') || message.includes('accounts_nick')) {
      return json(res, 409, { error: 'Этот ник уже занят — войди в аккаунт' });
    }
    json(res, 500, { error: message || 'internal error' });
  }
});

server.listen(PORT, process.env.HOST || '0.0.0.0', () => {
  console.log('ShadeVisuals site + API: http://127.0.0.1:' + PORT);
  console.log('profile: http://127.0.0.1:' + PORT + '/profile.html');
});
