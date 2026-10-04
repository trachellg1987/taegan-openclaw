'use strict';

/**
 * Morning Routine — MR-001 through MR-010 (+ MR-KNEE and MR-WATER)
 *
 * Schedule (weekdays, America/Chicago):
 *   MR-001  06:00  Wake up — earphones in + playlist link
 *   MR-002  06:05  Push-ups (progressive: 10 reps + 3 per week)
 *   MR-003  06:08  Bathroom — brush, floss, shower
 *   MR-004  06:20  Get dressed
 *   MR-005  06:30  Tidy room and make bed
 *   MR-006  06:35  Breakfast
 *   MR-008  06:40  Make lunch
 *   MR-KNEE 06:50  Peloton knee bands
 *   [idle   06:55–07:10 — no messages]
 *   MR-010  07:10  Pack backpack and head out (+ gear reminder if game/practice)
 *   MR-WATER 07:25 Grab 4 waters
 *   [blackout after 07:30]
 */

const cron = require('node-cron');
const { sendMessage } = require('../imessage');
const { arm } = require('../escalation');
const { getConfig } = require('../config');

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
  const dayOfWeek = date.getDay(); // 0=Sun
  const dateStr = date.toISOString().slice(0, 10); // YYYY-MM-DD
  return (
    config.practice_days.includes(dayOfWeek) ||
    config.game_schedule.includes(dateStr)
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
      cron: '0 0 6 * * 1-5',
      getMessage: () => {
        const base = 'Good morning! Earphones in 🎵';
        return config.taegan_playlist_url
          ? `${base}\n${config.taegan_playlist_url}`
          : base;
      },
    },
    {
      id: 'MR-002',
      cron: '0 5 6 * * 1-5',
      getMessage: () => `Drop and give me ${reps}!`,
    },
    {
      id: 'MR-003',
      cron: '0 8 6 * * 1-5',
      getMessage: () => 'Brush your teeth, floss, and hop in the shower.',
    },
    {
      id: 'MR-004',
      cron: '0 20 6 * * 1-5',
      getMessage: () => 'Time to get dressed.',
    },
    {
      id: 'MR-005',
      cron: '0 30 6 * * 1-5',
      getMessage: () => 'Tidy your room and make your bed.',
    },
    {
      id: 'MR-006',
      cron: '0 35 6 * * 1-5',
      getMessage: () => 'Go eat breakfast.',
    },
    {
      id: 'MR-008',
      cron: '0 40 6 * * 1-5',
      getMessage: () => 'Make your lunch.',
    },
    {
      id: 'MR-KNEE',
      cron: '0 50 6 * * 1-5',
      getMessage: () => "Don't forget your Peloton knee bands.",
    },
    // MR-009: idle buffer 06:55–07:10 — no messages scheduled
    {
      id: 'MR-010',
      cron: '0 10 7 * * 1-5',
      getMessage: () => {
        const base = 'Pack your backpack and head out!';
        return isGearDay(config) ? `${base} Don't forget your gear bag.` : base;
      },
    },
    {
      id: 'MR-WATER',
      cron: '0 25 7 * * 1-5',
      getMessage: () => 'Grab your 4 waters before you head out.',
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
