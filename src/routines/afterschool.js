'use strict';

/**
 * After-School Routine — AS-001 through AS-008
 *
 * Schedule (weekdays, America/Chicago):
 *   AS-001  16:45–17:15  Idle buffer — 30 min decompression, NO messages
 *   AS-002  17:15        Drink 2 full bottles of water
 *   AS-WASH 17:17        Wash jersey (only the school day before a game)
 *   AS-003  17:20        Protein-rich meal
 *   AS-004  17:35        Skyward PFISD check (+ missing count if scraper data available)
 *   AS-005  17:45        Canvas check (+ nearest due date if scraper data available)
 *   AS-006  17:55        School email, English portal, Google Classroom
 *   AS-007  18:10        Folder + backpack (+ gear bag if practice/game tomorrow,
 *                        + clean jersey if game next school day)
 *   AS-008  18:25–18:45  End buffer — free time, NO messages
 */

const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { sendMessage } = require('../imessage');
const { arm } = require('../escalation');
const { getConfig } = require('../config');
const { localDateKey, isGameNextSchoolDay } = require('./game-days');

const WORKSPACE = path.join(process.env.HOME, '.openclaw', 'workspace');

// ─── Scraper data helpers ────────────────────────────────────────────────────

/**
 * Returns the count of missing assignments from Skyward scraper data,
 * or null if the data file doesn't exist or can't be parsed.
 */
function getSkywardMissingCount() {
  try {
    const raw = fs.readFileSync(path.join(WORKSPACE, 'skyward-data.json'), 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data.missing) ? data.missing.length : null;
  } catch {
    return null;
  }
}

/**
 * Returns the nearest unsubmitted Canvas due date as a human-readable string,
 * or null if the data file doesn't exist or there are no upcoming assignments.
 * Expected shape: { assignments: [{ name, dueDate, submitted }] }
 */
function getCanvasNearestDue() {
  try {
    const raw = fs.readFileSync(path.join(WORKSPACE, 'canvas-data.json'), 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data.assignments)) return null;

    const now = Date.now();
    const upcoming = data.assignments
      .filter(a => !a.submitted && a.dueDate && new Date(a.dueDate).getTime() > now)
      .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

    if (upcoming.length === 0) return null;

    const next = upcoming[0];
    const due = new Date(next.dueDate);
    const dateStr = due.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    });
    return `${next.name} — due ${dateStr}`;
  } catch {
    return null;
  }
}

// ─── Gear day helpers ─────────────────────────────────────────────────────────

/**
 * Returns true if the given date is a practice day or a scheduled game day.
 */
function isGearDay(config, date = new Date()) {
  return (
    config.practice_days.includes(date.getDay()) ||
    config.game_schedule.includes(localDateKey(date))
  );
}

/**
 * Returns true if TOMORROW is a gear day.
 */
function isGearDayTomorrow(config, today = new Date()) {
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return isGearDay(config, tomorrow);
}

// ─── Schedule definition ──────────────────────────────────────────────────────

function buildSchedule(config, _now) {
  return [
    // AS-001: 4:45–5:15 — idle buffer, no cron entry (enforced by absence)

    {
      id: 'AS-002',
      cron: '0 15 17 * * 1-5',
      getMessage: () => 'Drink 2 full bottles of water right now.',
    },
    {
      id: 'AS-WASH',
      cron: '0 17 17 * * 1-5',
      // Only on the school day before a game (Friday for a Monday game)
      getMessage: () =>
        isGameNextSchoolDay(config, _now || new Date())
          ? 'Game next school day — put your jersey in the wash now so it\'s ready.'
          : null,
    },
    {
      id: 'AS-003',
      cron: '0 20 17 * * 1-5',
      getMessage: () => 'Time to eat a protein-rich meal to refuel.',
    },
    {
      id: 'AS-004',
      cron: '0 35 17 * * 1-5',
      getMessage: () => {
        const base = 'Open Skyward PFISD and check for any missing assignments.';
        const count = getSkywardMissingCount();
        if (count === null) return base;
        if (count === 0) return `${base} You're all caught up!`;
        return `${base} You have ${count} missing assignment${count === 1 ? '' : 's'}.`;
      },
    },
    {
      id: 'AS-005',
      cron: '0 45 17 * * 1-5',
      getMessage: () => {
        const base = 'Check Canvas for any upcoming assignments.';
        const nearest = getCanvasNearestDue();
        return nearest ? `${base} Next up: ${nearest}` : base;
      },
    },
    {
      id: 'AS-006',
      cron: '0 55 17 * * 1-5',
      getMessage: () =>
        'Check your school email, English assignment portal, and Google Classroom.',
    },
    {
      id: 'AS-007',
      cron: '0 10 18 * * 1-5',
      getMessage: () => {
        let msg = 'Check your folder and organize your backpack for tomorrow.';
        if (isGearDayTomorrow(config, _now)) msg += ' Pack your gear bag tonight.';
        if (isGameNextSchoolDay(config, _now || new Date())) msg += ' Pack your clean jersey for the game.';
        return msg;
      },
    },

    // AS-008: 6:25–6:45 — end buffer, no cron entry (enforced by absence)
  ];
}

// ─── Fire a single step ───────────────────────────────────────────────────────

function fire(entry, config) {
  const message = entry.getMessage();
  if (message == null) return; // conditional step that doesn't apply today
  const id = `${entry.id}-${Date.now()}`;
  sendMessage(config.taegan_phone, message);
  arm(id, message, entry.id);
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

let _tasks = [];

function scheduleAfterSchool() {
  const config = getConfig();
  const schedule = buildSchedule(config);
  _tasks = schedule.map(entry =>
    cron.schedule(entry.cron, () => fire(entry, config), {
      timezone: 'America/Chicago',
    })
  );
}

function stopAfterSchool() {
  _tasks.forEach(t => t.stop());
  _tasks = [];
}

module.exports = {
  scheduleAfterSchool,
  stopAfterSchool,
  buildSchedule,
  getSkywardMissingCount,
  getCanvasNearestDue,
  isGearDay,
  isGearDayTomorrow,
  fire,
};
