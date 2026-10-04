'use strict';

/**
 * Nighttime Routine — NT-001 through NT-006 (+ NT-LAUNDRY)
 *
 * Fires DAILY (not weekday-only), America/Chicago.
 *
 *   NT-001     20:45  Dumbbell workout
 *   NT-002     21:15  Shower
 *   NT-003     21:30  Brush teeth
 *   NT-004     21:40  Tidy room
 *   NT-LAUNDRY 21:45  Dirty laundry — FRIDAY ONLY
 *   NT-005     21:50  Screen off — MANDATORY ESCALATION (hardcoded, no exceptions)
 *   NT-006     22:30  Lights out — warm positive tone
 *   [blackout after 22:30 until 6:00 AM]
 */

const cron = require('node-cron');
const { sendMessage } = require('../imessage');
const { arm } = require('../escalation');
const { runEscalation } = require('../escalation/alert');
const { getConfig } = require('../config');

const MANDATORY_DELAY_MS = 5 * 60 * 1000; // 5 minutes, hardcoded

// ─── Schedule definition ──────────────────────────────────────────────────────

const SCHEDULE = [
  {
    id: 'NT-001',
    cron: '0 45 20 * * *',
    getMessage: () => 'Time for your dumbbell workout before bed.',
  },
  {
    id: 'NT-002',
    cron: '0 15 21 * * *',
    getMessage: () => 'Hop in the shower.',
  },
  {
    id: 'NT-003',
    cron: '0 30 21 * * *',
    getMessage: () => 'Brush your teeth.',
  },
  {
    id: 'NT-004',
    cron: '0 40 21 * * *',
    getMessage: () => 'Do a quick tidy of your room.',
  },
  {
    // Friday only (cron day-of-week = 5)
    id: 'NT-LAUNDRY',
    cron: '0 45 21 * * 5',
    getMessage: () => "Don't forget to put your dirty clothes in the laundry tonight.",
  },
  {
    id: 'NT-005',
    cron: '0 50 21 * * *',
    mandatoryEscalation: true, // HARDCODED — always escalates, read receipts ignored
    getMessage: () => 'Start winding down and put the phone down.',
  },
  {
    id: 'NT-006',
    cron: '0 30 22 * * *',
    getMessage: () => 'Lights out Taegan. You crushed it today. Get some rest.',
  },
];

// ─── Fire a single step ───────────────────────────────────────────────────────

function fire(entry, config) {
  const message = entry.getMessage();
  sendMessage(config.taegan_phone, message);

  if (entry.mandatoryEscalation) {
    // NT-005: unconditional — always escalates after 5 min regardless of read status.
    // Does NOT use arm/disarm — this timer cannot be cancelled.
    setTimeout(() => runEscalation({ step: entry.id, message }), MANDATORY_DELAY_MS);
  } else {
    arm(`${entry.id}-${Date.now()}`, message, entry.id);
  }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

let _tasks = [];

function scheduleNighttime() {
  const config = getConfig();
  _tasks = SCHEDULE.map(entry =>
    cron.schedule(entry.cron, () => fire(entry, config), {
      timezone: 'America/Chicago',
    })
  );
}

function stopNighttime() {
  _tasks.forEach(t => t.stop());
  _tasks = [];
}

module.exports = {
  scheduleNighttime,
  stopNighttime,
  SCHEDULE,
  fire,
};
