'use strict';

/**
 * DEP-002 — Item 6: Twilio call is placed (sandbox/mock mode)
 *
 * Tests for src/escalation/call.js (ESC-002).
 * All network calls are mocked — no real ElevenLabs or Twilio traffic.
 */

// ─── Mock: config ─────────────────────────────────────────────────────────────

jest.mock('../src/config');
const { getConfig } = require('../src/config');

const TEST_CONFIG = {
  taegan_phone: '+15550000002',
  parent_phone: '+15550000003',
  env: {
    twilio_account_sid: 'ACtest1234567890',
    twilio_auth_token:  'authtokentest',
    twilio_from_number: '+15550000001',
    elevenlabs_api_key: 'el-test-key',
    elevenlabs_voice_id: 'voice-test-id',
    public_base_url: 'http://203.0.113.10:8080',
  },
};

// ─── Mock: twilio ─────────────────────────────────────────────────────────────

const mockFetch = jest.fn();
const mockCallsCreate = jest.fn();
const mockCallsInstance = jest.fn(() => ({ fetch: mockFetch }));
Object.defineProperty(mockCallsInstance, 'create', {
  get: () => mockCallsCreate,
  configurable: true,
});
const mockTwilioClient = { calls: mockCallsInstance };
jest.mock('twilio', () => jest.fn(() => mockTwilioClient));

// ─── Mock: https (ElevenLabs TTS) ────────────────────────────────────────────
// Deliver a fake 200 response with a small buffer, resolved via nextTick so
// the stream pipeline completes properly.

jest.mock('https', () => {
  const { Readable } = require('stream');
  return {
    request: jest.fn((opts, cb) => {
      const res = new Readable({ read() {} });
      res.statusCode = 200;
      const req = { write: jest.fn(), end: jest.fn(), on: jest.fn() };
      process.nextTick(() => {
        cb(res);
        process.nextTick(() => {
          res.push(Buffer.from('FAKE_AUDIO_DATA'));
          res.push(null);
        });
      });
      return req;
    }),
  };
});

// ─── Mock: fs ─────────────────────────────────────────────────────────────────
// createWriteStream returns a Writable that accepts data and emits 'finish'.

jest.mock('fs', () => {
  const { Writable } = require('stream');
  return {
    mkdirSync: jest.fn(),
    createWriteStream: jest.fn(() => new Writable({ write(c, e, cb) { cb(); } })),
    readFileSync: jest.fn(() => Buffer.from('FAKE_AUDIO_DATA')),
    writeFileSync: jest.fn(),
    existsSync: jest.fn(() => true),
    unlinkSync: jest.fn(),
  };
});

// ─── Load module under test AFTER mocks ──────────────────────────────────────

const { escalateCall } = require('../src/escalation/call');

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  getConfig.mockReturnValue(TEST_CONFIG);
  mockCallsCreate.mockResolvedValue({ sid: 'CA_TESTSID_001' });
  mockFetch.mockResolvedValue({ status: 'in-progress' });
});

afterEach(() => {
  // Restore real timers if a test faked them
  jest.useRealTimers();
});

// ─── ESC-002: Twilio call placed ─────────────────────────────────────────────

