'use strict';

/**
 * Хранилище аккаунтов: PostgreSQL (Render/Aiven), MySQL или JSON-файл.
 * Все методы асинхронные, вызывающий код не зависит от бэкенда.
 */

const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'accounts.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

const config = loadConfig();
const dbConfig = config.database || {};
const databaseUrl = process.env.DATABASE_URL || '';

const usePostgres = Boolean(databaseUrl) || dbConfig.type === 'postgres';
const useMysql = !usePostgres && Boolean(dbConfig.host && dbConfig.database && dbConfig.user);

let pgPool = null;
let mysqlPool = null;

if (usePostgres) {
  try {
    const { Pool } = require('pg');
    pgPool = new Pool({
      connectionString: databaseUrl || undefined,
      host: databaseUrl ? undefined : dbConfig.host,
      port: databaseUrl ? undefined : Number(dbConfig.port || 5432),
      user: databaseUrl ? undefined : dbConfig.user,
      password: databaseUrl ? undefined : dbConfig.password,
      database: databaseUrl ? undefined : dbConfig.database,
      ssl: dbConfig.ssl === false ? undefined : { rejectUnauthorized: false },
      max: 5,
    });
  } catch (error) {
    console.warn('[store] pg не установлен, работаю на JSON:', error.message);
    pgPool = null;
  }
}

if (useMysql) {
  try {
    const mysql = require('mysql2/promise');
    mysqlPool = mysql.createPool({
      host: dbConfig.host,
      port: Number(dbConfig.port || 3306),
      user: dbConfig.user,
      password: dbConfig.password || '',
      database: dbConfig.database,
      waitForConnections: true,
      connectionLimit: 5,
      charset: 'utf8mb4',
    });
  } catch (error) {
    console.warn('[store] mysql2 не установлен, работаю на JSON:', error.message);
    mysqlPool = null;
  }
}

const PG_SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  nick VARCHAR(32) PRIMARY KEY,
  salt VARCHAR(64) NOT NULL DEFAULT '',
  hash VARCHAR(128) NOT NULL DEFAULT '',
  launcher BOOLEAN NOT NULL DEFAULT FALSE,
  role VARCHAR(16) NOT NULL DEFAULT 'User',
  plan VARCHAR(32) NOT NULL DEFAULT 'Classic',
  hwid CHAR(64) NULL UNIQUE,
  confirmed_at BIGINT NULL,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token CHAR(64) PRIMARY KEY,
  nick VARCHAR(32) NOT NULL,
  expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_nick ON sessions (nick);
