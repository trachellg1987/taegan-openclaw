'use strict';

jest.mock('../src/imessage');
jest.mock('../src/escalation');
jest.mock('../src/config');
jest.mock('fs');

const { sendMessage } = require('../src/imessage');
const { arm } = require('../src/escalation');
const { getConfig } = require('../src/config');
const fs = require('fs');

const {
  buildSchedule,
  getSkywardMissingCount,
  getCanvasNearestDue,
  isGearDay,
  isGearDayTomorrow,
  fire,
} = require('../src/routines/afterschool');

const BASE_CONFIG = {
  taegan_phone: '+17373268781',
  practice_days: [1, 2, 3, 4], // Mon–Thu
  game_schedule: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  getConfig.mockReturnValue(BASE_CONFIG);
  fs.readFileSync.mockImplementation(() => { throw new Error('no file'); });
});

// ─── Idle buffers: no crons in their windows ──────────────────────────────────

describe('idle buffers', () => {
  function cronToMinutes(cronStr) {
    const [, min, hr] = cronStr.split(' ');
    return parseInt(hr) * 60 + parseInt(min);
  }

  test('no messages during AS-001 idle buffer (16:45–17:15)', () => {
    const schedule = buildSchedule(BASE_CONFIG);
    const inBuffer = schedule.filter(e => {
      const m = cronToMinutes(e.cron);
      return m >= 16 * 60 + 45 && m < 17 * 60 + 15;
    });
    expect(inBuffer).toHaveLength(0);
  });

  test('no messages during AS-008 end buffer (18:25–18:45)', () => {
    const schedule = buildSchedule(BASE_CONFIG);
    const inBuffer = schedule.filter(e => {
      const m = cronToMinutes(e.cron);
      return m >= 18 * 60 + 25 && m <= 18 * 60 + 45;
    });
    expect(inBuffer).toHaveLength(0);
  });

  test('no messages after 18:45 blackout', () => {
    const schedule = buildSchedule(BASE_CONFIG);
    const afterBlackout = schedule.filter(e => {
      const m = cronToMinutes(e.cron);
      return m > 18 * 60 + 45;
    });
    expect(afterBlackout).toHaveLength(0);
  });
});

// ─── Story IDs present ────────────────────────────────────────────────────────

describe('schedule structure', () => {
  test('contains all required story IDs', () => {
    const ids = buildSchedule(BASE_CONFIG).map(e => e.id);
    ['AS-002', 'AS-003', 'AS-004', 'AS-005', 'AS-006', 'AS-007'].forEach(id => {
      expect(ids).toContain(id);
    });
  });

  test('all entries are weekday-only crons (1-5)', () => {
    buildSchedule(BASE_CONFIG).forEach(entry => {
      expect(entry.cron).toMatch(/1-5$/);
    });
  });
});

// ─── AS-002: Water ───────────────────────────────────────────────────────────

test('AS-002 message mentions 2 bottles of water', () => {
  const msg = buildSchedule(BASE_CONFIG).find(e => e.id === 'AS-002').getMessage();
  expect(msg).toContain('2 full bottles of water');
});

// ─── AS-003: Protein ─────────────────────────────────────────────────────────

test('AS-003 message mentions protein', () => {
  const msg = buildSchedule(BASE_CONFIG).find(e => e.id === 'AS-003').getMessage();
  expect(msg.toLowerCase()).toContain('protein');
});

// ─── AS-004: Skyward ─────────────────────────────────────────────────────────

describe('AS-004 Skyward check', () => {
  test('no scraper data — base message only, no count appended', () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    const msg = buildSchedule(BASE_CONFIG).find(e => e.id === 'AS-004').getMessage();
    expect(msg).toContain('Skyward PFISD');
    expect(msg).not.toContain('You have');
    expect(msg).not.toContain('all caught up');
  });

  test('0 missing — all caught up', () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ missing: [] }));
    const msg = buildSchedule(BASE_CONFIG).find(e => e.id === 'AS-004').getMessage();
    expect(msg).toContain("all caught up");
  });

  test('1 missing — singular', () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ missing: [{ name: 'Essay' }] }));
    const msg = buildSchedule(BASE_CONFIG).find(e => e.id === 'AS-004').getMessage();
    expect(msg).toContain('1 missing assignment.');
  });

  test('3 missing — plural', () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({
      missing: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
    }));
    const msg = buildSchedule(BASE_CONFIG).find(e => e.id === 'AS-004').getMessage();
    expect(msg).toContain('3 missing assignments.');
  });
});

// ─── AS-005: Canvas ───────────────────────────────────────────────────────────

describe('AS-005 Canvas check', () => {
  test('no scraper data — base message only', () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    const msg = buildSchedule(BASE_CONFIG).find(e => e.id === 'AS-005').getMessage();
    expect(msg).toContain('Canvas');
    expect(msg).not.toContain('Next up');
  });

  test('upcoming unsubmitted assignment — appends due date', () => {
    const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    fs.readFileSync.mockReturnValue(JSON.stringify({
      assignments: [{ name: 'History Essay', dueDate: future, submitted: false }],
    }));
    const msg = buildSchedule(BASE_CONFIG).find(e => e.id === 'AS-005').getMessage();
    expect(msg).toContain('History Essay');
    expect(msg).toContain('Next up:');
  });

  test('all assignments submitted — base message only', () => {
    const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    fs.readFileSync.mockReturnValue(JSON.stringify({
      assignments: [{ name: 'Quiz', dueDate: future, submitted: true }],
    }));
    const msg = buildSchedule(BASE_CONFIG).find(e => e.id === 'AS-005').getMessage();
    expect(msg).not.toContain('Next up');
  });
});

