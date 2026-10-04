'use strict';

/**
 * Task Verification Layer
 *
 * After each routine message fires, schedules a soft verification check 15 min later.
 * Logs every task outcome (complete / skipped / unverified / acknowledged) to
 * compliance-log.json.
 *
 * Verification types:
 *   quick-confirm — reply YES / OK / Done to confirm
 *   photo-verify  — "Send me a quick photo when done" (tidy room, backpack)
 *   time-gate     — tracks minimum realistic completion time (shower=8 min, workout=15 min)
 *
 * Auto-verify: when a new step fires while a previous verification is pending,
 * the previous step is assumed complete (next task opened = previous done).
 *
 * Compliance statuses: complete | skipped | unverified | acknowledged
 */

const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { sendMessage } = require('./imessage');
const { getConfig } = require('./config');

const WORKSPACE = path.join(process.env.HOME, '.openclaw', 'workspace');
const COMPLIANCE_LOG = path.join(WORKSPACE, 'compliance-log.json');

const VERIFY_DELAY_MS = 15 * 60 * 1000; // 15 minutes

// Steps requiring photo verification
const PHOTO_VERIFY_STEPS = new Set(['MR-005', 'NT-004', 'AS-007']);

// Minimum realistic completion times (milliseconds) — time-gate verification
const TIME_GATES = {
  'NT-002': 8 * 60 * 1000,   // shower: 8 min
  'NT-001': 15 * 60 * 1000,  // dumbbell workout: 15 min
  'MR-003': 8 * 60 * 1000,   // morning brush/shower: 8 min
};

const VERIFY_MESSAGES = {
  'quick-confirm': 'Did you finish? Reply YES, OK, or Done to confirm ✓',
  'photo-verify':  'Send me a quick photo when done 📸',
  'time-gate':     "Still on it? Reply when you're done ✓",
};

// ─── Compliance log ───────────────────────────────────────────────────────────

function appendToComplianceLog(entry) {
  fs.mkdirSync(WORKSPACE, { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  fs.appendFileSync(COMPLIANCE_LOG, line, 'utf8');
}

function readComplianceLog() {
  try {
    return fs.readFileSync(COMPLIANCE_LOG, 'utf8')
      .trim().split('\n').filter(Boolean)
      .map(l => JSON.parse(l));
  } catch {
    return [];
  }
}

// ─── Compliance rate calculations ────────────────────────────────────────────

/**
 * Compute compliance rate from an array of log entries.
 * Returns null if no entries.
 */
function getComplianceRate(entries) {
  if (!entries || entries.length === 0) return null;
  const complete = entries.filter(e => e.status === 'complete').length;
  return complete / entries.length;
}

/**
 * Compliance rate for a specific calendar day (YYYY-MM-DD prefix match).
 */
function getDailyComplianceRate(date = new Date()) {
  const prefix = date.toISOString().slice(0, 10);
  const entries = readComplianceLog().filter(e => e.ts && e.ts.startsWith(prefix));
  return getComplianceRate(entries);
}

/**
 * Compliance rate for the trailing 7-day window.
 */
function getWeeklyComplianceRate() {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const entries = readComplianceLog().filter(e => e.ts && new Date(e.ts) >= cutoff);
  return getComplianceRate(entries);
}

/**
 * Compliance rate and total count for a specific year/month (1-indexed month).
 */
function getMonthlyComplianceRate(year, month) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const entries = readComplianceLog().filter(e => e.ts && e.ts.startsWith(prefix));
  return { rate: getComplianceRate(entries), total: entries.length };
}

/**
 * Count consecutive non-complete entries at the end of the log (for scaffold stage 3).
 */
function getConsecutiveMisses() {
  const entries = readComplianceLog();
  let count = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].status !== 'complete') {
      count++;
    } else {
      break;
    }
  }
  return count;
}

// ─── Verification type ───────────────────────────────────────────────────────

function getVerificationType(stepId) {
  if (PHOTO_VERIFY_STEPS.has(stepId)) return 'photo-verify';
  if (TIME_GATES[stepId])              return 'time-gate';
  return 'quick-confirm';
}

