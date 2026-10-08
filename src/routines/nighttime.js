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
 *   NT-005     21:50  Screen off — second nudge if no response in 5 min (no call)
 *   NT-006     22:30  Lights out — warm positive tone
 *   [blackout after 22:30 until 6:00 AM]
 */

const cron = require('node-cron');
const { sendMessage } = require('../imessage');
const { arm } = require('../escalation');
const { startTimer } = require('../escalation/timer');
const { getConfig } = require('../config');

const NUDGE_MESSAGE = "Taegan, it's past screen-off time. Phone down now, please. 🌙";

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
    mandatoryEscalation: true, // nudges again instead of calling the parent
    getMessage: () => 'Start winding down and put the phone down.',
  },
  {
    id: 'NT-006',
    cron: '0 30 22 * * *',
    getMessage: () => 'Lights out Taegan. You crushed it today. Get some rest.',
  },
];

/** NT-005 follow-up when Taegan hasn't responded. Also used for replayed timers. */
function sendNudge() {
  sendMessage(getConfig().taegan_phone, NUDGE_MESSAGE);
}

// ─── Fire a single step ───────────────────────────────────────────────────────

function fire(entry, config) {
  const message = entry.getMessage();
  sendMessage(config.taegan_phone, message);

  if (entry.mandatoryEscalation) {
    // NT-005: no phone call. If Taegan hasn't tapped Done or replied within
    // 5 min, he gets a firmer second nudge instead.
    startTimer(`${entry.id}-${Date.now()}`, message, entry.id, sendNudge);
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
  sendNudge,
  NUDGE_MESSAGE,
  scheduleNighttime,
  stopNighttime,
  SCHEDULE,
  fire,
};
