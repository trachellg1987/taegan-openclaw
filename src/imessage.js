'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { getConfig } = require('./config');

const LOG_DIR = path.join(process.env.HOME, '.openclaw', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'imessage.log');

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
 * Send an iMessage via osascript.
 *
 * Enforces CFG-003: only approved_contacts from config.yaml may be contacted.
 * Unapproved numbers are blocked and logged — the message is never sent.
 *
 * @param {string} to   - E.164 phone number, e.g. "+15551234567"
 * @param {string} body - Message text
 * @throws if recipient is not in approved_contacts
 */
function sendMessage(to, body) {
  const config = getConfig();

  if (!config.approved_contacts.includes(to)) {
    const entry = { event: 'BLOCKED', to, reason: 'not in approved_contacts' };
    log(entry);
    throw new Error(`[imessage] Blocked: ${to} is not in approved_contacts`);
  }

  // Escape for AppleScript string literal
  const safeTo = to.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const safeBody = body.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  const script = [
    'tell application "Messages"',
    `  set targetService to 1st service whose service type = iMessage`,
    `  set targetBuddy to buddy "${safeTo}" of targetService`,
    `  send "${safeBody}" to targetBuddy`,
    'end tell',
  ].join('\n');

  execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);

  log({ event: 'SENT', to, body });
}

module.exports = { sendMessage };
