'use strict';

/**
 * Tests for src/webhook.js — inbound SMS replies and public TTS audio.
 * Runs a real local HTTP server; Twilio signatures are computed with the
 * real twilio library so signature validation is exercised end to end.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const querystring = require('querystring');

process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'webhook-test-'));

jest.mock('../src/config');
jest.mock('../src/escalation', () => ({ disarmAll: jest.fn(() => 2) }));

const twilio = require('twilio');
const { getConfig } = require('../src/config');
const { disarmAll } = require('../src/escalation');
const { handleRequest, AUDIO_DIR } = require('../src/webhook');

const AUTH_TOKEN = 'authtokentest';
const PUBLIC_URL = 'http://203.0.113.10:8080';
const TAEGAN = '+15550000002';

let server;
let port;

beforeAll(done => {
  server = http.createServer(handleRequest);
  server.listen(0, '127.0.0.1', () => {
    port = server.address().port;
    done();
  });
});

afterAll(done => {
  server.close(() => done());
});

beforeEach(() => {
  jest.clearAllMocks();
  getConfig.mockReturnValue({
    taegan_phone: TAEGAN,
    env: { twilio_auth_token: AUTH_TOKEN, public_base_url: PUBLIC_URL },
  });
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(() => jest.restoreAllMocks());

function request(method, urlPath, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path: urlPath, headers },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function postSms(params, { signature } = {}) {
  const sig = signature ?? twilio.getExpectedTwilioSignature(AUTH_TOKEN, `${PUBLIC_URL}/sms`, params);
  return request('POST', '/sms', {
    body: querystring.stringify(params),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Twilio-Signature': sig,
    },
  });
}

describe('POST /sms', () => {
  test('reply from Taegan cancels pending escalations', async () => {
    const res = await postSms({ From: TAEGAN, Body: 'ok' });
    expect(res.status).toBe(200);
    expect(res.body.toString()).toContain('<Response></Response>');
    expect(disarmAll).toHaveBeenCalledTimes(1);
  });

  test('message from another number does not cancel escalations', async () => {
    const res = await postSms({ From: '+15559999999', Body: 'ok' });
    expect(res.status).toBe(200);
    expect(disarmAll).not.toHaveBeenCalled();
  });

  test('request with an invalid signature is rejected', async () => {
    const res = await postSms({ From: TAEGAN, Body: 'ok' }, { signature: 'forged' });
    expect(res.status).toBe(403);
    expect(disarmAll).not.toHaveBeenCalled();
  });

  test('request with no signature is rejected', async () => {
    const res = await request('POST', '/sms', { body: `From=${encodeURIComponent(TAEGAN)}` });
    expect(res.status).toBe(403);
    expect(disarmAll).not.toHaveBeenCalled();
  });
});

describe('GET /audio', () => {
  const NAME = 'tts-1700000000000-0123456789abcdef.mp3';

  beforeAll(() => {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
    fs.writeFileSync(path.join(AUDIO_DIR, NAME), 'FAKE_AUDIO');
    fs.writeFileSync(path.join(process.env.HOME, 'secret.txt'), 'SECRET');
  });

  test('serves generated TTS audio', async () => {
    const res = await request('GET', `/audio/${NAME}`);
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe('FAKE_AUDIO');
  });

  test('returns 404 for an unknown audio file', async () => {
    const res = await request('GET', '/audio/tts-1-aaaaaaaaaaaaaaaa.mp3');
    expect(res.status).toBe(404);
  });

  test('refuses path traversal', async () => {
    const res = await request('GET', '/audio/..%2F..%2F..%2Fsecret.txt');
    expect(res.status).toBe(404);
    expect(res.body.toString()).not.toContain('SECRET');
  });
});

test('unknown routes return 404', async () => {
  const res = await request('GET', '/');
  expect(res.status).toBe(404);
});
