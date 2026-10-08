'use strict';

/**
 * Escalation engine public API.
 *
 * Usage:
 *   const { arm, disarm, replayOnStartup } = require('./escalation');
 *
 *   // After sending an iMessage:
 *   arm('MR-001-2026-03-29T06:00', 'Good morning Taegan!', 'MR-001');
 *
 *   // When read receipt arrives:
 *   disarm('MR-001-2026-03-29T06:00');
 *
 *   // When Taegan replies by SMS (no per-message read receipts):
 *   disarmAll();
 *
 *   // On process startup:
 *   replayOnStartup();
 */

const { startTimer, cancelTimer, cancelAllTimers, replayPersistedTimers } = require('./timer');
const { runEscalation } = require('./alert');

function arm(id, message, step) {
  startTimer(id, message, step, runEscalation);
}

function disarm(id) {
  cancelTimer(id);
}

function disarmAll() {
  return cancelAllTimers();
}

function replayOnStartup() {
  replayPersistedTimers(entry => {
    // NT-005 nudges Taegan again rather than escalating to a call
    if (entry.step === 'NT-005') {
      require('../routines/nighttime').sendNudge();
    } else {
      runEscalation(entry);
    }
  });
}

module.exports = { arm, disarm, disarmAll, replayOnStartup };
