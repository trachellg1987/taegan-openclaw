'use strict';

jest.mock('../src/imessage');
jest.mock('../src/escalation');
jest.mock('../src/escalation/alert');
jest.mock('../src/config');

const { sendMessage } = require('../src/imessage');
const { arm } = require('../src/escalation');
const { runEscalation } = require('../src/escalation/alert');
const { getConfig } = require('../src/config');
const { SCHEDULE, fire } = require('../src/routines/nighttime');

const BASE_CONFIG = { taegan_phone: '+17373268781' };

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  getConfig.mockReturnValue(BASE_CONFIG);
});

afterEach(() => {
  jest.useRealTimers();
});

// ─── Schedule structure ───────────────────────────────────────────────────────

describe('schedule structure', () => {
  test('contains all required story IDs', () => {
    const ids = SCHEDULE.map(e => e.id);
    ['NT-001', 'NT-002', 'NT-003', 'NT-004', 'NT-005', 'NT-006', 'NT-LAUNDRY']
      .forEach(id => expect(ids).toContain(id));
  });

  test('all non-laundry entries fire daily (not weekday-only)', () => {
    SCHEDULE.filter(e => e.id !== 'NT-LAUNDRY').forEach(entry => {
      // Daily crons end with "* * *" (any day-of-month, any month, any day-of-week)
      expect(entry.cron).toMatch(/\* \* \*$/);
    });
  });

  test('NT-LAUNDRY fires Friday only (cron day-of-week = 5)', () => {
    const laundry = SCHEDULE.find(e => e.id === 'NT-LAUNDRY');
    expect(laundry.cron).toMatch(/5$/);
    expect(laundry.cron).not.toMatch(/\*$/);
  });

  test('no messages scheduled after 22:30', () => {
    SCHEDULE.forEach(entry => {
      const [, min, hr] = entry.cron.split(' ');
      const totalMin = parseInt(hr) * 60 + parseInt(min);
      expect(totalMin).toBeLessThanOrEqual(22 * 60 + 30);
    });
  });
});

// ─── Message content ──────────────────────────────────────────────────────────

describe('message content', () => {
  test('NT-001 mentions dumbbell workout', () => {
    const msg = SCHEDULE.find(e => e.id === 'NT-001').getMessage();
    expect(msg.toLowerCase()).toContain('dumbbell');
  });

  test('NT-002 mentions shower', () => {
    const msg = SCHEDULE.find(e => e.id === 'NT-002').getMessage();
    expect(msg.toLowerCase()).toContain('shower');
  });

  test('NT-003 mentions brush teeth', () => {
    const msg = SCHEDULE.find(e => e.id === 'NT-003').getMessage();
    expect(msg.toLowerCase()).toContain('brush your teeth');
  });

  test('NT-004 mentions tidy', () => {
    const msg = SCHEDULE.find(e => e.id === 'NT-004').getMessage();
    expect(msg.toLowerCase()).toContain('tidy');
  });

  test('NT-LAUNDRY mentions dirty clothes and laundry', () => {
    const msg = SCHEDULE.find(e => e.id === 'NT-LAUNDRY').getMessage();
    expect(msg.toLowerCase()).toContain('dirty clothes');
    expect(msg.toLowerCase()).toContain('laundry');
  });

  test('NT-005 mentions phone down', () => {
    const msg = SCHEDULE.find(e => e.id === 'NT-005').getMessage();
    expect(msg.toLowerCase()).toContain('phone down');
  });

  test('NT-006 is warm and positive (mentions name and rest)', () => {
    const msg = SCHEDULE.find(e => e.id === 'NT-006').getMessage();
    expect(msg).toContain('Taegan');
    expect(msg.toLowerCase()).toContain('rest');
  });
});

// ─── NT-005: Mandatory escalation ────────────────────────────────────────────

describe('NT-005 mandatory escalation', () => {
  test('NT-005 has mandatoryEscalation: true', () => {
    const nt005 = SCHEDULE.find(e => e.id === 'NT-005');
    expect(nt005.mandatoryEscalation).toBe(true);
  });

  test('fire() for NT-005 does NOT call arm()', () => {
    const nt005 = SCHEDULE.find(e => e.id === 'NT-005');
    fire(nt005, BASE_CONFIG);
    expect(arm).not.toHaveBeenCalled();
  });

  test('fire() for NT-005 calls runEscalation after 5 minutes', () => {
    const nt005 = SCHEDULE.find(e => e.id === 'NT-005');
    fire(nt005, BASE_CONFIG);
    expect(runEscalation).not.toHaveBeenCalled();

    jest.advanceTimersByTime(5 * 60 * 1000);
    expect(runEscalation).toHaveBeenCalledWith({
      step: 'NT-005',
      message: expect.stringContaining('phone down'),
    });
  });

  test('NT-005 escalation fires even if called twice (no cancellation path)', () => {
    const nt005 = SCHEDULE.find(e => e.id === 'NT-005');
    fire(nt005, BASE_CONFIG);
    fire(nt005, BASE_CONFIG);
    jest.advanceTimersByTime(5 * 60 * 1000);
    expect(runEscalation).toHaveBeenCalledTimes(2);
  });
});

// ─── Normal entries: arm() not runEscalation ─────────────────────────────────

describe('normal escalation for non-mandatory entries', () => {
  test('fire() for NT-001 calls arm(), not runEscalation', () => {
    const nt001 = SCHEDULE.find(e => e.id === 'NT-001');
    fire(nt001, BASE_CONFIG);
    expect(arm).toHaveBeenCalledWith(
      expect.stringContaining('NT-001'),
      expect.any(String),
      'NT-001'
    );
    jest.advanceTimersByTime(5 * 60 * 1000);
    expect(runEscalation).not.toHaveBeenCalled();
  });

  test('every non-NT-005 entry calls sendMessage and arm', () => {
    SCHEDULE.filter(e => !e.mandatoryEscalation).forEach(entry => {
      jest.clearAllMocks();
      fire(entry, BASE_CONFIG);
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(arm).toHaveBeenCalledTimes(1);
      expect(runEscalation).not.toHaveBeenCalled();
    });
  });
});
