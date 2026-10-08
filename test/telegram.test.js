'use strict';

/**
 * Tests for src/telegram.js and Telegram routing in src/imessage.js.
 * The Telegram Bot API is mocked via global.fetch.
 */

jest.mock('../src/config');

const mockSmsCreate = jest.fn(async () => ({ sid: 'SM1' }));
jest.mock('twilio', () => jest.fn(() => ({ messages: { create: mockSmsCreate } })));

const { getConfig } = require('../src/config');
const telegram = require('../src/telegram');
const { sendMessage } = require('../src/imessage');

const TAEGAN = '+15550000002';
const PARENT = '+15550000003';
const CHAT_ID = '7222104216';
const TOKEN = '123:test-token';

const CONFIG = {
  taegan_phone: TAEGAN,
  parent_phone: PARENT,
  approved_contacts: [TAEGAN, PARENT],
  env: {
    telegram_bot_token: TOKEN,
    telegram_chat_id: CHAT_ID,
    twilio_account_sid: 'ACtest',
    twilio_auth_token: 'authtokentest',
    twilio_from_number: '+15550000001',
  },
};

let fetchMock;

function apiCalls(method) {
  return fetchMock.mock.calls
    .filter(([url]) => url.endsWith(`/${method}`))
    .map(([, opts]) => JSON.parse(opts.body));
}

beforeEach(() => {
  getConfig.mockReturnValue(CONFIG);
  fetchMock = jest.fn(async () => ({
    json: async () => ({ ok: true, result: { message_id: 42 } }),
  }));
  global.fetch = fetchMock;
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => jest.restoreAllMocks());

describe('sendReminder', () => {
  test('sends to the configured chat with a Done button', async () => {
    const id = await telegram.sendReminder('Brush your teeth.');
    expect(id).toBe(42);
    expect(fetchMock.mock.calls[0][0]).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    const [body] = apiCalls('sendMessage');
    expect(body.chat_id).toBe(CHAT_ID);
    expect(body.text).toBe('Brush your teeth.');
    expect(body.reply_markup.inline_keyboard[0][0]).toEqual({ text: '✅ Done', callback_data: 'done' });
  });

  test('throws with Telegram\'s description when the API refuses', async () => {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({ ok: false, error_code: 403, description: 'bot was blocked by the user' }),
    });
    await expect(telegram.sendReminder('Hi')).rejects.toThrow(/bot was blocked/);
  });
});

describe('handleUpdate', () => {
  const callback = (data, chatId = CHAT_ID) => ({
    update_id: 1,
    callback_query: { id: 'cb1', data, message: { message_id: 42, chat: { id: Number(chatId) } } },
  });

  test('Done tap cancels escalations and acknowledges', async () => {
    const disarmAll = jest.fn(() => 1);
    await expect(telegram.handleUpdate(callback('done'), disarmAll)).resolves.toBe(true);
    expect(disarmAll).toHaveBeenCalledTimes(1);
    expect(apiCalls('answerCallbackQuery')[0].callback_query_id).toBe('cb1');
    expect(apiCalls('editMessageReplyMarkup')[0].message_id).toBe(42);
  });

  test('tapping an already-completed button does nothing', async () => {
    const disarmAll = jest.fn();
    await expect(telegram.handleUpdate(callback('noop'), disarmAll)).resolves.toBe(false);
    expect(disarmAll).not.toHaveBeenCalled();
  });

  test('text reply from Taegan cancels escalations', async () => {
    const disarmAll = jest.fn(() => 2);
    const update = { update_id: 2, message: { text: 'done', chat: { id: Number(CHAT_ID) } } };
    await expect(telegram.handleUpdate(update, disarmAll)).resolves.toBe(true);
    expect(disarmAll).toHaveBeenCalledTimes(1);
    expect(apiCalls('sendMessage')[0].text).toBe('👍 Got it.');
  });

  test('updates from any other chat are ignored', async () => {
    const disarmAll = jest.fn();
    await expect(telegram.handleUpdate(callback('done', '999'), disarmAll)).resolves.toBe(false);
    const msg = { update_id: 3, message: { text: 'hi', chat: { id: 999 } } };
    await expect(telegram.handleUpdate(msg, disarmAll)).resolves.toBe(false);
    expect(disarmAll).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('isConfigured', () => {
  test('requires both token and chat id', () => {
    expect(telegram.isConfigured(CONFIG.env)).toBe(true);
    expect(telegram.isConfigured({ ...CONFIG.env, telegram_chat_id: '' })).toBe(false);
    expect(telegram.isConfigured({ ...CONFIG.env, telegram_bot_token: undefined })).toBe(false);
  });
});

describe('sendMessage routing', () => {
  test('messages to Taegan go to Telegram when configured', async () => {
    const ids = await sendMessage(TAEGAN, 'Wake up!');
    expect(ids).toEqual([42]);
    expect(apiCalls('sendMessage')[0].text).toBe('Wake up!');
  });

  test('long messages to Taegan are split under Telegram\'s limit', async () => {
    const { MAX_TELEGRAM_LENGTH } = require('../src/imessage');
    await sendMessage(TAEGAN, 'word '.repeat(1500));
    const parts = apiCalls('sendMessage');
    expect(parts.length).toBeGreaterThan(1);
    parts.forEach(p => expect(p.text.length).toBeLessThanOrEqual(MAX_TELEGRAM_LENGTH));
  });

  test('Telegram failure resolves to null instead of rejecting', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    await expect(sendMessage(TAEGAN, 'Hi')).resolves.toBeNull();
  });

  test('messages to the parent still go by SMS', async () => {
    await sendMessage(PARENT, 'Nightly summary');
    expect(mockSmsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ to: PARENT, body: 'Nightly summary' })
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('approved-contacts block still applies', () => {
    expect(() => sendMessage('+15559999999', 'Hi')).toThrow(/not in approved_contacts/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
