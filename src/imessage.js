'use strict';

/**
 * Outbound text messages via Twilio SMS.
 *
 * Replaces the original macOS iMessage (osascript) sender so OpenClaw can run
 * on a Linux VPS. The module path and sendMessage(to, body) signature are kept
 * so every caller works unchanged.
 *
 * Delivery is asynchronous: sendMessage() validates synchronously (approved
 * contacts, Twilio credentials) and throws on those errors exactly as before,
 * then returns a Promise that resolves to the Twilio message SIDs, or to null
 * if delivery failed. The Promise never rejects, so callers that don't await
 * it can't crash the process with an unhandled rejection.
 *
 * Log file name and SENT/BLOCKED/FAILED entries are unchanged so the parent
 * dashboard (PD-001) keeps reading them.
 */

const fs = require('fs');
const path = require('path');
const { getConfig } = require('./config');

const LOG_DIR = path.join(process.env.HOME, '.openclaw', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'imessage.log');

// Twilio rejects bodies over 1600 characters; longer texts are sent in parts.
const MAX_SMS_LENGTH = 1600;

function log(entry) {
  const line = JSON.stringify({ ...entry, ts: new Date().toISOString() }) + '\n';
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    // Never crash the caller because logging failed
  }
}

/**
 * Split text into chunks of at most MAX_SMS_LENGTH characters, preferring
 * line breaks, then spaces, so words and lines aren't cut in half.
 */
function splitBody(body) {
  const chunks = [];
  let rest = body;
  while (rest.length > MAX_SMS_LENGTH) {
    const window = rest.slice(0, MAX_SMS_LENGTH);
    let cut = window.lastIndexOf('\n');
    if (cut <= 0) cut = window.lastIndexOf(' ');
    if (cut <= 0) cut = MAX_SMS_LENGTH;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^[\n ]/, '');
  }
  chunks.push(rest);
  return chunks;
}

let _client = null;
let _clientSid = null;
function getClient(env) {
  if (!_client || _clientSid !== env.twilio_account_sid) {
    _client = require('twilio')(env.twilio_account_sid, env.twilio_auth_token);
    _clientSid = env.twilio_account_sid;
  }
  return _client;
}

async function deliver(client, from, to, body) {
  const sids = [];
  try {
    for (const part of splitBody(body)) {
      const msg = await client.messages.create({ from, to, body: part });
      sids.push(msg.sid);
    }
    log({ event: 'SENT', to, body, channel: 'sms', sids });
    return sids;
  } catch (err) {
    log({ event: 'FAILED', to, body, channel: 'sms', sids, error: err.message, code: err.code });
    process.stderr.write(`[sms] Delivery to ${to} failed: ${err.message}\n`);
    return null;
  }
}

/**
 * Send a text message via Twilio SMS.
 *
 * Enforces CFG-003: only approved_contacts from config.yaml may be contacted.
 * Unapproved numbers are blocked and logged — the message is never sent.
 *
 * @param {string} to   - E.164 phone number, e.g. "+15551234567"
 * @param {string} body - Message text
 * @returns {Promise<string[]|null>} Twilio message SIDs, or null if delivery failed
 * @throws if recipient is not in approved_contacts or Twilio is not configured
 */
function sendMessage(to, body) {
  const config = getConfig();

  if (!config.approved_contacts.includes(to)) {
    const entry = { event: 'BLOCKED', to, reason: 'not in approved_contacts' };
    log(entry);
    throw new Error(`[imessage] Blocked: ${to} is not in approved_contacts`);
  }

  const env = config.env || {};
  if (!env.twilio_account_sid || !env.twilio_auth_token || !env.twilio_from_number) {
    log({ event: 'FAILED', to, body, channel: 'sms', error: 'Twilio not configured' });
    throw new Error(
      '[imessage] Twilio SMS not configured: set TWILIO_ACCOUNT_SID, ' +
      'TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER in .env'
    );
  }

  return deliver(getClient(env), env.twilio_from_number, to, body);
}

module.exports = { sendMessage, splitBody, MAX_SMS_LENGTH };
