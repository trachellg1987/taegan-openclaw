'use strict';

/**
 * Monthly Independence Reports
 *
 * Generated on the 1st of every month at 8:00 AM Chicago time.
 *
 * Taegan's report — fun, encouraging: streak counts, highlights, wins.
 * Parent report  — detailed: compliance by section, escalation trends,
 *                  scaffold stage progress, recommendation.
 *
 * Reports reference the previous month's data from compliance-log.json.
 * Monthly snapshots stored in ~/.openclaw/workspace/monthly-reports/.
 */

const fs   = require('fs');
const path = require('path');
const cron = require('node-cron');

const { sendMessage }                          = require('./imessage');
const { getConfig }                            = require('./config');
const { readComplianceLog, getMonthlyComplianceRate } = require('./verification');
const { getScaffoldSummaryLine, _loadState: loadScaffoldState } = require('./scaffold');

const WORKSPACE   = path.join(process.env.HOME, '.openclaw', 'workspace');
const REPORTS_DIR = path.join(WORKSPACE, 'monthly-reports');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the { year, month } of the previous calendar month.
 * month is 1-indexed (January = 1).
 */
function getLastMonthPeriod(now = new Date()) {
  const d = new Date(now);
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function _readEscalationLog() {
  const file = path.join(WORKSPACE, 'escalation-log.json');
  try {
    return fs.readFileSync(file, 'utf8')
      .trim().split('\n').filter(Boolean)
      .map(l => JSON.parse(l));
  } catch {
    return [];
  }
}

// ─── Taegan's report — fun and encouraging ───────────────────────────────────

function buildTaeganReport(year, month) {
  const monthName = new Date(year, month - 1).toLocaleString('en-US', { month: 'long' });
  const { rate, total } = getMonthlyComplianceRate(year, month);
  const pct = rate !== null ? Math.round(rate * 100) : null;

  const prefix  = `${year}-${String(month).padStart(2, '0')}`;
  const entries  = readComplianceLog().filter(e => e.ts?.startsWith(prefix));

  // Count unique days where at least one task was completed
  const completeDays = new Set(
    entries.filter(e => e.status === 'complete').map(e => e.ts.slice(0, 10))
  );

  const lines = [`🌟 ${monthName} Recap — You're Killing It!`, ''];

  if (pct !== null) {
    if (pct >= 90) lines.push(`✅ ${pct}% routine completion — absolute legend! 🏆`);
    else if (pct >= 75) lines.push(`✅ ${pct}% routine completion — solid month! 💪`);
    else lines.push(`✅ ${pct}% routine completion — we're building momentum!`);
  } else {
    lines.push('✅ Routine data not yet available for this month.');
  }

  lines.push(`🔥 ${completeDays.size} days with completed tasks`);

  if (pct !== null && pct >= 85) {
    lines.push('📈 Consistency above 85% — you might be ready for the next level!');
  }

  lines.push('', 'Keep stacking those wins. Next month = new level. Let\'s get it. 💪');

  return lines.join('\n');
}

// ─── Parent report — detailed analytics ─────────────────────────────────────

function buildParentReport(year, month) {
  const monthName = new Date(year, month - 1).toLocaleString('en-US', { month: 'long' });
  const { rate, total } = getMonthlyComplianceRate(year, month);
  const pct = rate !== null ? Math.round(rate * 100) : null;

  const prefix  = `${year}-${String(month).padStart(2, '0')}`;
  const entries  = readComplianceLog().filter(e => e.ts?.startsWith(prefix));

  const complete     = entries.filter(e => e.status === 'complete').length;
  const skipped      = entries.filter(e => e.status === 'skipped').length;
  const unverified   = entries.filter(e => e.status === 'unverified').length;
  const acknowledged = entries.filter(e => e.status === 'acknowledged').length;

  const escAll = _readEscalationLog().filter(e => e.ts?.startsWith(prefix));
  const escCount = escAll.filter(e => e.event === 'ESCALATION_START').length;

  const scaffoldLine = getScaffoldSummaryLine();
  const scaffoldState = loadScaffoldState();

  const recommendation = pct !== null && pct >= 85
    ? '💡 On track for scaffold stage advancement.'
    : '💡 Maintain consistency before advancing to the next stage.';

  return [
    `📋 ${monthName} Parent Report`,
    '',
    `Compliance: ${pct !== null ? pct + '%' : 'N/A'} (${total} tasks tracked)`,
    `  ✅ Completed:         ${complete}`,
    `  ⚠️  Skipped:           ${skipped}`,
    `  ❓ Unverified:        ${unverified}`,
    `  👁️  Acknowledged only: ${acknowledged}`,
    '',
    `🚨 Escalations this month: ${escCount}`,
    '',
    scaffoldLine,
    `   Next advance: ${scaffoldState.overridden ? 'manually controlled' : '30-day auto-check'}`,
    '',
    recommendation,
  ].join('\n');
}

// ─── Snapshot persistence ────────────────────────────────────────────────────

function saveMonthlySnapshot(year, month, taeganReport, parentReport) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const filename = `${year}-${String(month).padStart(2, '0')}.json`;
  fs.writeFileSync(
    path.join(REPORTS_DIR, filename),
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      year,
      month,
      taeganReport,
      parentReport,
    }, null, 2)
  );
}

// ─── Generate and send ───────────────────────────────────────────────────────

function generateMonthlyReports(now = new Date()) {
  const { year, month } = getLastMonthPeriod(now);
  const config = getConfig();

  const taeganReport = buildTaeganReport(year, month);
  const parentReport = buildParentReport(year, month);

  sendMessage(config.taegan_phone, taeganReport);
  sendMessage(config.parent_phone, parentReport);
  saveMonthlySnapshot(year, month, taeganReport, parentReport);
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

let _task = null;

function scheduleMonthlyReports() {
  // 1st of every month at 8:00 AM Chicago time
  _task = cron.schedule('0 0 8 1 * *', () => generateMonthlyReports(), {
    timezone: 'America/Chicago',
  });
}

function stopMonthlyReports() {
  if (_task) {
    _task.stop();
    _task = null;
  }
}

module.exports = {
  scheduleMonthlyReports,
  stopMonthlyReports,
  generateMonthlyReports,
  buildTaeganReport,
  buildParentReport,
  getLastMonthPeriod,
  saveMonthlySnapshot,
};
