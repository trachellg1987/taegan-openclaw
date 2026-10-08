'use strict';

/**
 * Morning Routine — MR-001 through MR-010 (+ MR-KNEE and MR-DEPART)
 *
 * Schedule (weekdays, America/Chicago):
 *   MR-001    06:45  Wake up — earphones in + playlist link
 *   MR-002    06:47  Push-ups (progressive: 10 reps + 3 per week)
 *   MR-003    06:50  Bathroom — brush, floss, shower
 *   MR-004    07:02  Get dressed
 *   MR-005    07:08  Tidy room and make bed
 *   MR-006    07:12  Breakfast
 *   MR-008    07:18  Make lunch
 *   MR-KNEE   07:22  Peloton knee bands
 *   MR-010    07:25  Pack backpack + 4 waters (+ gear bag on practice/game days,
 *                    + jersey on game days)
 *   MR-DEPART 07:30  Head out
 */

const cron = require('node-cron');
const { sendMessage } = require('../imessage');
const { arm } = require('../escalation');
const { getConfig } = require('../config');
const { localDateKey, isGameDay } = require('./game-days');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Calculate push-up reps for a given week number.
 * Week 1 = 10, Week 2 = 13, Week 3 = 16, ... (+3/week)
 */
function getPushupReps(week) {
  return 10 + (Math.max(1, week) - 1) * 3;
}

/**
 * Returns true if the given date is a practice day or a scheduled game day.
 */
function isGearDay(config, date = new Date()) {
  return (
    config.practice_days.includes(date.getDay()) || // 0=Sun
    config.game_schedule.includes(localDateKey(date))
  );
}

// ─── Schedule definition ──────────────────────────────────────────────────────

/**
 * Build the full morning schedule for the given config.
 * Returns an array of { id, cron, getMessage } entries.
 * Exported for testing.
 */
function buildSchedule(config) {
  const reps = getPushupReps(config.pushup_week);

  return [
    {
      id: 'MR-001',
      cron: '0 45 6 * * 1-5',
      getMessage: () => {
        const base = 'Good morning! Earphones in 🎵';
        return config.taegan_playlist_url
          ? `${base}\n${config.taegan_playlist_url}`
          : base;
      },
    },
    {
      id: 'MR-002',
      cron: '0 47 6 * * 1-5',
      getMessage: () => `Drop and give me ${reps}!`,
    },
    {
      id: 'MR-003',
      cron: '0 50 6 * * 1-5',
      getMessage: () => 'Brush your teeth, floss, and hop in the shower.',
    },
    {
      id: 'MR-004',
      cron: '0 2 7 * * 1-5',
      getMessage: () => 'Time to get dressed.',
    },
    {
      id: 'MR-005',
      cron: '0 8 7 * * 1-5',
      getMessage: () => 'Tidy your room and make your bed.',
    },
    {
      id: 'MR-006',
      cron: '0 12 7 * * 1-5',
      getMessage: () => 'Go eat breakfast.',
    },
    {
      id: 'MR-008',
      cron: '0 18 7 * * 1-5',
      getMessage: () => 'Make your lunch.',
    },
    {
      id: 'MR-KNEE',
      cron: '0 22 7 * * 1-5',
      getMessage: () => "Don't forget your Peloton knee bands.",
    },
    {
      id: 'MR-010',
      cron: '0 25 7 * * 1-5',
      getMessage: () => {
        let msg = 'Pack your backpack and grab your 4 waters.';
        if (isGearDay(config)) msg += " Don't forget your gear bag.";
        if (isGameDay(config)) msg += ' Game today — bring your jersey!';
        return msg;
      },
    },
    {
      id: 'MR-DEPART',
      cron: '0 30 7 * * 1-5',
      getMessage: () => 'Time to head out!',
    },
  ];
}

// ─── Fire a single step ───────────────────────────────────────────────────────

function fire(entry, config) {
  const message = entry.getMessage();
  const id = `${entry.id}-${Date.now()}`;
  sendMessage(config.taegan_phone, message);
  arm(id, message, entry.id);
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

let _tasks = [];

function scheduleMorning() {
  const config = getConfig();
  const schedule = buildSchedule(config);
  _tasks = schedule.map(entry =>
    cron.schedule(entry.cron, () => fire(entry, config), {
      timezone: 'America/Chicago',
    })
  );
}

function stopMorning() {
  _tasks.forEach(t => t.stop());
  _tasks = [];
}

module.exports = {
  scheduleMorning,
  stopMorning,
  // Exported for testing
  buildSchedule,
  getPushupReps,
  isGearDay,
  fire,
};
