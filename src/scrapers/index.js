'use strict';

/**
 * DC-004: Scraper Orchestrator + Cron Scheduler
 *
 * Runs Canvas (DC-001) and Skyward (DC-002) scrapers.
 * Retries once on failure before alerting parent.
 * Logs all runs to ~/.openclaw/logs/cron.log.
 *
 * Cron schedule (weekdays only, America/Chicago):
 *   6:00 AM  →  run both scrapers
 *   3:00 PM  →  run both scrapers
 */

const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { scrapeCanvas } = require('./canvas');
const { scrapeSkyward } = require('./skyward');
const { runSnapshotCycle } = require('./snapshot');
const { sendMessage } = require('../imessage');
const { getConfig } = require('../config');
const { runRealTimeAlerts, buildScraperFailureMessage } = require('../dashboard');

const CRON_LOG = path.join(process.env.HOME, '.openclaw', 'logs', 'cron.log');
const MAX_ATTEMPTS = 2;

// ─── Logging ─────────────────────────────────────────────────────────────────

function logCron(scraper, event, detail = '') {
  const line = `[${new Date().toISOString()}] [${scraper}] ${event}${detail ? ' — ' + detail : ''}\n`;
  try {
    fs.mkdirSync(path.dirname(CRON_LOG), { recursive: true });
    fs.appendFileSync(CRON_LOG, line);
  } catch {
    // Never crash on log failure
  }
  process.stdout.write(line);
}

// ─── Failure alert ────────────────────────────────────────────────────────────

function alertScraperFailure(scraperName, err) {
  const config = getConfig();
  const text = buildScraperFailureMessage(scraperName, err);
  try {
    sendMessage(config.parent_phone, text);
  } catch (sendErr) {
    logCron(scraperName, 'ALERT_SEND_FAILED', sendErr.message);
  }
}

// ─── Run a single scraper with retry ─────────────────────────────────────────

async function runWithRetry(scraperName, scraperFn) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    logCron(scraperName, `START attempt=${attempt}`);
    const start = Date.now();
    try {
      await scraperFn();
      logCron(scraperName, 'SUCCESS', `${Date.now() - start}ms`);
      return;
    } catch (err) {
      lastErr = err;
      logCron(scraperName, `FAILED attempt=${attempt}`, err.message);
    }
  }
  logCron(scraperName, 'ALERT', 'sending parent notification');
  alertScraperFailure(scraperName, lastErr);
}

// ─── Run all scrapers ─────────────────────────────────────────────────────────

async function runAllScrapers() {
  await runWithRetry('DC-001 Canvas', scrapeCanvas);
  await runWithRetry('DC-002 Skyward', scrapeSkyward);
  // DC-005: snapshot, compare, and prune after fresh data lands
  runSnapshotCycle();
  // PD-002: check real-time alert conditions after fresh data lands
  runRealTimeAlerts();
}

// ─── DC-004: Cron scheduler ───────────────────────────────────────────────────

let _tasks = [];

function scheduleScrapers() {
  // 6:00 AM weekdays
  const morning = cron.schedule('0 0 6 * * 1-5', () => {
    logCron('DC-004', 'CRON TRIGGER', '06:00');
    runAllScrapers();
  }, { timezone: 'America/Chicago' });

  // 3:00 PM weekdays
  const afternoon = cron.schedule('0 0 15 * * 1-5', () => {
    logCron('DC-004', 'CRON TRIGGER', '15:00');
    runAllScrapers();
  }, { timezone: 'America/Chicago' });

  _tasks = [morning, afternoon];
  logCron('DC-004', 'SCHEDULED', '06:00 and 15:00 weekdays');
}

function stopScrapers() {
  _tasks.forEach(t => t.stop());
  _tasks = [];
}

module.exports = {
  scheduleScrapers,
  stopScrapers,
  runAllScrapers,
  runWithRetry,
  alertScraperFailure,
};
