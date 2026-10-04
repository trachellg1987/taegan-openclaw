'use strict';

/**
 * DC-003: Gmail School Email Monitor
 *
 * Polls Taegan's school Gmail account every 30 minutes on weekdays.
 * Filters for Canvas and Google Classroom notification emails.
 * Forwards a plain-language summary to the parent via iMessage.
 *
 * Credentials required in .env:
 *   GMAIL_CLIENT_ID      — OAuth2 client ID from Google Cloud Console
 *   GMAIL_CLIENT_SECRET  — OAuth2 client secret
 *   GMAIL_REFRESH_TOKEN  — Offline refresh token (see DEPLOYMENT.md for setup)
 *
 * State: ~/.openclaw/workspace/gmail-state.json
 *   { lastCheckedAt: ISO, processedIds: [string, ...] }
 *
 * If credentials are missing, the monitor logs a warning and skips silently
 * so the rest of the system is unaffected.
 */

const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { google } = require('googleapis');
const { sendMessage } = require('../imessage');
const { getConfig } = require('../config');

const STATE_FILE = path.join(
  process.env.HOME, '.openclaw', 'workspace', 'gmail-state.json'
);

// Gmail search query — matches Canvas and Google Classroom notification senders
const GMAIL_QUERY =
  'from:(instructure.com OR noreply@instructure.com OR ' +
  'googleclassroom.com OR classroom.google.com OR ' +
  'notifications@classroom.google.com) is:unread newer_than:2d';

// Maximum messages fetched per poll cycle (avoid flooding on first run)
const MAX_MESSAGES = 20;

// ─── State ────────────────────────────────────────────────────────────────────

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { lastCheckedAt: null, processedIds: [] };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  // Keep processed ID list capped at 500 to prevent unbounded growth
  if (state.processedIds.length > 500) {
    state.processedIds = state.processedIds.slice(-500);
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ─── Gmail client ─────────────────────────────────────────────────────────────

function buildGmailClient(env) {
  const oauth2Client = new google.auth.OAuth2(
    env.gmail_client_id,
    env.gmail_client_secret
  );
  oauth2Client.setCredentials({ refresh_token: env.gmail_refresh_token });
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

// ─── Message parsing ──────────────────────────────────────────────────────────

/**
 * Extract a plain-text snippet from a Gmail message resource.
 * Returns { subject, from, snippet }.
 */
function parseMessage(msg) {
  const headers = msg.payload?.headers || [];
  const get = name => (headers.find(h => h.name.toLowerCase() === name) || {}).value || '';
  return {
    subject: get('subject'),
    from: get('from'),
    snippet: (msg.snippet || '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim(),
  };
}

/**
 * Determine the notification type for grouping in the summary.
 * Returns 'canvas', 'classroom', or 'other'.
 */
function classifyEmail(from) {
  const f = from.toLowerCase();
  if (f.includes('instructure') || f.includes('canvas')) return 'canvas';
  if (f.includes('classroom') || f.includes('google')) return 'classroom';
  return 'other';
}

// ─── Core poll ────────────────────────────────────────────────────────────────

async function pollGmail() {
  const config = getConfig();
  const { gmail_client_id, gmail_client_secret, gmail_refresh_token } = config.env;

  if (!gmail_client_id || !gmail_client_secret || !gmail_refresh_token) {
    // Credentials not configured — skip silently (not fatal)
    process.stdout.write(
      `[${new Date().toISOString()}] [DC-003] Gmail credentials not set — skipping poll\n`
    );
    return;
  }

  const state = loadState();
  const gmail = buildGmailClient(config.env);

  // List matching messages
  let listRes;
  try {
    listRes = await gmail.users.messages.list({
      userId: 'me',
      q: GMAIL_QUERY,
      maxResults: MAX_MESSAGES,
    });
  } catch (err) {
    process.stdout.write(
      `[${new Date().toISOString()}] [DC-003] Gmail list failed: ${err.message}\n`
    );
    return;
  }

  const messages = listRes.data.messages || [];
  if (messages.length === 0) {
    state.lastCheckedAt = new Date().toISOString();
    saveState(state);
    return;
  }

  // Filter out already-processed messages
  const newMessages = messages.filter(m => !state.processedIds.includes(m.id));
  if (newMessages.length === 0) {
    state.lastCheckedAt = new Date().toISOString();
    saveState(state);
    return;
  }

  // Fetch full message details (subject + snippet)
  const details = [];
  for (const m of newMessages) {
    try {
      const res = await gmail.users.messages.get({
        userId: 'me',
        id: m.id,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From'],
      });
      details.push(parseMessage(res.data));
      state.processedIds.push(m.id);
    } catch {
      // Skip individual message fetch errors
    }
  }

  if (details.length > 0) {
    const summary = buildSummary(details);
    sendMessage(config.parent_phone, summary);
  }

  state.lastCheckedAt = new Date().toISOString();
  saveState(state);

  process.stdout.write(
    `[${new Date().toISOString()}] [DC-003] Processed ${details.length} new school email(s)\n`
  );
}

// ─── Summary builder ──────────────────────────────────────────────────────────

function buildSummary(details) {
  const canvas = details.filter(d => classifyEmail(d.from) === 'canvas');
  const classroom = details.filter(d => classifyEmail(d.from) === 'classroom');
  const other = details.filter(d => classifyEmail(d.from) === 'other');

  const lines = ['📬 School email update:'];

  if (canvas.length > 0) {
    lines.push(`\nCanvas (${canvas.length}):`);
    canvas.slice(0, 3).forEach(d => {
      lines.push(`  • ${d.subject || '(no subject)'}`);
      if (d.snippet) lines.push(`    ${d.snippet.slice(0, 80)}`);
    });
    if (canvas.length > 3) lines.push(`  … and ${canvas.length - 3} more`);
  }

  if (classroom.length > 0) {
    lines.push(`\nGoogle Classroom (${classroom.length}):`);
    classroom.slice(0, 3).forEach(d => {
      lines.push(`  • ${d.subject || '(no subject)'}`);
      if (d.snippet) lines.push(`    ${d.snippet.slice(0, 80)}`);
    });
    if (classroom.length > 3) lines.push(`  … and ${classroom.length - 3} more`);
  }

  if (other.length > 0) {
    lines.push(`\nOther school email (${other.length}):`);
    other.slice(0, 2).forEach(d => {
      lines.push(`  • ${d.subject || '(no subject)'}`);
    });
  }

  return lines.join('\n');
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

let _task = null;

function scheduleGmailMonitor() {
  // Every 30 minutes on weekdays (Mon–Fri), America/Chicago
  _task = cron.schedule('0 */30 * * * 1-5', () => {
    pollGmail().catch(err => {
      process.stderr.write(
        `[${new Date().toISOString()}] [DC-003] Unhandled error: ${err.message}\n`
      );
    });
  }, { timezone: 'America/Chicago' });
  process.stdout.write(
    `[${new Date().toISOString()}] [DC-003] Gmail monitor scheduled (every 30 min, weekdays)\n`
  );
}

function stopGmailMonitor() {
  if (_task) {
    _task.stop();
    _task = null;
  }
}

module.exports = {
  scheduleGmailMonitor,
  stopGmailMonitor,
  pollGmail,
  buildSummary,
  parseMessage,
  classifyEmail,
  loadState,
  saveState,
};
