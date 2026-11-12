'use strict';
/**
 * ShadeVisuals — Telegram-магазин визуалов за 200 Stars (webhook внутри API-сервера).
 * Не требует отдельного хостинга: живет в shadevis-api.
 */
const fs = require('node:fs');
const path = require('node:path');

const PRICE = 200;
const CURRENCY = 'XTR';

function token() {
  return process.env.TG_SHOP_BOT_TOKEN || process.env.SUPPORT_BOT_TOKEN
    || '9136047120:AAEZylqHhcVDAoUIZIzSgZtRuPc9p4F7zuk';
}

function webhookSecret() {
  return process.env.TG_WEBHOOK_SECRET || 'shade-tg-shop';
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

function menuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: 'Купить визуалы — ' + PRICE + ' ⭐', callback_data: 'buy' }],
      [{ text: 'Проверить доступ', callback_data: 'status' }],
    ],
  };
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

async function handleUpdate(req, update, deps) {
  const secret = req.headers['x-telegram-bot-api-secret-token']
    || new URL(req.url, 'http://localhost').searchParams.get('secret');
  if (String(secret || '') !== webhookSecret()) {
    return { status: 403, payload: { error: 'forbidden' } };
  }
  try {
    if (update.message) {
      await handleMessage(update.message, deps);
    } else if (update.callback_query) {
      await handleCallback(update.callback_query, deps);
    } else if (update.pre_checkout_query) {
      await handlePreCheckout(update.pre_checkout_query);
    }
  } catch (error) {
    console.error('[tg-shop] update failed', error && error.stack);
  }
  return { status: 200, payload: { ok: true } };
}

async function handleMessage(message, deps) {
  const chatId = message.chat.id;
  const text = String(message.text || '').trim();

  if (message.successful_payment) {
    return handlePaid(message, deps);
  }
  if (text === '/start' || text === '/help' || text === '/buy') {
    await tg('sendMessage', {
      chat_id: chatId,
      parse_mode: 'HTML',
      text: '<b>ShadeVisuals</b>\n\nВизуалы клиента — <b>' + PRICE + ' ⭐</b>.\n\n'
        + 'Оплата звёздами Telegram. Доступ привяжется к нику в лаунчере.\n'
        + 'После покупки перезайди в лаунчер — план обновится.',
      reply_markup: menuKeyboard(),
    });
    return;
  }
  if (text === '/status') {
    return sendStatus(chatId, message.from && message.from.id, deps);
  }
  if (message.reply_to_message && message.reply_to_message.from
      && message.reply_to_message.from.is_bot) {
    const nick = text.replace(/[^A-Za-z0-9_]/g, '').trim();
    if (nick.length < 3 || nick.length > 16) {
      await tg('sendMessage', { chat_id: chatId, text: 'Ник должен быть 3–16 символов (латиница, цифры, _).' });
      return;
    }
    return startPurchase(chatId, message.from, nick, deps);
  }
  await tg('sendMessage', { chat_id: chatId, text: 'Нажми /start, чтобы открыть магазин.', reply_markup: menuKeyboard() });
}

async function handleCallback(query, deps) {
  const data = query.data || '';
  const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
  await tg('answerCallbackQuery', { callback_query_id: query.id });
  if (data === 'buy') {
    await tg('sendMessage', {
      chat_id: chatId,
      text: 'Введи свой ник в клиенте ShadeVisuals (тот, под которым заходишь в лаунчер):',
      reply_markup: { force_reply: true, selective: true },
    });
    return;
  }
  if (data === 'status') {
    return sendStatus(chatId, query.from && query.from.id, deps);
  }
}

function usersFile(deps) {
  return path.join(deps.DATA_DIR || path.join(__dirname, 'data'), 'tg-shop-users.json');
}

function purchasesFile(deps) {
  return path.join(deps.DATA_DIR || path.join(__dirname, 'data'), 'tg-shop-purchases.json');
}

async function sendStatus(chatId, userId, deps) {
  const users = readJson(usersFile(deps), {});
  const nick = users[String(userId)];
  if (!nick) {
    await tg('sendMessage', { chat_id: chatId, text: 'Ник ещё не привязан. Нажми «Купить».', reply_markup: menuKeyboard() });
    return;
  }
  const account = await deps.store.findAccount(nick);
  const plan = account ? String(account.plan || 'Classic') : 'аккаунт не найден';
  const plus = account ? plan.toLowerCase().includes('plus') : false;
  await tg('sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    text: 'Ник: <b>' + escapeHtml(nick) + '</b>\nПлан: <b>' + escapeHtml(plan) + '</b>\n'
      + 'Визуалы: ' + (plus ? '✅ открыты' : '❌ не куплены'),
  });
}

