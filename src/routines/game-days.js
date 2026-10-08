'use strict';

/**
 * Game-day date helpers shared by the morning and after-school routines.
 *
 * Dates are compared in the server's local time zone (America/Chicago on the
 * VPS). toISOString() would use UTC, which is already the next day after
 * 6 or 7 PM Central.
 */

/** YYYY-MM-DD for the given date in local time. */
function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isGameDay(config, date = new Date()) {
  return config.game_schedule.includes(localDateKey(date));
}

/** The next weekday after the given date (Friday → Monday). */
function nextSchoolDay(date = new Date()) {
  const next = new Date(date);
  do {
    next.setDate(next.getDate() + 1);
  } while (next.getDay() === 0 || next.getDay() === 6);
  return next;
}

/** True if the next school day is a game day (Friday covers a Monday game). */
function isGameNextSchoolDay(config, date = new Date()) {
  return isGameDay(config, nextSchoolDay(date));
}

module.exports = { localDateKey, isGameDay, nextSchoolDay, isGameNextSchoolDay };
