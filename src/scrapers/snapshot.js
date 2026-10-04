'use strict';

/**
 * DC-005: Daily Snapshot and Comparison
 *
 * After each scraper run:
 *   1. Copies canvas-data.json and skyward-data.json into dated snapshot files
 *      at ~/.openclaw/workspace/snapshots/canvas-YYYY-MM-DD.json
 *                                        snapshots/skyward-YYYY-MM-DD.json
 *   2. Compares today's missing assignments to yesterday's
 *   3. Sends parent iMessage alert for any *newly appeared* missing assignments
 *   4. Prunes snapshot files older than 30 days
 *
 * Called from src/scrapers/index.js after runAllScrapers() completes.
 */

const fs = require('fs');
const path = require('path');
const { sendMessage } = require('../imessage');
const { getConfig } = require('../config');

const WORKSPACE   = path.join(process.env.HOME, '.openclaw', 'workspace');
const CANVAS_FILE = path.join(WORKSPACE, 'canvas-data.json');
const SKYWARD_FILE = path.join(WORKSPACE, 'skyward-data.json');
const SNAPSHOTS_DIR = path.join(WORKSPACE, 'snapshots');

// Number of days to keep snapshots
const RETENTION_DAYS = 30;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function yesterdayKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function snapshotPath(type, dateKey) {
  return path.join(SNAPSHOTS_DIR, `${type}-${dateKey}.json`);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// ─── Save snapshot ────────────────────────────────────────────────────────────

/**
 * Copy the current canvas/skyward data files into today's dated snapshot.
 * Overwrites if called multiple times on the same day (most recent wins).
 */
function saveSnapshot() {
  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  const today = todayKey();

  for (const { src, type } of [
    { src: CANVAS_FILE,  type: 'canvas' },
    { src: SKYWARD_FILE, type: 'skyward' },
  ]) {
    if (!fs.existsSync(src)) continue;
    try {
      fs.copyFileSync(src, snapshotPath(type, today));
    } catch (err) {
      process.stderr.write(
        `[${new Date().toISOString()}] [DC-005] Failed to save ${type} snapshot: ${err.message}\n`
      );
    }
  }

  process.stdout.write(
    `[${new Date().toISOString()}] [DC-005] Snapshots saved for ${today}\n`
  );
}

// ─── Compare and alert ────────────────────────────────────────────────────────

/**
 * Compare today's and yesterday's Skyward snapshots.
 * Sends a parent iMessage for each missing assignment that is new today.
 */
function compareAndAlert() {
  const config = getConfig();
  const today = todayKey();
  const yesterday = yesterdayKey();

  const todayData     = readJson(snapshotPath('skyward', today));
  const yesterdayData = readJson(snapshotPath('skyward', yesterday));

  if (!todayData?.missing) return; // Nothing to compare

  const todayMissing     = (todayData.missing     || []).map(a => a.name || a);
  const yesterdayMissing = (yesterdayData?.missing || []).map(a => a.name || a);

  const newMissing = todayMissing.filter(name => !yesterdayMissing.includes(name));

  if (newMissing.length === 0) return;

  const lines = [
    `📋 New missing assignment${newMissing.length === 1 ? '' : 's'} in Skyward today:`,
  ];
  newMissing.slice(0, 5).forEach(name => lines.push(`  • ${name}`));
  if (newMissing.length > 5) {
    lines.push(`  … and ${newMissing.length - 5} more`);
  }

  sendMessage(config.parent_phone, lines.join('\n'));

  process.stdout.write(
    `[${new Date().toISOString()}] [DC-005] Alerted parent: ${newMissing.length} new missing assignment(s)\n`
  );
}

// ─── Prune old snapshots ──────────────────────────────────────────────────────

/**
 * Delete snapshot files older than RETENTION_DAYS.
 */
function pruneSnapshots() {
  if (!fs.existsSync(SNAPSHOTS_DIR)) return;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const cutoffKey = cutoff.toISOString().slice(0, 10); // YYYY-MM-DD

  let pruned = 0;
  for (const file of fs.readdirSync(SNAPSHOTS_DIR)) {
    // File names: canvas-YYYY-MM-DD.json or skyward-YYYY-MM-DD.json
    const match = file.match(/^(?:canvas|skyward)-(\d{4}-\d{2}-\d{2})\.json$/);
    if (!match) continue;
    if (match[1] < cutoffKey) {
      try {
        fs.unlinkSync(path.join(SNAPSHOTS_DIR, file));
        pruned++;
      } catch {
        // Non-fatal
      }
    }
  }

  if (pruned > 0) {
    process.stdout.write(
      `[${new Date().toISOString()}] [DC-005] Pruned ${pruned} snapshot(s) older than ${RETENTION_DAYS} days\n`
    );
  }
}

// ─── Combined post-scrape hook ────────────────────────────────────────────────

/**
 * Call this after runAllScrapers() completes.
 * Saves snapshot, compares for new missing work, prunes old files.
 */
function runSnapshotCycle() {
  try {
    saveSnapshot();
    compareAndAlert();
    pruneSnapshots();
  } catch (err) {
    process.stderr.write(
      `[${new Date().toISOString()}] [DC-005] Snapshot cycle error: ${err.message}\n`
    );
  }
}

module.exports = {
  saveSnapshot,
  compareAndAlert,
  pruneSnapshots,
  runSnapshotCycle,
  // Exported for testing
  todayKey,
  yesterdayKey,
  snapshotPath,
};
