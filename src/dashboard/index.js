'use strict';

/**
 * Parent Dashboard — PD-001, PD-002, PD-003
 *
 * PD-001: Nightly summary iMessage to parent at 9:30 PM weekdays
 * PD-002: Real-time alerts after each scraper run
 * PD-003: Scraper failure alerts (wired in scrapers/index.js; format defined here)
 */

const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { sendMessage } = require('../imessage');
const { getConfig } = require('../config');

const WORKSPACE = path.join(process.env.HOME, '.openclaw', 'workspace');
const LOGS_DIR  = path.join(process.env.HOME, '.openclaw', 'logs');

const CANVAS_FILE    = path.join(WORKSPACE, 'canvas-data.json');
const SKYWARD_FILE   = path.join(WORKSPACE, 'skyward-data.json');
const ESC_LOG        = path.join(WORKSPACE, 'escalation-log.json');
const IMSG_LOG       = path.join(LOGS_DIR,  'imessage.log');
const ALERT_STATE    = path.join(WORKSPACE, 'alert-state.json');

// Alert cooldown — same alert won't fire more than once per 24 hours
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Keywords that mark an assignment as a "major project"
const MAJOR_KEYWORDS = [
  'project', 'essay', 'research', 'presentation', 'exam', 'test',
  'final', 'midterm', 'report', 'paper',
];

// ─── Data readers ─────────────────────────────────────────────────────────────

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readJsonLines(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8')
      .trim().split('\n').filter(Boolean)
      .map(l => JSON.parse(l));
  } catch {
    return [];
  }
}

function todayPrefix() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// ─── Alert cooldown ───────────────────────────────────────────────────────────

function loadAlertState() {
  return readJson(ALERT_STATE) || {};
}

function saveAlertState(state) {
  fs.mkdirSync(path.dirname(ALERT_STATE), { recursive: true });
  fs.writeFileSync(ALERT_STATE, JSON.stringify(state, null, 2));
}

function isCooledDown(key) {
  const state = loadAlertState();
  const last = state[key];
  if (!last) return true;
  return Date.now() - new Date(last).getTime() > COOLDOWN_MS;
}

function markAlertFired(key) {
  const state = loadAlertState();
  state[key] = new Date().toISOString();
  saveAlertState(state);
}

function alert(key, to, message) {
  if (!isCooledDown(key)) return; // already alerted within 24h
  sendMessage(to, message);
  markAlertFired(key);
}

// ─── PD-001: Nightly summary ──────────────────────────────────────────────────

function buildNightlySummary() {
  const config = getConfig();
  const today = todayPrefix();

  // Escalation count today
  const escEntries = readJsonLines(ESC_LOG);
  const escalationsToday = escEntries.filter(
    e => e.ts && e.ts.startsWith(today) && e.event === 'ESCALATION_START'
  ).length;

  // Messages sent to Taegan today
  const imsgEntries = readJsonLines(IMSG_LOG);
  const sentToday = imsgEntries.filter(
    e => e.ts && e.ts.startsWith(today) && e.event === 'SENT' && e.to === config.taegan_phone
  ).length;

  const completionPct = sentToday > 0
    ? Math.round(((sentToday - escalationsToday) / sentToday) * 100)
    : null;

  // Missing assignments
  const skyward = readJson(SKYWARD_FILE);
  const missingCount = skyward?.missing?.length ?? null;

  // Grade alerts (below 80%)
  const gradeAlerts = (skyward?.grades || []).filter(g =>
    g.percent != null ? g.percent < 80 : /^[DF]/.test(g.grade)
  );

  // Upcoming deadlines (canvas, within 48h)
  const canvas = readJson(CANVAS_FILE);
  const soon48h = Date.now() + 48 * 60 * 60 * 1000;
  const urgentAssignments = (canvas?.assignments || []).filter(a => {
    if (a.submitted) return false;
    if (!a.dueDate) return false;
    const due = new Date(a.dueDate).getTime();
    return due > Date.now() && due <= soon48h;
  });

  // Build message — warm tone, under 10 lines
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    timeZone: 'America/Chicago',
  });

  const lines = [`📊 Taegan's Day — ${dateStr}`, ''];

  if (completionPct !== null) {
    const esc = escalationsToday > 0 ? ` (${escalationsToday} escalation${escalationsToday === 1 ? '' : 's'})` : '';
    lines.push(`✅ Routine: ${completionPct}% complete${esc}`);
  } else {
    lines.push('✅ Routine: No data yet');
  }

  if (missingCount === null) {
    lines.push('📚 Missing: Scraper data unavailable');
  } else if (missingCount === 0) {
    lines.push('📚 Missing: All caught up!');
  } else {
    lines.push(`📚 Missing: ${missingCount} assignment${missingCount === 1 ? '' : 's'}`);
  }

  if (gradeAlerts.length > 0) {
    gradeAlerts.slice(0, 3).forEach(g => {
      const pct = g.percent != null ? ` — ${g.percent}%` : '';
      lines.push(`⚠️ Grade: ${g.course} ${g.grade}${pct}`);
    });
  } else if (skyward?.grades?.length > 0) {
    lines.push('📈 Grades: All passing');
  }

  if (urgentAssignments.length > 0) {
    urgentAssignments.slice(0, 2).forEach(a => {
      const due = new Date(a.dueDate).toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
      });
      lines.push(`🗓️ Due soon: ${a.name} — ${due}`);
    });
  }

  lines.push('', 'Have a good night! 🌙');

  return lines.join('\n');
}

