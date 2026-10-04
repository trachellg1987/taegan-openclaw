'use strict';

/**
 * ESC-003: Voicemail fallback — parent SMS alert.
 * ESC-004: Append-only escalation log.
 *
 * Called when a Twilio call goes unanswered. Sends a concise SMS
 * to parent_phone and appends to the escalation log.
 */

const fs = require('fs');
const path = require('path');
const { sendMessage } = require('../imessage');
const { getConfig } = require('../config');

const LOG_FILE = path.join(
  process.env.HOME, '.openclaw', 'workspace', 'escalation-log.json'
);

// ─── ESC-004: Escalation log ──────────────────────────────────────────────────

function appendToLog(entry) {
  const dir = path.dirname(LOG_FILE);
  fs.mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({ ...entry, ts: new Date().toISOString() }) + '\n';
  fs.appendFileSync(LOG_FILE, line); // append-only, never deleted
}

function readLog() {
  if (!fs.existsSync(LOG_FILE)) return [];
  return fs.readFileSync(LOG_FILE, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));
}

// ─── ESC-003: Parent alert ────────────────────────────────────────────────────

/**
 * Send parent alert after unanswered Twilio call.
 *
 * @param {string} step    - PRD story ID (e.g. "MR-001")
 * @param {string} message - Original message text that was missed
 */
function alertParent(step, message) {
  const config = getConfig();
  const ts = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });

  const text =
    `⚠️ OpenClaw alert\n` +
    `Step: ${step}\n` +
    `Missed: "${message}"\n` +
    `Time: ${ts}\n` +
    `Taegan did not respond to text message or Twilio call.`;

  sendMessage(config.parent_phone, text);

  appendToLog({ event: 'PARENT_ALERT', step, message });
}

/**
 * Full escalation chain entry point — called by timer when message goes unread.
 * ESC-001 fires this → this calls ESC-002 → ESC-002 calls onUnanswered → this calls ESC-003.
 *
 * @param {object} opts
 * @param {string} opts.step    - PRD story ID
 * @param {string} opts.message - Original message text
 */
async function runEscalation({ step, message }) {
  const { escalateCall } = require('./call');

  appendToLog({ event: 'ESCALATION_START', step, message });

  try {
    await escalateCall(message, step, ({ step: s, message: m }) => {
      appendToLog({ event: 'CALL_UNANSWERED', step: s, message: m });
      alertParent(s, m);
    });
  } catch (err) {
    // Call could not be placed — go straight to the parent rather than
    // letting the rejection crash the process with no alert sent.
    appendToLog({ event: 'CALL_FAILED', step, message, error: err.message });
    alertParent(step, message);
  }
}

module.exports = { runEscalation, alertParent, appendToLog, readLog };
