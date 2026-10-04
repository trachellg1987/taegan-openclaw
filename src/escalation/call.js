'use strict';

/**
 * ESC-002: Twilio voice call with ElevenLabs TTS.
 *
 * Generates audio from message text via ElevenLabs and places a Twilio call
 * that plays it. The audio is served publicly by src/webhook.js (Twilio can't
 * reach localhost); without PUBLIC_BASE_URL, or if ElevenLabs fails, the call
 * reads the message with Twilio's built-in voice instead. If unanswered after
 * 30s, fires ESC-003 (parent alert).
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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

  // Random suffix so the public /audio/ URL can't be guessed
  const audioPath = path.join(
    AUDIO_DIR, `tts-${Date.now()}-${crypto.randomBytes(8).toString('hex')}.mp3`
  );

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

function escapeXml(text) {
  return text.replace(/[<>&'"]/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  })[c]);
}

/**
 * TwiML for the call: play the ElevenLabs audio when it is publicly hosted,
 * otherwise read the message with Twilio's built-in voice.
 */
function buildTwiml(message, audioUrl) {
  const body = audioUrl
    ? `<Play>${escapeXml(audioUrl)}</Play>`
    : `<Say voice="alice">${escapeXml(message)}</Say>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${body}
</Response>`;
}

/**
 * Generate ElevenLabs audio and return its public URL (served by src/webhook.js),
 * or null if there is no public URL, no ElevenLabs key, or generation fails.
 */
async function getPublicAudioUrl(message) {
  const { env } = getConfig();
  if (!env.public_base_url || !env.elevenlabs_api_key || !env.elevenlabs_voice_id) return null;
  try {
    const audioPath = await generateSpeech(message);
    return `${env.public_base_url}/audio/${path.basename(audioPath)}`;
  } catch (err) {
    process.stderr.write(`[call] ElevenLabs failed, using Twilio voice: ${err.message}\n`);
    return null;
  }
}

/**
 * Place the Twilio call.
 * Returns the call SID.
 */
async function placeTwilioCall(twiml, onUnanswered) {
  const config = getConfig();
  const twilio = require('twilio')(
    config.env.twilio_account_sid,
    config.env.twilio_auth_token
  );

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
  const audioUrl = await getPublicAudioUrl(message);
  await placeTwilioCall(buildTwiml(message, audioUrl), () => {
    onUnanswered({ step, message });
  });
}

module.exports = { escalateCall, buildTwiml };
