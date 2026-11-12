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
CREATE TABLE IF NOT EXISTS bot_state (
  name VARCHAR(64) PRIMARY KEY,
  state_value TEXT NOT NULL DEFAULT '',
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS license_keys (
  key VARCHAR(40) PRIMARY KEY,
  tier VARCHAR(24) NOT NULL DEFAULT 'basic',
  role VARCHAR(16) NULL,
  telegram_id VARCHAR(32) NULL,
  created_at BIGINT NOT NULL,
  used_by VARCHAR(32) NULL,
  used_at BIGINT NULL
);
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







// ---------- license keys (online DB only) ----------
function normalizeKey(row) {
  return {
    key: row.key,
    tier: row.tier || 'basic',
    role: row.role || null,
    telegramId: row.telegramId || row.telegram_id || null,
    createdAt: Number(row.createdAt || row.created_at || 0),
    usedBy: row.usedBy || row.used_by || null,
    usedAt: Number(row.usedAt || row.used_at || 0) || null,
  };
}

function requireKeysDb() {
  if (!pgPool && !mysqlPool) throw new Error('keys_require_database');
}

let mysqlKeysReady = null;
function ensureMysqlKeys() {
  if (!mysqlKeysReady) {
    const tick = String.fromCharCode(96);
    const keyColumn = tick + 'key' + tick;
    const sql = 'CREATE TABLE IF NOT EXISTS license_keys ('
      + keyColumn + ' VARCHAR(40) PRIMARY KEY, tier VARCHAR(24) NOT NULL DEFAULT \'basic\', '
      + 'role VARCHAR(16) NULL, telegram_id VARCHAR(32) NULL, created_at BIGINT NOT NULL, '
      + 'used_by VARCHAR(32) NULL, used_at BIGINT NULL)';
    mysqlKeysReady = mysqlPool.query(sql).catch(() => null);
  }
  return mysqlKeysReady;
}

async function createKey(record) {
  requireKeysDb();
  const row = {
    key: record.key,
    tier: record.tier || 'basic',
    role: record.role || null,
    telegramId: record.telegramId || null,
    createdAt: Date.now(),
    usedBy: null,
    usedAt: null,
  };
  if (pgPool) {
    await pgPool.query(
      'INSERT INTO license_keys (key, tier, role, telegram_id, created_at) VALUES ($1,$2,$3,$4,$5)',
      [row.key, row.tier, row.role, row.telegramId, row.createdAt]
    );
    return row;
  }
  await ensureMysqlKeys();
  const tick = String.fromCharCode(96);
  await mysqlPool.query(
    'INSERT INTO license_keys (' + tick + 'key' + tick + ', tier, role, telegram_id, created_at) VALUES (?,?,?,?,?)',
    [row.key, row.tier, row.role, row.telegramId, row.createdAt]
  );
  return row;
}

async function findKey(key) {
  requireKeysDb();
  const normalized = String(key || '').trim().toUpperCase();
  if (!normalized) return null;
  if (pgPool) {
    const { rows } = await pgPool.query(
      'SELECT key, tier, role, telegram_id, created_at, used_by, used_at FROM license_keys WHERE key = $1 LIMIT 1',
      [normalized]
    );
    return rows[0] ? normalizeKey(rows[0]) : null;
  }
  await ensureMysqlKeys();
  const tick = String.fromCharCode(96);
  const [rows] = await mysqlPool.query(
    'SELECT ' + tick + 'key' + tick + ', tier, role, telegram_id, created_at, used_by, used_at FROM license_keys WHERE ' + tick + 'key' + tick + ' = ? LIMIT 1',
    [normalized]
  );
  return rows[0] ? normalizeKey(rows[0]) : null;
}

async function consumeKey(key, nick) {
  requireKeysDb();
  const normalized = String(key || '').trim().toUpperCase();
  const owner = String(nick || '').trim();
  if (!normalized || !owner) return null;
  if (pgPool) {
    const { rows } = await pgPool.query(
      'UPDATE license_keys SET used_by = $2, used_at = $3 WHERE key = $1 AND used_by IS NULL RETURNING key, tier, role, telegram_id, created_at, used_by, used_at',
      [normalized, owner, Date.now()]
    );
    return rows[0] ? normalizeKey(rows[0]) : null;
  }
  await ensureMysqlKeys();
  const tick = String.fromCharCode(96);
  const [result] = await mysqlPool.query(
    'UPDATE license_keys SET used_by = ?, used_at = ? WHERE ' + tick + 'key' + tick + ' = ? AND used_by IS NULL',
    [owner, Date.now(), normalized]
  );
  if (!result || !result.affectedRows) return null;
  return findKey(normalized);
}


async function getState(name) {
  requireKeysDb();
  if (pgPool) {
    const { rows } = await pgPool.query('SELECT state_value FROM bot_state WHERE name = $1 LIMIT 1', [String(name)]);
    return rows[0] ? rows[0].state_value : null;
  }
  await ensureBotStateMysql();
  const [rows] = await mysqlPool.query('SELECT state_value FROM bot_state WHERE name = ? LIMIT 1', [String(name)]);
  return rows[0] ? rows[0].state_value : null;
}

async function setState(name, value) {
  requireKeysDb();
  const text = String(value == null ? '' : value);
  if (pgPool) {
    await pgPool.query(
      'INSERT INTO bot_state (name, state_value, updated_at) VALUES ($1,$2,$3) ON CONFLICT (name) DO UPDATE SET state_value = $2, updated_at = $3',
      [String(name), text, Date.now()]
    );
    return true;
  }
  await ensureBotStateMysql();
  await mysqlPool.query(
    'INSERT INTO bot_state (name, state_value, updated_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), updated_at = VALUES(updated_at)',
    [String(name), text, Date.now()]
  );
  return true;
}

let mysqlStateReady = null;
function ensureBotStateMysql() {
  if (!mysqlStateReady) {
    mysqlStateReady = mysqlPool.query('CREATE TABLE IF NOT EXISTS bot_state (name VARCHAR(64) PRIMARY KEY, state_value TEXT NOT NULL, updated_at BIGINT NOT NULL)').catch(() => null);
  }
  return mysqlStateReady;
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
  createKey,
  findKey,
  consumeKey,
  getState,
  setState,
};
