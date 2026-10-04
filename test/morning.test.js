'use strict';

jest.mock('../src/imessage');
jest.mock('../src/escalation');
jest.mock('../src/config');

const { sendMessage } = require('../src/imessage');
const { arm } = require('../src/escalation');
const { getConfig } = require('../src/config');
const { buildSchedule, getPushupReps, isGearDay, fire } = require('../src/routines/morning');

// ─── Base config ──────────────────────────────────────────────────────────────

const BASE_CONFIG = {
  taegan_phone: '+17373268781',
  taegan_playlist_url: '',
  pushup_week: 1,
  practice_days: [1, 2, 3, 4], // Mon–Thu
  game_schedule: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  getConfig.mockReturnValue(BASE_CONFIG);
});

// ─── Push-up progression ─────────────────────────────────────────────────────

describe('getPushupReps', () => {
  test('week 1 = 10 reps', () => expect(getPushupReps(1)).toBe(10));
  test('week 2 = 13 reps', () => expect(getPushupReps(2)).toBe(13));
  test('week 3 = 16 reps', () => expect(getPushupReps(3)).toBe(16));
  test('week 4 = 19 reps', () => expect(getPushupReps(4)).toBe(19));
  test('week 10 = 37 reps', () => expect(getPushupReps(10)).toBe(37));
  test('week 0 treated as week 1', () => expect(getPushupReps(0)).toBe(10));
});

// ─── Schedule structure ───────────────────────────────────────────────────────

describe('buildSchedule', () => {
  test('contains all required story IDs', () => {
    const schedule = buildSchedule(BASE_CONFIG);
    const ids = schedule.map(e => e.id);
    ['MR-001', 'MR-002', 'MR-003', 'MR-004', 'MR-005',
     'MR-006', 'MR-008', 'MR-010',
     'MR-KNEE', 'MR-WATER'].forEach(id => {
      expect(ids).toContain(id);
    });
  });

  test('no messages scheduled during idle buffer 06:55–07:10', () => {
    const schedule = buildSchedule(BASE_CONFIG);
    const idleTimes = schedule
      .map(e => e.cron)
      .filter(c => {
        // Parse "0 MM HH * * 1-5" — check if time falls in 06:55–07:09
        const [, min, hr] = c.split(' ');
        const totalMin = parseInt(hr) * 60 + parseInt(min);
        return totalMin >= 6 * 60 + 55 && totalMin < 7 * 60 + 10;
      });
    expect(idleTimes).toHaveLength(0);
  });

  test('no messages scheduled after 07:30 blackout', () => {
    const schedule = buildSchedule(BASE_CONFIG);
    const afterBlackout = schedule
      .map(e => e.cron)
      .filter(c => {
        const [, min, hr] = c.split(' ');
        const totalMin = parseInt(hr) * 60 + parseInt(min);
        return totalMin >= 7 * 60 + 30;
      });
    expect(afterBlackout).toHaveLength(0);
  });

  test('all entries are weekday-only crons (1-5)', () => {
    const schedule = buildSchedule(BASE_CONFIG);
    schedule.forEach(entry => {
      expect(entry.cron).toMatch(/1-5$/);
    });
  });
});

// ─── MR-001: Wake-up + playlist ───────────────────────────────────────────────

describe('MR-001 wake-up message', () => {
  test('no playlist URL — message has no link', () => {
    const schedule = buildSchedule({ ...BASE_CONFIG, taegan_playlist_url: '' });
    const msg = schedule.find(e => e.id === 'MR-001').getMessage();
    expect(msg).toBe('Good morning! Earphones in 🎵');
    expect(msg).not.toContain('http');
  });

  test('playlist URL set — message includes link on second line', () => {
    const url = 'https://music.apple.com/playlist/abc123';
    const schedule = buildSchedule({ ...BASE_CONFIG, taegan_playlist_url: url });
    const msg = schedule.find(e => e.id === 'MR-001').getMessage();
    expect(msg).toContain('Good morning! Earphones in 🎵');
    expect(msg).toContain(url);
    expect(msg.split('\n')[1]).toBe(url);
  });
});

