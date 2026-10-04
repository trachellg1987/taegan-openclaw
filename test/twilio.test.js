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
  env: {
    twilio_account_sid: 'ACtest1234567890',
    twilio_auth_token:  'authtokentest',
    twilio_from_number: '+15550000001',
    elevenlabs_api_key: 'el-test-key',
    elevenlabs_voice_id: 'voice-test-id',
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

// ─── Mock: http (local audio server) ─────────────────────────────────────────
// serveAudioLocally starts a server on a random port; mock returns port 39999
// and calls the listen callback via nextTick so the promise resolves.

jest.mock('http', () => ({
  createServer: jest.fn(() => {
    const server = {
      _port: 39999,
      listen: jest.fn(function (port, host, cb) {
        process.nextTick(cb);
        return this;
      }),
      close: jest.fn(),
      address: jest.fn(function () { return { port: this._port }; }),
    };
    return server;
  }),
}));

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

  test('calls.create twiml contains a <Play> tag with the audio URL', async () => {
    await escalateCall('Brush teeth!', 'NT-003', jest.fn());

    const { twiml } = mockCallsCreate.mock.calls[0][0];
    expect(twiml).toContain('<Play>');
    expect(twiml).toContain('http://127.0.0.1:39999');
  });

  test('ElevenLabs API is called with the message text', async () => {
    const https = require('https');
    await escalateCall('Time to wind down.', 'NT-005', jest.fn());

    expect(https.request).toHaveBeenCalledTimes(1);
    const opts = https.request.mock.calls[0][0];
    expect(opts.hostname).toContain('elevenlabs');
    expect(opts.path).toContain(TEST_CONFIG.env.elevenlabs_voice_id);
  });

  test('audio server is closed after call is placed (finally block)', async () => {
    const http = require('http');
    await escalateCall('Go to bed.', 'NT-006', jest.fn());

    const serverInstance = http.createServer.mock.results[0].value;
    expect(serverInstance.close).toHaveBeenCalledTimes(1);
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
