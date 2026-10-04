'use strict';

/**
 * ESC-002: Twilio voice call with ElevenLabs TTS.
 *
 * Generates audio from message text via ElevenLabs, hosts it temporarily,
 * then places a Twilio call that plays that audio. If unanswered after 30s,
 * fires ESC-003 (parent alert).
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { getConfig } = require('../config');

const AUDIO_DIR = path.join(process.env.HOME, '.openclaw', 'workspace', 'tts-cache');
const ANSWER_TIMEOUT_MS = 30_000;

// ─── ElevenLabs TTS ──────────────────────────────────────────────────────────

/**
 * Generate speech audio from text using ElevenLabs.
 * Returns path to a temp .mp3 file.
 */
async function generateSpeech(text) {
  const config = getConfig();
  fs.mkdirSync(AUDIO_DIR, { recursive: true });

  const audioPath = path.join(AUDIO_DIR, `tts-${Date.now()}.mp3`);

  const body = JSON.stringify({
    text,
    model_id: 'eleven_monolingual_v1',
    voice_settings: { stability: 0.5, similarity_boost: 0.75 },
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.elevenlabs.io',
        path: `/v1/text-to-speech/${config.env.elevenlabs_voice_id}`,
        method: 'POST',
        headers: {
          'xi-api-key': config.env.elevenlabs_api_key,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`ElevenLabs TTS failed: HTTP ${res.statusCode}`));
          return;
        }
        const out = fs.createWriteStream(audioPath);
        res.pipe(out);
        out.on('finish', () => resolve(audioPath));
        out.on('error', reject);
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Twilio call ─────────────────────────────────────────────────────────────

/**
 * Serve the audio file temporarily over localhost so Twilio can fetch it.
 * Returns { url, close } — call close() when done.
 */
function serveAudioLocally(audioPath) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const data = fs.readFileSync(audioPath);
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': data.length });
      res.end(data);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/audio.mp3`,
        close: () => server.close(),
      });
    });
  });
}

/**
 * Place the Twilio call.
 * Returns the call SID.
 */
async function placeTwilioCall(audioUrl, onUnanswered) {
  const config = getConfig();
  const twilio = require('twilio')(
    config.env.twilio_account_sid,
    config.env.twilio_auth_token
  );

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${audioUrl}</Play>
</Response>`;

  const call = await twilio.calls.create({
    from: config.env.twilio_from_number,
    to: config.taegan_phone,
    twiml,
    timeout: 30, // seconds before Twilio gives up
  });

  // Poll call status — fire ESC-003 if not answered within timeout
  const deadline = Date.now() + ANSWER_TIMEOUT_MS + 5_000;
  const poll = setInterval(async () => {
    if (Date.now() > deadline) {
      clearInterval(poll);
      onUnanswered();
      return;
    }
    try {
      const updated = await twilio.calls(call.sid).fetch();
      if (['busy', 'no-answer', 'failed', 'canceled'].includes(updated.status)) {
        clearInterval(poll);
        onUnanswered();
      } else if (updated.status === 'completed') {
        clearInterval(poll);
        // Call was answered — escalation chain ends here
      }
    } catch {
      // Transient fetch error — keep polling
    }
  }, 5_000);

  return call.sid;
}

/**
 * ESC-002 entry point.
 *
 * @param {string}   message     - Original message text to read aloud
 * @param {string}   step        - PRD story ID (e.g. "MR-001")
 * @param {Function} onUnanswered - Called with { step, message } if call unanswered
 */
async function escalateCall(message, step, onUnanswered) {
  let audioPath;
  let audioServer;

  try {
    audioPath = await generateSpeech(message);
    audioServer = await serveAudioLocally(audioPath);
    await placeTwilioCall(audioServer.url, () => {
      onUnanswered({ step, message });
    });
  } finally {
    if (audioServer) audioServer.close();
    // Keep the audio file for logging; pruned by DC-005 snapshot cleanup
  }
}

module.exports = { escalateCall };
