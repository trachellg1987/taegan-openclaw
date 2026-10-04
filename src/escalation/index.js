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
 *   // On process startup:
 *   replayOnStartup();
 */

const { startTimer, cancelTimer, replayPersistedTimers } = require('./timer');
const { runEscalation } = require('./alert');

function arm(id, message, step) {
  startTimer(id, message, step, runEscalation);
}

function disarm(id) {
  cancelTimer(id);
}

function replayOnStartup() {
  replayPersistedTimers(runEscalation);
}

module.exports = { arm, disarm, replayOnStartup };