CREATE TABLE IF NOT EXISTS cloud_messages (
  id BIGSERIAL PRIMARY KEY,
  nick VARCHAR(32) NOT NULL,
  text VARCHAR(300) NOT NULL,
  hwid CHAR(64) NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cloud_id ON cloud_messages (id);
`;

if (pgPool) {
  pgPool.query(PG_SCHEMA)
    .then(() => console.log('[store] postgres schema ready'))
    .catch((error) => console.warn('[store] schema init failed:', error.message));
}

// ---------- JSON ----------
function readJson() {
  try {
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return { accounts: Array.isArray(data.accounts) ? data.accounts : [], sessions: data.sessions || {} };
  } catch {
    return { accounts: [], sessions: {} };
  }
}

function writeJson(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalize(row) {
  if (!row) return null;
  return {
    nick: row.nick,
    salt: row.salt || '',
    hash: row.hash || '',
    launcher: Boolean(row.launcher),
    role: row.role || 'User',
    plan: row.plan || 'Classic',
    hwid: row.hwid || null,
    confirmedAt: toNumber(row.confirmedAt || row.confirmed_at),
    createdAt: toNumber(row.createdAt || row.created_at),
  };
}

// ---------- API ----------
async function findAccount(nick) {
  const key = String(nick || '').toLowerCase();
  if (!key) return null;

  if (pgPool) {
    const { rows } = await pgPool.query(
      'SELECT nick, salt, hash, launcher, role, plan, hwid, confirmed_at, created_at FROM accounts WHERE LOWER(nick) = $1 LIMIT 1',
      [key]
    );
    return normalize(rows[0]);
  }

  if (mysqlPool) {
    const [rows] = await mysqlPool.query(
      'SELECT nick, salt, hash, launcher, role, plan, hwid, confirmed_at, created_at FROM accounts WHERE LOWER(nick) = ? LIMIT 1',
      [key]
    );
    return normalize(rows[0]);
  }

  return normalize(readJson().accounts.find((a) => String(a.nick).toLowerCase() === key));
}

async function createAccount(account) {
  const row = {
    nick: account.nick,
    salt: account.salt || '',
    hash: account.hash || '',
    launcher: account.launcher ? 1 : 0,
    role: account.role || 'User',
    plan: account.plan || 'Classic',
    hwid: account.hwid || null,
    confirmedAt: account.confirmedAt || null,
    createdAt: account.createdAt || Date.now(),
  };

  if (pgPool) {
    await pgPool.query(
      'INSERT INTO accounts (nick, salt, hash, launcher, role, plan, hwid, confirmed_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [row.nick, row.salt, row.hash, Boolean(row.launcher), row.role, row.plan, row.hwid, row.confirmedAt, row.createdAt]
    );
    return normalize(row);
  }

  if (mysqlPool) {
    await mysqlPool.query(
      'INSERT INTO accounts (nick, salt, hash, launcher, role, plan, hwid, confirmed_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [row.nick, row.salt, row.hash, row.launcher, row.role, row.plan, row.hwid, row.confirmedAt, row.createdAt]
    );
    return normalize(row);
  }

  const db = readJson();
  db.accounts.push(row);
  writeJson(db);
  return normalize(row);
}

async function setHwid(nick, hwid) {
  const key = String(nick || '').toLowerCase();

  if (pgPool) {
    await pgPool.query('UPDATE accounts SET hwid = $1, confirmed_at = $2 WHERE LOWER(nick) = $3', [hwid, Date.now(), key]);
    return findAccount(nick);
  }

  if (mysqlPool) {
    await mysqlPool.query('UPDATE accounts SET hwid = ?, confirmed_at = ? WHERE LOWER(nick) = ?', [hwid, Date.now(), key]);
    return findAccount(nick);
  }

  const db = readJson();
  const found = db.accounts.find((a) => String(a.nick).toLowerCase() === key);
  if (found) {
    found.hwid = hwid;
    found.confirmedAt = Date.now();
    writeJson(db);
  }
  return normalize(found);
}

async function hwidOwner(hwid) {
  if (pgPool) {
    const { rows } = await pgPool.query('SELECT nick FROM accounts WHERE hwid = $1 LIMIT 1', [hwid]);
    return rows[0] ? rows[0].nick : null;
  }

  if (mysqlPool) {
    const [rows] = await mysqlPool.query('SELECT nick FROM accounts WHERE hwid = ? LIMIT 1', [hwid]);
    return rows[0] ? rows[0].nick : null;
  }

  const found = readJson().accounts.find((a) => a.hwid === hwid);
  return found ? found.nick : null;
}

async function createSession(token, nick, expiresAt) {
  if (pgPool) {
    await pgPool.query('INSERT INTO sessions (token, nick, expires_at) VALUES ($1,$2,$3)', [token, nick, expiresAt]);
    return;
  }

  if (mysqlPool) {
    await mysqlPool.query('INSERT INTO sessions (token, nick, expires_at) VALUES (?,?,?)', [token, nick, expiresAt]);
    return;
  }

  const db = readJson();
  db.sessions[token] = { nick, expiresAt };
  writeJson(db);
}

async function findSession(token) {
  if (!token) return null;

  if (pgPool) {
    const { rows } = await pgPool.query('SELECT nick, expires_at FROM sessions WHERE token = $1 LIMIT 1', [token]);
    if (!rows[0]) return null;
    return { nick: rows[0].nick, expiresAt: Number(rows[0].expires_at) };
  }

  if (mysqlPool) {
    const [rows] = await mysqlPool.query('SELECT nick, expires_at FROM sessions WHERE token = ? LIMIT 1', [token]);
    if (!rows[0]) return null;
    return { nick: rows[0].nick, expiresAt: Number(rows[0].expires_at) };
  }

  return readJson().sessions[token] || null;
}

async function deleteSession(token) {
  if (pgPool) {
    await pgPool.query('DELETE FROM sessions WHERE token = $1', [token]);
    return;
  }

  if (mysqlPool) {
    await mysqlPool.query('DELETE FROM sessions WHERE token = ?', [token]);
    return;
  }

  const db = readJson();
  delete db.sessions[token];
  writeJson(db);
}

async function listAccounts() {
  if (pgPool) {
    const { rows } = await pgPool.query('SELECT nick, role, plan, hwid, confirmed_at, created_at FROM accounts ORDER BY created_at');
    return rows.map(normalize);
  }

  if (mysqlPool) {
    const [rows] = await mysqlPool.query('SELECT nick, role, plan, hwid, confirmed_at, created_at FROM accounts ORDER BY created_at');
    return rows.map(normalize);
  }

  return readJson().accounts.map(normalize);
}


async function updateAccount(nick, fields) {
  const key = String(nick || '').toLowerCase();
  const existing = await findAccount(nick);
  if (!existing) return null;
  const role = fields.role || existing.role;
  const plan = fields.plan || existing.plan;

  if (pgPool) {
    await pgPool.query('UPDATE accounts SET role = $1, plan = $2 WHERE LOWER(nick) = $3', [role, plan, key]);
    return findAccount(nick);
  }
  if (mysqlPool) {
    await mysqlPool.query('UPDATE accounts SET role = ?, plan = ? WHERE LOWER(nick) = ?', [role, plan, key]);
    return findAccount(nick);
  }
  const db = readJson();
  const found = db.accounts.find((a) => String(a.nick).toLowerCase() === key);
  if (found) {
    found.role = role;
    found.plan = plan;
    writeJson(db);
  }
  return normalize(found);
}

async function clearHwid(nick) {
  const key = String(nick || '').toLowerCase();
  if (pgPool) {
    await pgPool.query('UPDATE accounts SET hwid = NULL, confirmed_at = NULL WHERE LOWER(nick) = $1', [key]);
    return findAccount(nick);
  }
  if (mysqlPool) {
    await mysqlPool.query('UPDATE accounts SET hwid = NULL, confirmed_at = NULL WHERE LOWER(nick) = ?', [key]);
    return findAccount(nick);
  }
  const db = readJson();
  const found = db.accounts.find((a) => String(a.nick).toLowerCase() === key);
  if (found) {
    found.hwid = null;
    found.confirmedAt = null;
    writeJson(db);
  }
  return normalize(found);
}


async function setPassword(nick, salt, hash) {
  const key = String(nick || '').toLowerCase();
  if (pgPool) {
    await pgPool.query('UPDATE accounts SET salt = $1, hash = $2, launcher = FALSE WHERE LOWER(nick) = $3', [salt, hash, key]);
    return findAccount(nick);
  }
  if (mysqlPool) {
    await mysqlPool.query('UPDATE accounts SET salt = ?, hash = ?, launcher = 0 WHERE LOWER(nick) = ?', [salt, hash, key]);
    return findAccount(nick);
  }
  const db = readJson();
  const found = db.accounts.find((a) => String(a.nick).toLowerCase() === key);
  if (found) {
    found.salt = salt;
    found.hash = hash;
    found.launcher = false;
    writeJson(db);
  }
  return normalize(found);
}


async function addCloudMessage(nick, text, hwid) {
  const createdAt = Date.now();
  if (pgPool) {
    const { rows } = await pgPool.query(
      'INSERT INTO cloud_messages (nick, text, hwid, created_at) VALUES ($1,$2,$3,$4) RETURNING id',
      [nick, text, hwid || null, createdAt]
    );
    return { id: Number(rows[0].id), nick, text, at: createdAt };
  }
  if (mysqlPool) {
    const [result] = await mysqlPool.query(
      'INSERT INTO cloud_messages (nick, text, hwid, created_at) VALUES (?,?,?,?)',
      [nick, text, hwid || null, createdAt]
    );
    return { id: Number(result.insertId), nick, text, at: createdAt };
  }
  const db = readJson();
  if (!Array.isArray(db.cloud)) db.cloud = [];
  const id = db.cloud.reduce((max, item) => Math.max(max, item.id), 0) + 1;
  const message = { id, nick, text, hwid: hwid || null, at: createdAt };
  db.cloud.push(message);
  if (db.cloud.length > 500) db.cloud.splice(0, db.cloud.length - 500);
  writeJson(db);
  return { id, nick, text, at: createdAt };
}

async function listCloudMessages(afterId, limit) {
  const safeLimit = Math.max(1, Math.min(100, limit || 50));
  if (pgPool) {
    const { rows } = await pgPool.query(
      'SELECT id, nick, text, created_at FROM cloud_messages WHERE id > $1 ORDER BY id ASC LIMIT $2',
      [Number(afterId) || 0, safeLimit]
    );
    return rows.map((row) => ({ id: Number(row.id), nick: row.nick, text: row.text, at: Number(row.created_at) }));
  }
  if (mysqlPool) {
    const [rows] = await mysqlPool.query(
      'SELECT id, nick, text, created_at FROM cloud_messages WHERE id > ? ORDER BY id ASC LIMIT ?',
      [Number(afterId) || 0, safeLimit]
    );
    return rows.map((row) => ({ id: Number(row.id), nick: row.nick, text: row.text, at: Number(row.created_at) }));
  }
  const db = readJson();
  const list = Array.isArray(db.cloud) ? db.cloud : [];
  return list
    .filter((item) => item.id > (Number(afterId) || 0))
    .slice(0, safeLimit)
    .map((item) => ({ id: item.id, nick: item.nick, text: item.text, at: item.at }));
}


async function clearCloudMessages() {
  if (pgPool) {
    await pgPool.query('DELETE FROM cloud_messages');
    return;
  }
  if (mysqlPool) {
    await mysqlPool.query('DELETE FROM cloud_messages');
    return;
  }
  const db = readJson();
  db.cloud = [];
  writeJson(db);
}

module.exports = {
  backend: () => (pgPool ? 'postgres' : mysqlPool ? 'mysql' : 'json'),
  findAccount,
  createAccount,
  setHwid,
  hwidOwner,
  createSession,
  findSession,
  deleteSession,
  listAccounts,
  updateAccount,
  clearHwid,
  setPassword,
  addCloudMessage,
  listCloudMessages,
  clearCloudMessages,
};
