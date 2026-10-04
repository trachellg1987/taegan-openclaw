'use strict';

/**
 * Public webhook server (VPS only).
 *
 *   POST /sms              — Twilio inbound SMS. A reply from Taegan stands in
 *                            for the iMessage read receipt: it cancels all
 *                            pending ESC-001 timers. NT-005's mandatory
 *                            escalation uses its own timer and is unaffected.
 *   GET  /audio/<file>.mp3 — ElevenLabs TTS audio for ESC-002 calls, so Twilio
 *                            can fetch it from the public internet.
 *
 * Only runs when PUBLIC_BASE_URL is set in .env. Every /sms request must carry
 * a valid X-Twilio-Signature; anything else is rejected with 403.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const querystring = require('querystring');
const twilio = require('twilio');
const { getConfig } = require('./config');
const { disarmAll } = require('./escalation');

const AUDIO_DIR = path.join(process.env.HOME, '.openclaw', 'workspace', 'tts-cache');
const AUDIO_NAME = /^tts-\d+-[a-f0-9]{16}\.mp3$/;
const MAX_BODY_BYTES = 64 * 1024;
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function log(msg) {
  process.stdout.write(`[${new Date().toISOString()}] [webhook] ${msg}\n`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function handleSms(req, res, config) {
  const params = querystring.parse(await readBody(req));
  const url = `${config.env.public_base_url}/sms`;
  const signature = req.headers['x-twilio-signature'] || '';

  if (!twilio.validateRequest(config.env.twilio_auth_token, signature, url, params)) {
    log('Rejected /sms request with invalid Twilio signature');
    res.writeHead(403).end();
    return;
  }

  if (params.From === config.taegan_phone) {
    const cancelled = disarmAll();
    log(`Reply from Taegan — cancelled ${cancelled} escalation timer(s)`);
  } else {
    log(`Ignored inbound SMS from ${params.From}`);
  }

  res.writeHead(200, { 'Content-Type': 'text/xml' }).end(EMPTY_TWIML);
}

function handleAudio(req, res) {
  const name = decodeURIComponent(req.url.slice('/audio/'.length));
  const file = path.join(AUDIO_DIR, name);
  if (!AUDIO_NAME.test(name) || !fs.existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  const data = fs.readFileSync(file);
  res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': data.length }).end(data);
}

async function handleRequest(req, res) {
  const config = getConfig();
  try {
    if (req.method === 'POST' && req.url === '/sms') {
      await handleSms(req, res, config);
    } else if (req.method === 'GET' && req.url.startsWith('/audio/')) {
      handleAudio(req, res);
    } else {
      res.writeHead(404).end();
    }
  } catch (err) {
    log(`Error handling ${req.method} ${req.url}: ${err.message}`);
    if (!res.headersSent) res.writeHead(400);
    res.end();
  }
}

/**
 * Start the webhook server if PUBLIC_BASE_URL is configured.
 * Returns the http.Server, or null when disabled.
 */
function startWebhookServer() {
  const config = getConfig();
  if (!config.env.public_base_url) {
    log('PUBLIC_BASE_URL not set — webhook disabled (replies will not cancel escalations)');
    return null;
  }
  const port = Number(config.env.webhook_port) || 8080;
  const server = http.createServer(handleRequest);
  server.listen(port, () => log(`Listening on port ${port} (${config.env.public_base_url})`));
  return server;
}

module.exports = { startWebhookServer, handleRequest, AUDIO_DIR, AUDIO_NAME };
