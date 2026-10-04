'use strict';

/**
 * CFG-005: Health Monitor
 *
 * Runs health-check.sh every 5 minutes.
 * Tracks consecutive failures in ~/.openclaw/workspace/health-state.json.
 * Sends parent iMessage alert after 3 consecutive failures, then resets counter.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { sendMessage } = require('./imessage');
const { getConfig } = require('./config');

const HEALTH_SCRIPT = path.join(__dirname, '..', 'scripts', 'health-check.sh');
const STATE_FILE = path.join(
  process.env.HOME, '.openclaw', 'workspace', 'health-state.json'
);
const FAILURE_THRESHOLD = 3;

// ─── State ────────────────────────────────────────────────────────────────────

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { consecutiveFailures: 0, lastAlertAt: null };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ─── Check ────────────────────────────────────────────────────────────────────

function runHealthCheck() {
  const state = loadState();
  let healthy = false;
  let output = '';

  try {
    output = execSync(`bash "${HEALTH_SCRIPT}"`, {
      timeout: 30_000,
      encoding: 'utf8',
    });
    healthy = true;
  } catch (err) {
    output = (err.stdout || '') + (err.stderr || '') || err.message;
    healthy = false;
  }

  if (healthy) {
    if (state.consecutiveFailures > 0) {
      state.consecutiveFailures = 0;
      saveState(state);
    }
    return { healthy: true, output };
  }

  state.consecutiveFailures = (state.consecutiveFailures || 0) + 1;
  saveState(state);

  if (state.consecutiveFailures >= FAILURE_THRESHOLD) {
    const config = getConfig();
    const ts = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
    const summary = output.trim().split('\n')
      .filter(l => l.includes('[FAIL]'))
      .slice(0, 4)
      .join('\n');
    sendMessage(
      config.parent_phone,
      `⚠️ OpenClaw health check failed ${FAILURE_THRESHOLD} times in a row\n` +
      `${summary || output.trim().slice(0, 200)}\n` +
      `Time: ${ts}`
    );
    // Reset so next batch of 3 failures fires another alert
    state.consecutiveFailures = 0;
    state.lastAlertAt = new Date().toISOString();
    saveState(state);
  }

  return { healthy: false, output, consecutiveFailures: state.consecutiveFailures };
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

let _task = null;

function scheduleHealthMonitor() {
  // Every 5 minutes
  _task = cron.schedule('*/5 * * * *', runHealthCheck);
}

function stopHealthMonitor() {
  if (_task) {
    _task.stop();
    _task = null;
  }
}

module.exports = { scheduleHealthMonitor, stopHealthMonitor, runHealthCheck, loadState, saveState };
