'use strict';

/**
 * ESC-001: Read-receipt escalation timer.
 *
 * When a message is sent, startTimer(id, message) begins a 5-minute window.
 * Every 60 seconds it checks if the message has been read (caller supplies
 * the read-receipt check via markRead(id)).  If still unread at 5 minutes,
 * it fires the escalation chain (ESC-002).
 *
 * State is persisted to disk so timers survive a gateway restart.
 */

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(
  process.env.HOME, '.openclaw', 'workspace', 'escalation-state.json'
);
const POLL_INTERVAL_MS = 60_000;   // 1 minute
const ESCALATION_TIMEOUT_MS = 5 * 60_000; // 5 minutes

// In-memory map of active timers: id → { intervalId, timeoutId }
const _activeTimers = new Map();

// ─── Persistence ─────────────────────────────────────────────────────────────

function _loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function _saveState(state) {
  const dir = path.dirname(STATE_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function _removeFromState(id) {
  const state = _loadState();
  delete state[id];
  _saveState(state);
}

// ─── Timer lifecycle ──────────────────────────────────────────────────────────

/**
 * Start a read-receipt timer for a sent message.
 *
 * @param {string}   id        - Unique ID for this message (e.g. "MR-001-2026-03-29T06:00")
 * @param {string}   message   - Original message text (for escalation payload)
 * @param {string}   step      - PRD story ID (e.g. "MR-001") for parent alert
 * @param {Function} onEscalate - Called with ({ id, step, message }) when unread at 5 min
 */
function startTimer(id, message, step, onEscalate) {
  // Persist so we can resume after restart
  const state = _loadState();
  state[id] = { id, message, step, startedAt: Date.now() };
  _saveState(state);

  const pollInterval = setInterval(() => {
    // Nothing to do on poll — cancelTimer handles the read case
  }, POLL_INTERVAL_MS);

  const escalationTimeout = setTimeout(() => {
    clearInterval(pollInterval);
    _removeFromState(id);
    _activeTimers.delete(id);
    onEscalate({ id, step, message });
  }, ESCALATION_TIMEOUT_MS);

  _activeTimers.set(id, { intervalId: pollInterval, timeoutId: escalationTimeout });
}

/**
 * Mark a message as read — cancels its escalation timer.
 * Call this when a read receipt is detected.
 *
 * @param {string} id - Same ID passed to startTimer
 */
function cancelTimer(id) {
  const timer = _activeTimers.get(id);
  if (!timer) return;
  clearInterval(timer.intervalId);
  clearTimeout(timer.timeoutId);
  _activeTimers.delete(id);
  _removeFromState(id);
}

/**
 * Cancel every pending timer — used when Taegan replies by SMS, since SMS has
 * no per-message read receipts. Returns the number of timers cancelled.
 */
function cancelAllTimers() {
  const ids = [..._activeTimers.keys()];
  ids.forEach(cancelTimer);
  _saveState({});
  return ids.length;
}

/**
 * Replay any timers that were persisted but not yet fired (e.g. after restart).
 * Timers that already expired trigger escalation immediately.
 *
 * @param {Function} onEscalate - Same callback shape as startTimer
 */
function replayPersistedTimers(onEscalate) {
  const state = _loadState();
  const now = Date.now();

  for (const [id, entry] of Object.entries(state)) {
    const elapsed = now - entry.startedAt;
    const remaining = ESCALATION_TIMEOUT_MS - elapsed;

    if (remaining <= 0) {
      // Already past deadline — escalate now
      _removeFromState(id);
      onEscalate({ id, step: entry.step, message: entry.message });
    } else {
      // Resume with reduced timeout
      const pollInterval = setInterval(() => {}, POLL_INTERVAL_MS);
      const escalationTimeout = setTimeout(() => {
        clearInterval(pollInterval);
        _removeFromState(id);
        _activeTimers.delete(id);
        onEscalate({ id, step: entry.step, message: entry.message });
      }, remaining);
      _activeTimers.set(id, { intervalId: pollInterval, timeoutId: escalationTimeout });
    }
  }
}

function _activeCount() {
  return _activeTimers.size;
}

module.exports = { startTimer, cancelTimer, cancelAllTimers, replayPersistedTimers, _activeCount };
