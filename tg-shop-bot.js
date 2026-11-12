'use strict';
/**
 * ShadeVisuals — Telegram-магазин: доступ и роль Beta за Telegram Stars.
 * Покупка без регистрации: после оплаты выдаётся одноразовый ключ.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const BANNER_B64 = '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';
const SHOP_URL = 'https://shadevis-api.onrender.com';
function shopSecret() { return process.env.TG_SHOP_SECRET || ''; }

const TIERS = {
  basic: { id: 'basic', stars: 200, title: 'Pro', role: null },
  beta: { id: 'beta', stars: 300, title: 'Beta', role: 'Beta' },
  hwid: { id: 'hwid', stars: 10, title: 'Сброс HWID', role: null },
};

const pendingHwid = new Map();

const CURRENCY = 'XTR';
function adminId() { return String(process.env.TG_SHOP_ADMIN_ID || ''); }

function token() {
  return process.env.TG_SHOP_BOT_TOKEN || process.env.SUPPORT_BOT_TOKEN || '';
}

function webhookSecret() {
  return process.env.TG_WEBHOOK_SECRET || '';
}

async function tg(method, payload) {
  const response = await fetch('https://api.telegram.org/bot' + token() + '/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!data.ok) console.error('[tg-shop] api error', method, JSON.stringify(data).slice(0, 300));
  return data;
}

function cardText() {
  return '<b>💎 ShadeVisuals — доступ</b>\n\n'
    + 'Платишь <b>Telegram Stars</b> — получаешь подписку и активируешь ключ в лоунчере.\n'
    + 'Регистрация заранее не нужна: ключ можно активировать, когда зайдёшь в клиент.\n'
    + 'Лоудер можно скачать бесплатно — кнопка ниже.\n\n'
    + '🌸 <i>Выбери тариф ниже</i>';
}

function menuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: 'Подписка Pro — ' + TIERS.basic.stars + ' ⭐', callback_data: 'buy:basic' }],
      [{ text: 'Роль Beta — ' + TIERS.beta.stars + ' ⭐', callback_data: 'buy:beta' }],
      [{ text: 'Сброс HWID — ' + TIERS.hwid.stars + ' ⭐', callback_data: 'buy:hwid' }],
      [{ text: '⬇️ Скачать лоудер бесплатно', callback_data: 'download' }],
      [{ text: 'Мои покупки', callback_data: 'status' }],
    ],
  };
}

function bannerFile() {
  const file = path.join(os.tmpdir(), 'shadevisuals-shop.jpg');
  try {
    if (!fs.existsSync(file) || fs.statSync(file).size < 1000) {
      fs.writeFileSync(file, Buffer.from(BANNER_B64, 'base64'));
    }
    return file;
  } catch {
    return null;
  }
}

async function sendCard(chatId) {
  const file = bannerFile();
  const caption = cardText();
  const keyboard = JSON.stringify(menuKeyboard());
  if (file) {
    try {
      const form = new FormData();
      form.append('chat_id', String(chatId));
      form.append('caption', caption);
      form.append('parse_mode', 'HTML');
      form.append('reply_markup', keyboard);
      form.append('photo', new Blob([fs.readFileSync(file)], { type: 'image/jpeg' }), 'shadevisuals.jpg');
      const response = await fetch('https://api.telegram.org/bot' + token() + '/sendPhoto', { method: 'POST', body: form });
      const data = await response.json().catch(() => ({}));
      if (data.ok) return data;
    } catch (error) {
      console.error('[tg-shop] sendPhoto error', error && error.message);
    }
  }
  return tg('sendMessage', { chat_id: chatId, text: caption, parse_mode: 'HTML', reply_markup: menuKeyboard() });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
  } catch (error) {
    console.error('[tg-shop] write failed', error && error.message);
  }
}

function dataDir(deps) {
  return deps.DATA_DIR || path.join(__dirname, 'data');
}

function usersFile(deps) {
  return path.join(dataDir(deps), 'tg-shop-users.json');
}

function purchasesFile(deps) {
  return path.join(dataDir(deps), 'tg-shop-purchases.json');
}

function hwidFile(deps) {
  return path.join(dataDir(deps), 'tg-shop-hwid.json');
}

async function handleUpdate(req, update, deps) {
  const secret = req.headers['x-telegram-bot-api-secret-token']
    || new URL(req.url, 'http://localhost').searchParams.get('secret');
  if (String(secret || '') !== webhookSecret()) {
    return { status: 403, payload: { error: 'forbidden' } };
  }
  try {
    if (update.message) await handleMessage(update.message, deps);
    else if (update.callback_query) await handleCallback(update.callback_query, deps);
    else if (update.pre_checkout_query) await handlePreCheckout(update.pre_checkout_query);
  } catch (error) {
    console.error('[tg-shop] update failed', error && error.stack);
  }
  return { status: 200, payload: { ok: true } };
}

async function handleMessage(message, deps) {
  const chatId = message.chat.id;
  const text = String(message.text || '').trim();

  if (message.successful_payment) return handlePaid(message, deps);
  if (message.document) return handleSetupDocument(message, deps);
  if (text === '/start' || text === '/help' || text === '/buy') return sendCard(chatId);
  if (text === '/status' || text === '/key') return sendKeys(chatId, message.from && message.from.id, deps);
  if (text === '/download') return deliverSetup(chatId, deps);
  if (message.reply_to_message && message.reply_to_message.from
      && message.reply_to_message.from.is_bot && pendingHwid.has(message.from.id)) {
    pendingHwid.delete(message.from.id);
    const nick = text.replace(/[^A-Za-z0-9_]/g, '').trim();
    if (nick.length < 3 || nick.length > 16) {
      await tg('sendMessage', { chat_id: chatId, text: 'Ник должен быть 3–16 символов (латиница, цифры, _).' });
      return;
    }
    const account = await deps.store.findAccount(nick);
    if (!account) {
      await tg('sendMessage', { chat_id: chatId, text: 'Аккаунт «' + nick + '» не найден. Проверь ник.' });
      return;
    }
    return startHwidInvoice(chatId, message.from, account.nick);
  }
  await sendCard(chatId);
}

async function handleCallback(query, deps) {
  const data = query.data || '';
  const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
  await tg('answerCallbackQuery', { callback_query_id: query.id });
  if (data === 'status') return sendKeys(chatId, query.from && query.from.id, deps);
  if (data === 'download') return deliverSetup(chatId, deps);
  if (data.startsWith('hwidreset:')) {
    const nick = data.slice('hwidreset:'.length);
    const fromId = String(query.from && query.from.id || '');
    if (!adminId() || fromId !== adminId()) {
      await tg('answerCallbackQuery', { callback_query_id: query.id, text: 'Нет прав', show_alert: true });
      return;
    }
    const account = await deps.store.findAccount(nick);
    if (!account) {
      await tg('answerCallbackQuery', { callback_query_id: query.id, text: 'Аккаунт не найден', show_alert: true });
      return;
    }
    await deps.store.clearHwid(account.nick);
    const requests = readJson(hwidFile(deps), []);
    const request = Array.isArray(requests)
      ? requests.find((item) => String(item.nick || '').toLowerCase() === String(account.nick).toLowerCase())
      : null;
    if (request && request.buyerId) {
      await tg('sendMessage', {
        chat_id: request.buyerId,
        text: '✅ HWID сброшен для ' + account.nick + '. Зайди в лаунчер заново.',
      });
    }
    if (query.message) {
      await tg('editMessageText', {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        text: '✅ HWID сброшен: ' + account.nick,
      });
    }
    await tg('answerCallbackQuery', { callback_query_id: query.id, text: 'Готово' });
    return;
  }
  if (data.startsWith('buy:')) {
    const tier = TIERS[data.split(':')[1]] || TIERS.basic;
    if (tier.id === 'hwid') {
      pendingHwid.set(query.from.id, true);
      await tg('sendMessage', {
        chat_id: chatId,
        text: 'Введи ник, для которого нужно сбросить HWID:',
        reply_markup: { force_reply: true, selective: true },
      });
      return;
    }
    return startPurchase(chatId, query.from, tier);
  }
}

async function startPurchase(chatId, from, tier) {
  const payload = JSON.stringify({ tier: tier.id, uid: from.id, ts: Date.now() });
  const result = await tg('sendInvoice', {
    chat_id: chatId,
    title: 'ShadeVisuals — ' + tier.title,
    description: tier.id === 'beta'
      ? 'Подписка Beta: роль Beta + доступ к визуалам. После оплаты придёт ключ активации.'
      : 'Подписка Pro: все визуалы, косметика и эффекты. После оплаты придёт ключ активации.',
    payload,
    currency: CURRENCY,
    prices: [{ label: 'ShadeVisuals — ' + tier.title, amount: tier.stars }],
  });
  if (!result.ok) {
    await tg('sendMessage', { chat_id: chatId, text: 'Не удалось выставить счёт. Попробуй позже.' });
  }
}

async function startHwidInvoice(chatId, from, nick) {
  const payload = JSON.stringify({ tier: 'hwid', nick, uid: from.id, ts: Date.now() });
  const result = await tg('sendInvoice', {
    chat_id: chatId,
    title: 'ShadeVisuals — сброс HWID',
    description: 'Сброс привязки ПК для аккаунта ' + nick + '. После оплаты HWID сбрасывается автоматически.',
    payload,
    currency: CURRENCY,
    prices: [{ label: 'Сброс HWID', amount: TIERS.hwid.stars }],
  });
  if (!result.ok) {
    await tg('sendMessage', { chat_id: chatId, text: 'Не удалось выставить счёт. Попробуй позже.' });
  }
}

async function handlePreCheckout(query) {
  let payload = null;
  try {
    payload = JSON.parse(query.invoice_payload || '{}');
  } catch {
    payload = null;
  }
  const tier = payload && TIERS[payload.tier] ? TIERS[payload.tier] : null;
  const valid = Boolean(payload && tier)
    && query.currency === CURRENCY
    && Number(query.total_amount) === tier.stars
    && (tier.id !== 'hwid' || Boolean(payload && payload.nick));
  await tg('answerPreCheckoutQuery', {
    pre_checkout_query_id: query.id,
    ok: valid,
    ...(valid ? {} : { error_message: 'Счёт устарел или сумма неверна. Нажми кнопку тарифа заново.' }),
  });
}

async function handlePaid(message, deps) {
  const chatId = message.chat.id;
  const payment = message.successful_payment;
  const chargeId = String(payment.telegram_payment_charge_id || '');
  const uid = message.from && message.from.id;
  let payload = null;
  try {
    payload = JSON.parse(payment.invoice_payload || '{}');
  } catch {
    payload = null;
  }
  const tier = payload && TIERS[payload.tier] ? TIERS[payload.tier] : TIERS.basic;
  if (payment.currency !== CURRENCY || Number(payment.total_amount) !== tier.stars) {
    await tg('sendMessage', { chat_id: chatId, text: 'Сумма оплаты не совпала. Напиши в поддержку.' });
    return;
  }
  const purchases = readJson(purchasesFile(deps), []);
  if (Array.isArray(purchases) && purchases.some((item) => item && item.chargeId === chargeId)) {
    await tg('sendMessage', { chat_id: chatId, text: 'Этот платёж уже обработан ✅' });
    return;
  }
  const verified = await verifyStarTransaction(chargeId, uid, tier.stars);
  if (!verified) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: 'Не удалось подтвердить платёж у Telegram. Напиши в поддержку, номер платежа: ' + chargeId,
    });
    return;
  }
  if (tier.id === 'hwid') {
    const nick = String(payload && payload.nick || '');
    const requests = readJson(hwidFile(deps), []);
    requests.push({
      nick,
      buyerId: uid,
      username: (message.from && message.from.username) || '',
      chargeId,
      at: Date.now(),
    });
    writeJson(hwidFile(deps), requests);

    let cleared = null;
    try {
      cleared = await deps.store.clearHwid(nick);
    } catch (error) {
      console.error('[tg-shop] hwid auto reset failed', error && error.message);
    }
    const auto = Boolean(cleared);

    let notified = false;
    if (adminId()) {
      const adminMessage = await tg('sendMessage', {
        chat_id: adminId(),
        parse_mode: 'HTML',
        text: (auto ? '<b>✅ HWID сброшен автоматически</b>' : '<b>🛠 Заявка на сброс HWID</b>') + '\n\n'
          + 'Ник: <b>' + escapeHtml(nick) + '</b>\n'
          + 'Telegram: ' + (message.from && message.from.username ? '@' + escapeHtml(message.from.username) : 'id ' + uid) + '\n'
          + 'Оплата: <b>' + tier.stars + ' ⭐</b>\n'
          + 'Чек: <code>' + chargeId + '</code>\n\n'
          + (auto
            ? 'Если нужно сбросить ещё раз — кнопка ниже.'
            : 'Автосброс не сработал: сбрось вручную кнопкой ниже или в админке.'),
        reply_markup: { inline_keyboard: [[{ text: auto ? 'Сбросить ещё раз' : 'Сбросить HWID', callback_data: 'hwidreset:' + nick }]] },
      });
      notified = Boolean(adminMessage && adminMessage.ok);
    }
    await tg('sendMessage', {
      chat_id: chatId,
      text: auto
        ? '✅ Оплата получена, HWID сброшен. Зайди в лаунчер заново — привяжется новый ПК.'
        : (notified
          ? '✅ Оплата получена. Заявка отправлена администратору — HWID сбросят вручную.'
          : '✅ Оплата получена, но сбросить не удалось. Напиши в поддержку и приложи чек: ' + chargeId),
    });
    return;
  }
  const issued = await issueKey(tier, uid);
  if (!issued || !issued.key) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: 'Платёж прошёл, но выдать ключ не удалось. Напиши в поддержку, номер платежа: ' + chargeId,
    });
    return;
  }
  purchases.push({ chargeId, stars: tier.stars, tier: tier.id, telegramId: String(uid), key: issued.key, at: Date.now() });
  writeJson(purchasesFile(deps), purchases);

  const users = readJson(usersFile(deps), {});
  users[String(uid)] = { key: issued.key, tier: tier.id, at: Date.now() };
  writeJson(usersFile(deps), users);

  await tg('sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    text: '<b>✅ Оплата получена</b>\n\n'
      + 'Тариф: <b>' + tier.title + '</b>\n'
      + 'Ключ: <code>' + issued.key + '</code>\n\n'
      + 'Активация: открой лоунчер → <b>Настройки</b> → <b>Активировать ключ</b> и вставь ключ.\n'
      + 'Ключ одноразовый. Зарегистрироваться можно после покупки — доступ активируется на твой аккаунт.',
  });
  await deliverSetup(chatId, deps);
}

async function issueKey(tier, uid) {
  if (!shopSecret()) {
    console.error('[tg-shop] TG_SHOP_SECRET is not configured');
    return null;
  }
  try {
    const message = tier.id + '|' + uid;
    const signature = crypto.createHmac('sha256', shopSecret()).update(message).digest('hex');
    const response = await fetch(SHOP_URL + '/v1/keys/issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shop-Signature': signature },
      body: JSON.stringify({ tier: tier.id, telegramId: String(uid) }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok) {
      console.error('[tg-shop] issue failed', response.status, JSON.stringify(body).slice(0, 200));
      return null;
    }
    return body;
  } catch (error) {
    console.error('[tg-shop] issue error', error && error.message);
    return null;
  }
}

async function sendKeys(chatId, userId, deps) {
  const users = readJson(usersFile(deps), {});
  const entry = users[String(userId)];
  if (!entry || !entry.key) {
    await tg('sendMessage', { chat_id: chatId, text: 'Покупок пока нет. Выбери тариф в /start.', reply_markup: menuKeyboard() });
    return;
  }
  const tier = TIERS[entry.tier] || TIERS.basic;
  await tg('sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    text: 'Тариф: <b>' + tier.title + '</b>\nКлюч: <code>' + entry.key + '</code>\n\n'
      + 'Активация: лоунчер → Настройки → Активировать ключ.',
  });
}

async function handleSetupDocument(message, deps) {
  const fromId = String(message.from && message.from.id || '');
  if (!adminId() || fromId !== adminId()) {
    await tg('sendMessage', { chat_id: message.chat.id, text: 'Загрузка установщика доступна только администратору.' });
    return;
  }
  const doc = message.document || {};
  const name = String(doc.file_name || '');
  if (!/\.(exe|zip|7z)$/i.test(name)) {
    await tg('sendMessage', {
      chat_id: message.chat.id,
      text: 'Пришли установщик файлом (.exe, .zip или .7z) — сохраню и буду выдавать после покупки.',
    });
    return;
  }
  const info = {
    fileId: doc.file_id,
    fileUniqueId: doc.file_unique_id,
    fileName: name,
    fileSize: Number(doc.file_size || 0),
    savedAt: Date.now(),
  };
  writeJson(path.join(dataDir(deps), 'tg-shop-setup.json'), info);
  try {
    if (deps.store && deps.store.setState) await deps.store.setState('tg_shop_setup', JSON.stringify(info));
  } catch (error) {
    console.error('[tg-shop] setup state save failed', error && error.message);
  }
  await tg('sendMessage', {
    chat_id: message.chat.id,
    parse_mode: 'HTML',
    text: '✅ Установщик сохранён: <b>' + escapeHtml(name) + '</b> (' + (info.fileSize / 1048576).toFixed(1) + ' МБ).\n'
      + 'Теперь он будет приходить покупателю сразу после оплаты.',
  });
}

async function deliverSetup(chatId, deps) {
  let info = null;
  try {
    const stored = deps.store && deps.store.getState ? await deps.store.getState('tg_shop_setup') : null;
    if (stored) info = JSON.parse(stored);
  } catch (error) {
    console.error('[tg-shop] setup state read failed', error && error.message);
  }
  if (!info) info = readJson(path.join(dataDir(deps), 'tg-shop-setup.json'), null);
  if (info && info.fileId) {
    const result = await tg('sendDocument', {
      chat_id: chatId,
      document: info.fileId,
      parse_mode: 'HTML',
      caption: '<b>📦 ShadeVisuals Setup</b>\n\nЗапусти установщик и войди в аккаунт — визуалы уже открыты.',
    });
    if (result.ok) return;
    console.error('[tg-shop] sendDocument failed', JSON.stringify(result).slice(0, 200));
  }
  await tg('sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    text: '<b>📦 Скачать ShadeVisuals Loader</b>\n\nНажми кнопку ниже — установщик скачается с сервера. После установки войди в аккаунт.',
    reply_markup: { inline_keyboard: [[{ text: '⬇️ Скачать лоудер', url: SHOP_URL + '/v1/loader/download' }]] },
  });
}

async function verifyStarTransaction(chargeId, uid, stars) {
  const result = await tg('getStarTransactions', { offset: 0, limit: 100 });
  if (!result.ok || !result.result || !Array.isArray(result.result.transactions)) {
    console.warn('[tg-shop] getStarTransactions unavailable, refusing to grant');
    return false;
  }
  return result.result.transactions.some((tx) => String(tx.id) === String(chargeId)
    && Number(tx.amount) === stars
    && tx.source && tx.source.user && Number(tx.source.user.id) === Number(uid));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = { handleUpdate, PRICE: TIERS.basic.stars, TIERS };
