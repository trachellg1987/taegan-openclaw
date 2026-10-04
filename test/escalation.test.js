'use strict';

jest.mock('../src/escalation/call');
jest.mock('../src/imessage');
jest.mock('../src/config');

const { escalateCall } = require('../src/escalation/call');
const { sendMessage } = require('../src/imessage');
const { getConfig } = require('../src/config');
const { appendToLog, readLog, alertParent } = require('../src/escalation/alert');
const { startTimer, cancelTimer, _activeCount } = require('../src/escalation/timer');

const fs = require('fs');
const path = require('path');
const os = require('os');

// Point state file to a temp location for tests
const TMP_STATE = path.join(os.tmpdir(), `esc-state-${Date.now()}.json`);
const TMP_LOG = path.join(os.tmpdir(), `esc-log-${Date.now()}.json`);

beforeAll(() => {
  process.env.HOME = os.tmpdir();
  getConfig.mockReturnValue({
    parent_phone: '+15126987332',
    approved_contacts: ['+17373268781', '+15126987332'],
  });
});

afterEach(() => {
  jest.clearAllMocks();
  [TMP_STATE, TMP_LOG].forEach(f => { try { fs.unlinkSync(f); } catch {} });
});

// ─── ESC-001: Timer ───────────────────────────────────────────────────────────

describe('ESC-001: timer', () => {
  test('cancelTimer prevents escalation callback', (done) => {
    jest.useFakeTimers();
    const onEscalate = jest.fn();

    startTimer('test-1', 'Wake up!', 'MR-001', onEscalate);
    cancelTimer('test-1');

    jest.advanceTimersByTime(6 * 60 * 1000);
    expect(onEscalate).not.toHaveBeenCalled();

    jest.useRealTimers();
    done();
  });

  test('escalation fires after 5 minutes if not cancelled', (done) => {
    jest.useFakeTimers();
    const onEscalate = jest.fn();

    startTimer('test-2', 'Wake up!', 'MR-001', onEscalate);
    jest.advanceTimersByTime(5 * 60 * 1000 + 100);

    expect(onEscalate).toHaveBeenCalledWith({
      id: 'test-2',
      step: 'MR-001',
      message: 'Wake up!',
    });

    jest.useRealTimers();
    done();
  });
});

// ─── ESC-003: Parent alert ────────────────────────────────────────────────────

describe('ESC-003: parent alert', () => {
  test('sends iMessage to parent with step and message', () => {
    alertParent('MR-001', 'Good morning Taegan!');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [to, body] = sendMessage.mock.calls[0];
    expect(to).toBe('+15126987332');
    expect(body).toContain('MR-001');
    expect(body).toContain('Good morning Taegan!');
  });
});

// ─── ESC-004: Escalation log ─────────────────────────────────────────────────

describe('ESC-004: escalation log', () => {
  test('log is append-only and parseable', () => {
    appendToLog({ event: 'TEST_A', step: 'MR-001' });
    appendToLog({ event: 'TEST_B', step: 'MR-002' });
    const entries = readLog();
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries.some(e => e.event === 'TEST_A')).toBe(true);
    expect(entries.every(e => e.ts)).toBe(true); // every entry has timestamp
  });
});
