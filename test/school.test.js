'use strict';

jest.mock('../src/imessage');
jest.mock('../src/config');
jest.mock('../src/scrapers/classlink');

const fs = require('fs');
const os = require('os');
const path = require('path');
const { sendMessage } = require('../src/imessage');
const {
  readSkywardToday, buildClassMessage, messageFor, reminderTimes, GENERIC_MESSAGE,
} = require('../src/routines/school');
const { parseDayType } = require('../src/scrapers/skyward');

const CLASSES = {
  a_day: [
    { time: '11:05', class: 'Debate' },
    { time: '13:05', class: 'History' },
    { time: '14:42', class: 'Engineering' },
  ],
  b_day: [
    { time: '11:05', class: 'English' },
    { time: '13:05', class: 'Chemistry' },
    { time: '14:43', class: 'Algebra' },
  ],
};

beforeEach(() => jest.clearAllMocks());

// ─── Skyward A/B day parsing ─────────────────────────────────────────────────

describe('parseDayType', () => {
  test.each([
    ['Today is an A Day', 'A'],
    ['B-Day schedule', 'B'],
    ['Rotation: Day B', 'B'],
    ['a day', 'A'],
  ])('%s → %s', (text, expected) => expect(parseDayType(text)).toBe(expected));

  test('no A/B day text → null', () => expect(parseDayType('Gradebook Summary')).toBeNull());
  test('both A and B present → null (ambiguous)', () =>
    expect(parseDayType('Mon A Day  Tue B Day')).toBeNull());
  test('does not match words like "Today"', () =>
    expect(parseDayType('Today is Thursday')).toBeNull());
});

// ─── Reading skyward-data.json ───────────────────────────────────────────────

describe('readSkywardToday', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'school-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function write(data) {
    const file = path.join(dir, 'skyward-data.json');
    fs.writeFileSync(file, JSON.stringify(data));
    return file;
  }

  // 11:05 AM CDT on Thu 2026-10-08
  const NOW = new Date('2026-10-08T16:05:00Z');

  test('scraped today with dayType → returns it', () => {
    const file = write({ scrapedAt: '2026-10-08T11:00:00Z', dayType: 'B', missing: [] });
    expect(readSkywardToday(NOW, file).dayType).toBe('B');
  });

  test('scraped yesterday → unknown', () => {
    const file = write({ scrapedAt: '2026-10-07T20:00:00Z', dayType: 'A', missing: [] });
    expect(readSkywardToday(NOW, file).dayType).toBeNull();
  });

  test('late-evening UTC scrape counts as the same Central day', () => {
    // 2026-10-09T01:00Z is 8 PM CDT on 2026-10-08
    const file = write({ scrapedAt: '2026-10-09T01:00:00Z', dayType: 'A', missing: [] });
    const evening = new Date('2026-10-09T02:00:00Z');
    expect(readSkywardToday(evening, file).dayType).toBe('A');
  });

  test('missing file → unknown', () => {
    expect(readSkywardToday(NOW, path.join(dir, 'nope.json')).dayType).toBeNull();
  });

  test('invalid dayType → unknown', () => {
    const file = write({ scrapedAt: '2026-10-08T11:00:00Z', dayType: 'C' });
    expect(readSkywardToday(NOW, file)).toEqual({ dayType: null, missing: [] });
  });
});

// ─── Messages ────────────────────────────────────────────────────────────────

describe('buildClassMessage', () => {
  test('names the class and asks to turn in work and follow up', () => {
    const msg = buildClassMessage('Debate');
    expect(msg).toContain('Debate');
    expect(msg).toMatch(/turn in/);
    expect(msg).toMatch(/follow up with your teacher/);
    expect(msg).not.toContain('Missing');
  });

  test('lists Skyward missing work for that class only', () => {
    const missing = [
      { name: 'Lab 3', course: 'CHEMISTRY 1 PREAP', dueDate: null },
      { name: 'Essay', course: 'English I', dueDate: null },
    ];
    const msg = buildClassMessage('Chemistry', missing);
    expect(msg).toContain('Missing in Skyward: Lab 3');
    expect(msg).not.toContain('Essay');
  });
});

describe('messageFor', () => {
  const sky = dayType => ({ dayType, missing: [] });

  test('A day at 11:05 → Debate', () =>
    expect(messageFor('11:05', CLASSES, sky('A'))).toContain('Debate'));
  test('B day at 11:05 → English', () =>
    expect(messageFor('11:05', CLASSES, sky('B'))).toContain('English'));
  test('A day 14:42 → Engineering; nothing at 14:43', () => {
    expect(messageFor('14:42', CLASSES, sky('A'))).toContain('Engineering');
    expect(messageFor('14:43', CLASSES, sky('A'))).toBeNull();
  });
  test('B day 14:43 → Algebra; nothing at 14:42', () => {
    expect(messageFor('14:43', CLASSES, sky('B'))).toContain('Algebra');
    expect(messageFor('14:42', CLASSES, sky('B'))).toBeNull();
  });
  test('unknown day → generic at A-day times only', () => {
    expect(messageFor('11:05', CLASSES, sky(null))).toBe(GENERIC_MESSAGE);
    expect(messageFor('14:42', CLASSES, sky(null))).toBe(GENERIC_MESSAGE);
    expect(messageFor('14:43', CLASSES, sky(null))).toBeNull();
  });
});

describe('reminderTimes', () => {
  test('distinct sorted times across both days', () =>
    expect(reminderTimes(CLASSES)).toEqual(['11:05', '13:05', '14:42', '14:43']));
  test('empty config → no times', () =>
    expect(reminderTimes({ a_day: [], b_day: [] })).toEqual([]));
});

// ─── fire() never escalates ──────────────────────────────────────────────────

describe('fire()', () => {
  test('sends to taegan_phone and does not arm an escalation', () => {
    jest.isolateModules(() => {
      jest.doMock('../src/escalation', () => ({ arm: jest.fn() }));
      const { fire } = require('../src/routines/school');
      const { arm } = require('../src/escalation');
      const { sendMessage: send } = require('../src/imessage');
      fire('11:05', { taegan_phone: '+17373268781', class_reminders: CLASSES });
      expect(send).toHaveBeenCalledWith('+17373268781', expect.any(String));
      expect(arm).not.toHaveBeenCalled();
    });
  });
});