function sendNightlySummary() {
  const config = getConfig();
  const summary = buildNightlySummary();
  sendMessage(config.parent_phone, summary);
}

// ─── PD-002: Real-time alerts ─────────────────────────────────────────────────

function checkMissingThreshold() {
  const config = getConfig();
  const skyward = readJson(SKYWARD_FILE);
  if (!skyward?.missing) return;

  const count = skyward.missing.length;
  if (count >= 3) {
    alert(
      'missing_threshold',
      config.parent_phone,
      `⚠️ OpenClaw alert: Taegan has ${count} missing assignments in Skyward.`
    );
  }
}

function checkGradeAlerts() {
  const config = getConfig();
  const skyward = readJson(SKYWARD_FILE);
  if (!skyward?.grades) return;

  skyward.grades.forEach(g => {
    const below80 = g.percent != null ? g.percent < 80 : /^[DF]/.test(g.grade);
    if (!below80) return;

    const pct = g.percent != null ? ` (${g.percent}%)` : '';
    alert(
      `grade_below_B_${g.course}`,
      config.parent_phone,
      `⚠️ OpenClaw alert: Grade below B in ${g.course} — ${g.grade}${pct}`
    );
  });
}

function checkUpcomingDeadlines() {
  const config = getConfig();
  const canvas = readJson(CANVAS_FILE);
  if (!canvas?.assignments) return;

  const now = Date.now();
  const soon48h = now + 48 * 60 * 60 * 1000;

  canvas.assignments.forEach(a => {
    if (a.submitted) return;
    if (!a.dueDate) return;

    const due = new Date(a.dueDate).getTime();
    if (due <= now || due > soon48h) return;

    const isMajor = MAJOR_KEYWORDS.some(kw =>
      a.name.toLowerCase().includes(kw)
    );
    if (!isMajor) return;

    const dueStr = new Date(a.dueDate).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    });

    alert(
      `deadline_48h_${a.name}`,
      config.parent_phone,
      `⚠️ OpenClaw alert: Major assignment not started — "${a.name}" due ${dueStr}`
    );
  });
}

/**
 * Run all PD-002 real-time checks.
 * Call this after each scraper run completes.
 */
function runRealTimeAlerts() {
  checkMissingThreshold();
  checkGradeAlerts();
  checkUpcomingDeadlines();
  // PD-002 "Taegan unreachable after escalation" is handled by ESC-003 alertParent()
  // which fires immediately when the Twilio call goes unanswered.
}

// ─── PD-003: Scraper failure format ──────────────────────────────────────────

/**
 * Build a scraper failure alert message.
 * Called by src/scrapers/index.js after 2 failed attempts.
 */
function buildScraperFailureMessage(scraperName, err) {
  const ts = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
  return (
    `⚠️ OpenClaw scraper failure\n` +
    `Scraper: ${scraperName}\n` +
    `Error: ${err.message}\n` +
    `Time: ${ts}`
  );
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

let _summaryTask = null;

function scheduleDashboard() {
  // PD-001: 9:30 PM weekdays
  _summaryTask = cron.schedule('0 30 21 * * 1-5', sendNightlySummary, {
    timezone: 'America/Chicago',
  });
}

function stopDashboard() {
  if (_summaryTask) {
    _summaryTask.stop();
    _summaryTask = null;
  }
}

module.exports = {
  scheduleDashboard,
  stopDashboard,
  buildNightlySummary,
  sendNightlySummary,
  runRealTimeAlerts,
  checkMissingThreshold,
  checkGradeAlerts,
  checkUpcomingDeadlines,
  buildScraperFailureMessage,
  // Exported for testing
  isCooledDown,
  markAlertFired,
  _resetAlertState: () => {
    try { fs.unlinkSync(ALERT_STATE); } catch {}
  },
};
