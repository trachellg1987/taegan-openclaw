'use strict';

/**
 * Taegan OpenClaw — Main entry point
 *
 * Starts all schedulers and replays any persisted escalation timers
 * that were active before the last restart.
 */

const { getConfig } = require('./config');
const { replayOnStartup } = require('./escalation');
const { scheduleMorning } = require('./routines/morning');
const { scheduleAfterSchool } = require('./routines/afterschool');
const { scheduleNighttime } = require('./routines/nighttime');
const { scheduleScrapers } = require('./scrapers');
const { scheduleGmailMonitor } = require('./scrapers/gmail');
const { scheduleDashboard } = require('./dashboard');
const { scheduleHealthMonitor } = require('./health-monitor');

function log(msg) {
  process.stdout.write(`[${new Date().toISOString()}] [openclaw] ${msg}\n`);
}

async function main() {
  log('─── Taegan OpenClaw starting ───────────────────────────');

  // Validate config on startup — throws with a clear message if anything is missing
  const config = getConfig();
  log(`Config loaded. Taegan: ${config.taegan_phone}, Parent: ${config.parent_phone}`);

  // Replay any escalation timers that were active before last restart
  replayOnStartup();
  log('Escalation timers replayed');

  // Start all routine schedulers
  scheduleMorning();
  log('Morning routine scheduled (MR-001 – MR-010)');

  scheduleAfterSchool();
  log('After-school routine scheduled (AS-001 – AS-008)');

  scheduleNighttime();
  log('Nighttime routine scheduled (NT-001 – NT-006)');

  // Start data collection crons
  scheduleScrapers();
  log('Scraper crons scheduled (6:00 AM + 3:00 PM weekdays)');

  // Start Gmail school email monitor (DC-003)
  scheduleGmailMonitor();
  log('Gmail monitor scheduled (DC-003, every 30 min weekdays)');

  // Start parent dashboard
  scheduleDashboard();
  log('Parent dashboard scheduled (PD-001 nightly summary at 9:30 PM)');

  // Start health monitor
  scheduleHealthMonitor();
  log('Health monitor started (every 5 minutes)');

  log('─── All systems running ─────────────────────────────────');

  // Keep the process alive
  process.on('SIGTERM', () => { log('SIGTERM received — shutting down'); process.exit(0); });
  process.on('SIGINT',  () => { log('SIGINT received — shutting down');  process.exit(0); });
}

main().catch(err => {
  process.stderr.write(`[openclaw] FATAL: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
