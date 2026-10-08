'use strict';

/**
 * Telegram delivery for Taegan's routine reminders.
 *
 * Uses a dedicated reminder bot (TELEGRAM_BOT_TOKEN), separate from the
 * Taegbot/OpenClaw bot, so this app is the only thing reading its updates.
 * Each reminder carries a ✅ Done button. Tapping it, or replying with any
 * text, stands in for the iMessage read receipt and cancels pending ESC-001
 * timers. Only updates from TELEGRAM_CHAT_ID are acted on.
 */

const { getConfig } = require('./config');

const API = 'https://api.telegram.org';
const POLL_TIMEOUT_S = 50;
const RETRY_DELAY_MS = 10_000;
const DONE = 'done';

function log(msg) {
  process.stdout.write(`[${new Date().toISOString()}] [telegram] ${msg}\n`);
}

function isConfigured(env = getConfig().env) {
  return Boolean(env.telegram_bot_token && env.telegram_chat_id);
}

async function call(method, params) {
  const { env } = getConfig();
  const res = await fetch(`${API}/bot${env.telegram_bot_token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.ok) {
    throw Object.assign(new Error(`Telegram ${method} failed: ${data.description}`), {
      code: data.error_code,
    });
  }
  return data.result;
}

/**
 * Send one reminder to Taegan's chat with a ✅ Done button.
 * Returns the Telegram message_id.
 */
async function sendReminder(text) {
  const { env } = getConfig();
  const msg = await call('sendMessage', {
    chat_id: env.telegram_chat_id,
    text,
    reply_markup: { inline_keyboard: [[{ text: '✅ Done', callback_data: DONE }]] },
  });
  return msg.message_id;
}

/**
 * Handle one update from getUpdates. Exported for tests.
 * Returns true if it cancelled escalations.
 */
async function handleUpdate(update, disarmAll) {
  const chatId = String(getConfig().env.telegram_chat_id);

  const cb = update.callback_query;
  if (cb) {
    if (String(cb.message?.chat?.id) !== chatId) return false;
    if (cb.data !== DONE) {
      await call('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});
      return false;
    }
    const cancelled = disarmAll();
    log(`Done tapped — cancelled ${cancelled} escalation timer(s)`);
    await call('answerCallbackQuery', { callback_query_id: cb.id, text: 'Nice work! 🏆' });
    // Swap the button for a checkmark so it can't be tapped again
    await call('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: cb.message.message_id,
      reply_markup: { inline_keyboard: [[{ text: '✅ Done!', callback_data: 'noop' }]] },
    }).catch(() => {});
    return true;
  }

  const msg = update.message;
  if (msg && String(msg.chat?.id) === chatId) {
    const cancelled = disarmAll();
    log(`Reply from Taegan — cancelled ${cancelled} escalation timer(s)`);
    await call('sendMessage', { chat_id: chatId, text: '👍 Got it.' });
    return true;
  }

  return false;
}

let _running = false;

/**
 * Long-poll getUpdates forever. Errors are logged and retried; never throws.
 */
async function pollLoop(disarmAll) {
  let offset = 0;
  while (_running) {
    try {
      const updates = await call('getUpdates', {
        offset,
        timeout: POLL_TIMEOUT_S,
        allowed_updates: ['message', 'callback_query'],
      });
      for (const update of updates) {
        offset = update.update_id + 1;
        try {
          await handleUpdate(update, disarmAll);
        } catch (err) {
          log(`Error handling update ${update.update_id}: ${err.message}`);
        }
      }
    } catch (err) {
      log(`Polling error: ${err.message} — retrying in ${RETRY_DELAY_MS / 1000}s`);
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    }
  }
}

/**
 * Start listening for Taegan's Done taps and replies, if Telegram is configured.
 */
function startTelegramListener() {
  if (!isConfigured()) {
    log('TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set — Telegram reminders disabled');
    return false;
  }
  const { disarmAll } = require('./escalation');
  _running = true;
  pollLoop(disarmAll);
  log('Listening for Done taps and replies');
  return true;
}

function stopTelegramListener() {
  _running = false;
}

module.exports = {
  isConfigured,
  sendReminder,
  handleUpdate,
  startTelegramListener,
  stopTelegramListener,
};