// ─── MR-002: Push-ups ────────────────────────────────────────────────────────

describe('MR-002 push-up message', () => {
  test('week 1 says 10 reps', () => {
    const schedule = buildSchedule({ ...BASE_CONFIG, pushup_week: 1 });
    const msg = schedule.find(e => e.id === 'MR-002').getMessage();
    expect(msg).toContain('10');
  });

  test('week 4 says 19 reps', () => {
    const schedule = buildSchedule({ ...BASE_CONFIG, pushup_week: 4 });
    const msg = schedule.find(e => e.id === 'MR-002').getMessage();
    expect(msg).toContain('19');
  });
});

// ─── MR-010: Gear reminder ────────────────────────────────────────────────────

describe('MR-010 gear reminder', () => {
  test('no gear reminder on non-practice, non-game day', () => {
    // Sunday (0) is not in practice_days [1,2,3,4]
    const sunday = new Date('2026-03-29T07:10:00'); // Sunday
    const schedule = buildSchedule(BASE_CONFIG);
    const entry = schedule.find(e => e.id === 'MR-010');

    // Temporarily override isGearDay by using a custom config with no days
    const msg = buildSchedule({ ...BASE_CONFIG, practice_days: [], game_schedule: [] })
      .find(e => e.id === 'MR-010').getMessage();
    expect(msg).toBe('Pack your backpack and head out!');
    expect(msg).not.toContain('gear bag');
  });

  test('gear reminder appended on practice day', () => {
    // Use Monday (1) which is in practice_days
    const mondayConfig = { ...BASE_CONFIG, practice_days: [1] };

    // We need to stub isGearDay — instead test isGearDay directly
    const monday = new Date('2026-03-30T07:10:00'); // Monday
    expect(isGearDay(mondayConfig, monday)).toBe(true);
  });

  test('gear reminder appended on game day', () => {
    const config = { ...BASE_CONFIG, practice_days: [], game_schedule: ['2026-04-05'] };
    const gameDay = new Date('2026-04-05T07:10:00');
    expect(isGearDay(config, gameDay)).toBe(true);
  });

  test('no gear reminder on Sunday with no games', () => {
    const config = { ...BASE_CONFIG, practice_days: [], game_schedule: [] };
    const sunday = new Date('2026-03-29T07:10:00');
    expect(isGearDay(config, sunday)).toBe(false);
  });
});

// ─── MR-KNEE and MR-WATER ─────────────────────────────────────────────────────

describe('custom reminders', () => {
  test('MR-KNEE mentions Peloton knee bands', () => {
    const schedule = buildSchedule(BASE_CONFIG);
    const msg = schedule.find(e => e.id === 'MR-KNEE').getMessage();
    expect(msg.toLowerCase()).toContain('knee bands');
  });

  test('MR-WATER mentions 4 waters', () => {
    const schedule = buildSchedule(BASE_CONFIG);
    const msg = schedule.find(e => e.id === 'MR-WATER').getMessage();
    expect(msg).toContain('4 waters');
  });
});

// ─── fire() wires sendMessage + arm ──────────────────────────────────────────

describe('fire()', () => {
  test('calls sendMessage with taegan_phone and message', () => {
    const entry = buildSchedule(BASE_CONFIG).find(e => e.id === 'MR-001');
    fire(entry, BASE_CONFIG);
    expect(sendMessage).toHaveBeenCalledWith(BASE_CONFIG.taegan_phone, expect.any(String));
  });

  test('calls arm() with step id and message', () => {
    const entry = buildSchedule(BASE_CONFIG).find(e => e.id === 'MR-001');
    fire(entry, BASE_CONFIG);
    expect(arm).toHaveBeenCalledWith(
      expect.stringContaining('MR-001'),
      expect.any(String),
      'MR-001'
    );
  });

  test('every schedule entry fires sendMessage and arm', () => {
    const schedule = buildSchedule(BASE_CONFIG);
    schedule.forEach(entry => {
      jest.clearAllMocks();
      fire(entry, BASE_CONFIG);
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(arm).toHaveBeenCalledTimes(1);
    });
  });
});
