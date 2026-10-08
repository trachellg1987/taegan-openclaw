'use strict';

/**
 * School Class Reminders — SC-001
 *
 * While Taegan walks to each class, remind him to turn in any work due for
 * that class and to follow up with the teacher about missing assignments.
 *
 * Class times come from class_reminders.a_day / b_day in config.yaml. Today's
 * A/B day comes from the Skyward scraper (skyward-data.json → dayType), which
 * runs at 6:00 AM. If today's A/B day is unknown, a generic reminder goes out
 * at the A-day times instead.
 *
 * These reminders never arm an escalation: no call if Done isn't tapped.
 */

const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { sendMessage } = require('../imessage');
const { getConfig } = require('../config');

const TIMEZONE = 'America/Chicago';
const SKYWARD_FILE = path.join(
  process.env.HOME, '.openclaw', 'workspace', 'skyward-data.json'
);

function log(msg) {
  process.stdout.write(`[${new Date().toISOString()}] [SC-001] ${msg}\n`);
}

/** YYYY-MM-DD for the given instant in Central time. */
function centralDate(date) {
  return date.toLocaleDateString('en-CA', { timeZone: TIMEZONE });
}

/**
 * Read Skyward data scraped today. Returns { dayType, missing }, where
 * dayType is "A", "B" or null (not scraped today, or no A/B day found).
 */
function readSkywardToday(now = new Date(), file = SKYWARD_FILE) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data.scrapedAt || centralDate(new Date(data.scrapedAt)) !== centralDate(now)) {
      return { dayType: null, missing: [] };
    }
    const dayType = data.dayType === 'A' || data.dayType === 'B' ? data.dayType : null;
    return { dayType, missing: Array.isArray(data.missing) ? data.missing : [] };
  } catch {
    return { dayType: null, missing: [] };
  }
}

/** Skyward missing assignments whose course name mentions this class. */
function missingFor(className, missing) {
  const needle = className.toLowerCase();
  return missing.filter(m => (m.course || '').toLowerCase().includes(needle));
}

function buildClassMessage(className, missing = []) {
  let msg =
    `Heading to ${className}: turn in anything that's due, and follow up with ` +
    'your teacher about any assignments that need attention.';
  const items = missingFor(className, missing);
  if (items.length > 0) {
    msg += `\nMissing in Skyward: ${items.map(m => m.name).join(', ')}`;
  }
  return msg;
}

const GENERIC_MESSAGE =
  'Heading to your next class: turn in anything that\'s due, and follow up ' +
  'with your teacher about any assignments that need attention.';

/**
 * What to send at time HH:MM today, or null for nothing.
 * Known A/B day: that day's class at this time, if any.
 * Unknown day: the generic reminder at A-day times.
 */
function messageFor(time, classReminders, skyward) {
  const { dayType, missing } = skyward;
  if (dayType) {
    const list = dayType === 'A' ? classReminders.a_day : classReminders.b_day;
    const entry = list.find(e => e.time === time);
    return entry ? buildClassMessage(entry.class, missing) : null;
  }
  return classReminders.a_day.some(e => e.time === time) ? GENERIC_MESSAGE : null;
}

/** Every distinct HH:MM across A and B days. */
function reminderTimes(classReminders) {
  const times = new Set([...classReminders.a_day, ...classReminders.b_day].map(e => e.time));
  return [...times].sort();
}

function fire(time, config, now = new Date()) {
  const skyward = readSkywardToday(now);
  const message = messageFor(time, config.class_reminders, skyward);
  if (!message) return;
  log(`${time} ${skyward.dayType ? skyward.dayType + ' day' : 'A/B day unknown'} — sending reminder`);
  try {
    sendMessage(config.taegan_phone, message);
  } catch (err) {
    log(`Send failed: ${err.message}`);
  }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

let _tasks = [];

function scheduleSchool() {
  const config = getConfig();
  _tasks = reminderTimes(config.class_reminders).map(time => {
    const [hh, mm] = time.split(':').map(Number);
    return cron.schedule(`0 ${mm} ${hh} * * 1-5`, () => fire(time, config), {
      timezone: TIMEZONE,
    });
  });
  return _tasks.length;
}

function stopSchool() {
  _tasks.forEach(t => t.stop());
  _tasks = [];
}

module.exports = {
  scheduleSchool,
  stopSchool,
  // Exported for testing
  readSkywardToday,
  buildClassMessage,
  messageFor,
  reminderTimes,
  fire,
  GENERIC_MESSAGE,
};