async function startPurchase(chatId, from, nick, deps) {
  const account = await deps.store.findAccount(nick);
  if (!account) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: 'Аккаунт «' + nick + '» не найден в ShadeVisuals. Зарегистрируйся в лаунчере и попробуй снова.',
    });
    return;
  }
  const plan = String(account.plan || 'Classic');
  if (plan.toLowerCase().includes('plus')) {
    await tg('sendMessage', { chat_id: chatId, text: 'У аккаунта «' + nick + '» визуалы уже открыты ✅' });
    return;
  }
  const users = readJson(usersFile(deps), {});
  users[String(from.id)] = account.nick;
  writeJson(usersFile(deps), users);

  await tg('sendMessage', { chat_id: chatId, text: 'Счёт на ' + PRICE + ' ⭐ для аккаунта «' + nick + '»:' });
  const payload = JSON.stringify({ nick: account.nick, uid: from.id, ts: Date.now() });
  const result = await tg('sendInvoice', {
    chat_id: chatId,
    title: 'ShadeVisuals — визуалы',
    description: 'Доступ к визуалам клиента ShadeVisuals для аккаунта ' + account.nick + '.',
    payload,
    currency: CURRENCY,
    prices: [{ label: 'Визуалы ShadeVisuals', amount: PRICE }],
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
  const valid = Boolean(payload && payload.nick)
    && query.currency === CURRENCY
    && Number(query.total_amount) === PRICE;
  await tg('answerPreCheckoutQuery', {
    pre_checkout_query_id: query.id,
    ok: valid,
    ...(valid ? {} : { error_message: 'Счёт устарел или сумма неверна. Нажми «Купить» заново.' }),
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
  const users = readJson(usersFile(deps), {});
  const nick = payload && payload.nick ? String(payload.nick) : users[String(uid)];

  if (!nick || !chargeId) {
    await tg('sendMessage', { chat_id: chatId, text: 'Оплата пришла, но не удалось определить аккаунт. Напиши в поддержку.' });
    return;
  }
  if (payment.currency !== CURRENCY || Number(payment.total_amount) !== PRICE) {
    await tg('sendMessage', { chat_id: chatId, text: 'Сумма оплаты не совпала. Напиши в поддержку.' });
    return;
  }
  const purchases = readJson(purchasesFile(deps), []);
  if (Array.isArray(purchases) && purchases.some((item) => item && item.chargeId === chargeId)) {
    await tg('sendMessage', { chat_id: chatId, text: 'Этот платёж уже обработан ✅ Перезайди в лаунчер.' });
    return;
  }
  const verified = await verifyStarTransaction(chargeId, uid);
  if (!verified) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: 'Не удалось подтвердить платёж у Telegram. Напиши в поддержку, номер платежа: ' + chargeId,
    });
    return;
  }
  const account = await deps.store.findAccount(nick);
  if (!account) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: 'Платёж прошёл, но аккаунт «' + nick + '» не найден. Напиши в поддержку, номер платежа: ' + chargeId,
    });
    return;
  }
  await deps.store.updateAccount(account.nick, { plan: 'Classic+Plus' });
  purchases.push({ nick: account.nick, chargeId, stars: PRICE, telegramId: String(uid), at: Date.now() });
  writeJson(purchasesFile(deps), purchases);
  users[String(uid)] = account.nick;
  writeJson(usersFile(deps), users);
  console.log('[tg-shop] granted visuals to', account.nick, 'charge', chargeId);
  await tg('sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    text: '✅ Оплата получена. Визуалы открыты для аккаунта <b>' + escapeHtml(account.nick) + '</b>.\n\n'
      + 'Перезайди в лаунчер (выйди и войди в аккаунт), чтобы план обновился.',
  });
}

async function verifyStarTransaction(chargeId, uid) {
  const result = await tg('getStarTransactions', { offset: 0, limit: 100 });
  if (!result.ok || !result.result || !Array.isArray(result.result.transactions)) {
    console.warn('[tg-shop] getStarTransactions unavailable, fallback to successful_payment');
    return true;
  }
  return result.result.transactions.some((tx) => String(tx.id) === String(chargeId)
    && Number(tx.amount) === PRICE
    && tx.source && tx.source.user && Number(tx.source.user.id) === Number(uid));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = { handleUpdate, PRICE };