// ─── AS-006: Email/portals ────────────────────────────────────────────────────

test('AS-006 mentions school email and Google Classroom', () => {
  const msg = buildSchedule(BASE_CONFIG).find(e => e.id === 'AS-006').getMessage();
  expect(msg.toLowerCase()).toContain('school email');
  expect(msg.toLowerCase()).toContain('google classroom');
});

// ─── AS-007: Folder/backpack + gear ──────────────────────────────────────────

describe('AS-007 backpack + gear reminder', () => {
  test('no gear reminder when tomorrow is not a practice/game day', () => {
    const sunday = new Date('2026-03-29'); // Sunday — not in practice_days [1-4]
    // tomorrow is Monday, which IS practice day
    // use a Saturday so tomorrow is Sunday
    const saturday = new Date('2026-03-28');
    const schedule = buildSchedule({ ...BASE_CONFIG, practice_days: [] }, saturday);
    const msg = schedule.find(e => e.id === 'AS-007').getMessage();
    expect(msg).toContain('backpack');
    expect(msg).not.toContain('gear bag');
  });

  test('gear bag reminder when tomorrow is a practice day', () => {
    // today = Sunday Mar 29 (local noon avoids UTC-to-CST date shift)
    // tomorrow = Monday (day 1) = practice day
    const sunday = new Date('2026-03-29T12:00:00');
    const schedule = buildSchedule({ ...BASE_CONFIG, practice_days: [1] }, sunday);
    const msg = schedule.find(e => e.id === 'AS-007').getMessage();
    expect(msg).toContain('gear bag');
  });

  test('gear bag reminder when tomorrow is a game day', () => {
    const gameEve = new Date('2026-04-04T12:00:00'); // tomorrow is 2026-04-05 (game day)
    const schedule = buildSchedule(
      { ...BASE_CONFIG, practice_days: [], game_schedule: ['2026-04-05'] },
      gameEve
    );
    const msg = schedule.find(e => e.id === 'AS-007').getMessage();
    expect(msg).toContain('gear bag');
  });
});

// ─── fire() wires sendMessage + arm ──────────────────────────────────────────

// ─── Jersey: wash the school day before a game, pack it that evening ─────────

describe('jersey reminders', () => {
  const GAMES = { ...BASE_CONFIG, practice_days: [1, 2, 3, 4, 5], game_schedule: ['2026-12-01', '2026-11-23'] };
  const wash = (now) => buildSchedule(GAMES, now).find(e => e.id === 'AS-WASH').getMessage();
  const pack = (now) => buildSchedule(GAMES, now).find(e => e.id === 'AS-007').getMessage();

  test('AS-WASH runs at 5:17 PM weekdays', () => {
    expect(buildSchedule(GAMES).find(e => e.id === 'AS-WASH').cron).toBe('0 17 17 * * 1-5');
  });

  test('day before a Tuesday game → wash and pack jersey', () => {
    const monday = new Date('2026-11-30T17:17:00');
    expect(wash(monday)).toMatch(/jersey in the wash/);
    expect(pack(monday)).toMatch(/clean jersey/);
  });

  test('Friday before a Monday game → wash and pack jersey', () => {
    const friday = new Date('2026-11-20T17:17:00');
    expect(wash(friday)).toMatch(/jersey in the wash/);
    expect(pack(friday)).toMatch(/clean jersey/);
  });

  test('no game next school day → no wash message, no jersey in AS-007', () => {
    const wednesday = new Date('2026-12-02T17:17:00');
    expect(wash(wednesday)).toBeNull();
    expect(pack(wednesday)).not.toMatch(/jersey/);
  });

  test('works after 7 PM CST when UTC is already the next day', () => {
    // 18:10 CST on Mon 2026-11-30 is 00:10 UTC on Tue 2026-12-01
    const evening = new Date('2026-11-30T18:10:00');
    expect(pack(evening)).toMatch(/clean jersey/);
    const gameEvening = new Date('2026-12-01T18:10:00');
    expect(pack(gameEvening)).not.toMatch(/jersey/);
  });

  test('fire() skips AS-WASH on days it does not apply', () => {
    const entry = buildSchedule(GAMES, new Date('2026-12-02T17:17:00')).find(e => e.id === 'AS-WASH');
    fire(entry, GAMES);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(arm).not.toHaveBeenCalled();
  });
});

describe('fire()', () => {
  test('every schedule entry calls sendMessage and arm', () => {
    const schedule = buildSchedule(BASE_CONFIG).filter(e => e.id !== 'AS-WASH');
    schedule.forEach(entry => {
      jest.clearAllMocks();
      fire(entry, BASE_CONFIG);
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(arm).toHaveBeenCalledWith(
        expect.stringContaining(entry.id),
        expect.any(String),
        entry.id
      );
    });
  });
});