// ─── Active verification tracker ─────────────────────────────────────────────

// Map of stepId → { timerId, verifyType }
const _pendingVerifications = new Map();

/**
 * Schedule a verification check 15 minutes after a routine message fires.
 * Calling this for a new step auto-verifies any previously pending steps as complete.
 */
function scheduleVerification(stepId) {
  // Auto-verify any previous pending step (next task opened = previous done)
  for (const [prevStepId, pending] of _pendingVerifications.entries()) {
    clearTimeout(pending.timerId);
    _pendingVerifications.delete(prevStepId);
    appendToComplianceLog({ step: prevStepId, status: 'complete', autoVerified: true });
  }

  const verifyType = getVerificationType(stepId);

  const timerId = setTimeout(() => {
    _pendingVerifications.delete(stepId);
    const config = getConfig();
    const msg = VERIFY_MESSAGES[verifyType] || VERIFY_MESSAGES['quick-confirm'];
    sendMessage(config.taegan_phone, msg);
    appendToComplianceLog({ step: stepId, status: 'unverified', verifyType });
  }, VERIFY_DELAY_MS);

  _pendingVerifications.set(stepId, { timerId, verifyType });
}

/**
 * Mark a step as confirmed complete (e.g., user replied YES/OK/Done).
 */
function markComplete(stepId) {
  const pending = _pendingVerifications.get(stepId);
  if (pending) {
    clearTimeout(pending.timerId);
    _pendingVerifications.delete(stepId);
  }
  appendToComplianceLog({ step: stepId, status: 'complete' });
}

/**
 * Mark a step as acknowledged-but-unverified (notification opened, no response).
 */
function markAcknowledged(stepId) {
  const pending = _pendingVerifications.get(stepId);
  if (pending) {
    clearTimeout(pending.timerId);
    _pendingVerifications.delete(stepId);
  }
  appendToComplianceLog({ step: stepId, status: 'acknowledged' });
}

// ─── Weekly compliance report ────────────────────────────────────────────────

function buildWeeklyReport() {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const entries = readComplianceLog().filter(e => e.ts && new Date(e.ts) >= cutoff);
  const total        = entries.length;
  const complete     = entries.filter(e => e.status === 'complete').length;
  const skipped      = entries.filter(e => e.status === 'skipped').length;
  const unverified   = entries.filter(e => e.status === 'unverified').length;
  const acknowledged = entries.filter(e => e.status === 'acknowledged').length;
  const rate         = total > 0 ? Math.round((complete / total) * 100) : 0;

  return [
    '📊 Weekly Compliance Report',
    '',
    `Completion rate: ${rate}%`,
    `✅ Completed: ${complete}/${total} tasks`,
    skipped      > 0 ? `⚠️  Skipped: ${skipped}` : null,
    unverified   > 0 ? `❓ Unverified: ${unverified}` : null,
    acknowledged > 0 ? `👁️  Acknowledged only: ${acknowledged}` : null,
  ].filter(l => l !== null).join('\n');
}

function sendWeeklyReport() {
  const config = getConfig();
  sendMessage(config.parent_phone, buildWeeklyReport());
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

let _weeklyTask = null;

function scheduleVerificationSystem() {
  // Send weekly compliance report to parent every Sunday at 11:00 PM Chicago time
  _weeklyTask = cron.schedule('0 0 23 * * 0', sendWeeklyReport, {
    timezone: 'America/Chicago',
  });
}

function stopVerificationSystem() {
  if (_weeklyTask) {
    _weeklyTask.stop();
    _weeklyTask = null;
  }
}

module.exports = {
  scheduleVerification,
  markComplete,
  markAcknowledged,
  appendToComplianceLog,
  readComplianceLog,
  getComplianceRate,
  getDailyComplianceRate,
  getWeeklyComplianceRate,
  getMonthlyComplianceRate,
  getConsecutiveMisses,
  getVerificationType,
  buildWeeklyReport,
  sendWeeklyReport,
  scheduleVerificationSystem,
  stopVerificationSystem,
  PHOTO_VERIFY_STEPS,
  TIME_GATES,
  VERIFY_MESSAGES,
  _pendingVerifications,
};