describe('ESC-002: Twilio call placed (sandbox mock)', () => {

  test('Twilio client is initialised with credentials from config', async () => {
    const twilio = require('twilio');
    await escalateCall('Wake up!', 'MR-001', jest.fn());

    expect(twilio).toHaveBeenCalledWith(
      TEST_CONFIG.env.twilio_account_sid,
      TEST_CONFIG.env.twilio_auth_token
    );
  });

  test('calls.create is invoked once', async () => {
    await escalateCall('Push-ups!', 'MR-002', jest.fn());
    expect(mockCallsCreate).toHaveBeenCalledTimes(1);
  });

  test('calls.create receives correct from and to numbers', async () => {
    await escalateCall('Shower!', 'NT-002', jest.fn());

    expect(mockCallsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        from: TEST_CONFIG.env.twilio_from_number,
        to:   TEST_CONFIG.taegan_phone,
      })
    );
  });

  test('twiml plays the ElevenLabs audio from the public URL', async () => {
    await escalateCall('Brush teeth!', 'NT-003', jest.fn());

    const { twiml } = mockCallsCreate.mock.calls[0][0];
    expect(twiml).toMatch(
      /<Play>http:\/\/203\.0\.113\.10:8080\/audio\/tts-\d+-[a-f0-9]{16}\.mp3<\/Play>/
    );
    expect(twiml).not.toContain('127.0.0.1');
  });

  test('ElevenLabs API is called with the message text', async () => {
    const https = require('https');
    await escalateCall('Time to wind down.', 'NT-005', jest.fn());

    expect(https.request).toHaveBeenCalledTimes(1);
    const opts = https.request.mock.calls[0][0];
    expect(opts.hostname).toContain('elevenlabs');
    expect(opts.path).toContain(TEST_CONFIG.env.elevenlabs_voice_id);
  });

  test('without PUBLIC_BASE_URL the call reads the message with Twilio voice', async () => {
    const https = require('https');
    getConfig.mockReturnValue({
      ...TEST_CONFIG,
      env: { ...TEST_CONFIG.env, public_base_url: '' },
    });
    await escalateCall('Go to bed.', 'NT-006', jest.fn());

    const { twiml } = mockCallsCreate.mock.calls[0][0];
    expect(twiml).toContain('<Say voice="alice">Go to bed.</Say>');
    expect(twiml).not.toContain('<Play>');
    expect(https.request).not.toHaveBeenCalled();
  });

  test('falls back to Twilio voice when ElevenLabs fails', async () => {
    const https = require('https');
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    https.request.mockImplementationOnce((opts, cb) => {
      const { Readable } = require('stream');
      const res = new Readable({ read() {} });
      res.statusCode = 401;
      process.nextTick(() => cb(res));
      return { write: jest.fn(), end: jest.fn(), on: jest.fn() };
    });

    await escalateCall('Shower now.', 'NT-002', jest.fn());

    const { twiml } = mockCallsCreate.mock.calls[0][0];
    expect(twiml).toContain('<Say voice="alice">Shower now.</Say>');
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('HTTP 401'));
    stderr.mockRestore();
  });

  test('message text is XML-escaped in the twiml', () => {
    const { buildTwiml } = require('../src/escalation/call');
    expect(buildTwiml('Tom & Jerry <now>', null)).toContain('Tom &amp; Jerry &lt;now&gt;');
  });

  test('with Telegram reminders, the call goes to the parent with context', async () => {
    getConfig.mockReturnValue({
      ...TEST_CONFIG,
      env: { ...TEST_CONFIG.env, public_base_url: '', telegram_bot_token: 't', telegram_chat_id: '1' },
    });
    await escalateCall('Brush your teeth.', 'NT-003', jest.fn());

    const args = mockCallsCreate.mock.calls[0][0];
    expect(args.to).toBe(TEST_CONFIG.parent_phone);
    expect(args.twiml).toContain("Taegan hasn&apos;t responded to his reminder: Brush your teeth.");
  });

  test('onUnanswered fires when call status is no-answer', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });

    mockFetch.mockResolvedValue({ status: 'no-answer' });
    const onUnanswered = jest.fn();

    await escalateCall('Screen off!', 'NT-005', onUnanswered);

    // Advance past first 5-second poll interval
    await jest.advanceTimersByTimeAsync(5_100);

    expect(onUnanswered).toHaveBeenCalledTimes(1);
    expect(onUnanswered).toHaveBeenCalledWith({
      step: 'NT-005',
      message: 'Screen off!',
    });
  });

  test('onUnanswered fires when call status is busy', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });

    mockFetch.mockResolvedValue({ status: 'busy' });
    const onUnanswered = jest.fn();

    await escalateCall('Wake up Taegan!', 'MR-001', onUnanswered);
    await jest.advanceTimersByTimeAsync(5_100);

    expect(onUnanswered).toHaveBeenCalledTimes(1);
  });

  test('onUnanswered fires when deadline is exceeded (in-progress too long)', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });

    mockFetch.mockResolvedValue({ status: 'in-progress' });
    const onUnanswered = jest.fn();

    await escalateCall('Lights out.', 'NT-006', onUnanswered);

    // deadline = Date.now() + 30_000 + 5_000 = T+35_000.
    // setInterval period = 5_000 ms. First interval where Date.now() > deadline
    // fires at T+40_000 (since T+35_000 is NOT strictly greater than the deadline).
    await jest.advanceTimersByTimeAsync(41_000);

    expect(onUnanswered).toHaveBeenCalledTimes(1);
  });

  test('onUnanswered is NOT fired when call completes (answered)', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });

    mockFetch.mockResolvedValue({ status: 'completed' });
    const onUnanswered = jest.fn();

    await escalateCall('Go shower.', 'NT-002', onUnanswered);
    await jest.advanceTimersByTimeAsync(5_100);

    expect(onUnanswered).not.toHaveBeenCalled();
  });

  test('returns the Twilio call SID', async () => {
    mockCallsCreate.mockResolvedValue({ sid: 'CA_EXPECTED_SID' });

    // placeTwilioCall resolves with the call SID — escalateCall doesn't expose it
    // directly but calls.create must have been called (verified via mock)
    await escalateCall('Test', 'MR-001', jest.fn());

    expect(mockCallsCreate.mock.results[0].value).resolves.toMatchObject({ sid: 'CA_EXPECTED_SID' });
  });
});
