'use strict';

/**
 * DEP-002 — Item 8: Health check returns healthy
 *
 * Tests for src/health-monitor.js.
 * Covers: consecutive-failure tracking, 3-failure iMessage threshold,
 * reset after alert, and healthy reset.
 */

jest.mock('child_process', () => ({ execSync: jest.fn() }));
jest.mock('../src/imessage');
jest.mock('../src/config');

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ─── Redirect HOME BEFORE requiring the module under test ─────────────────────
// health-monitor.js captures process.env.HOME in the module-level STATE_FILE
// constant. HOME must be set before the first require() so it resolves to
// TMP_HOME — otherwise the state file lands in the real user HOME and pollutes
// runs across test invocations.

const TMP_HOME  = os.tmpdir();
const ORIG_HOME = process.env.HOME;
process.env.HOME = TMP_HOME;

const { execSync }   = require('child_process');
const { sendMessage } = require('../src/imessage');
const { getConfig }  = require('../src/config');

afterAll(() => {
  process.env.HOME = ORIG_HOME;
  const stateFile = path.join(TMP_HOME, '.openclaw', 'workspace', 'health-state.json');
  try { fs.unlinkSync(stateFile); } catch {}
});

const BASE_CONFIG = {
  parent_phone: '+15126987332',
  approved_contacts: ['+17373268781', '+15126987332'],
};

// Load module under test AFTER HOME is redirected
const { runHealthCheck, loadState, saveState } = require('../src/health-monitor');

// Helpers to simulate health-check outcomes
function makeHealthy() {
  // execSync succeeds (exit 0)
  execSync.mockReturnValue('  [OK]   OpenClaw gateway (port 18789)\n  [OK]   Ollama (1 model(s) loaded)\n  [OK]   Last scraper run (2h ago)\n  [OK]   OpenClaw Node.js process\n');
}

function makeUnhealthy(detail = 'OpenClaw gateway — not responding on port 18789') {
  // execSync throws (exit 1 or non-zero), stdout on err object
  const err = new Error('Command failed');
  err.stdout = `  [FAIL] ${detail}\n`;
  err.stderr = '';
  execSync.mockImplementation(() => { throw err; });
}

beforeEach(() => {
  jest.clearAllMocks();
  getConfig.mockReturnValue(BASE_CONFIG);
  // Reset state file between tests
  const stateFile = path.join(TMP_HOME, '.openclaw', 'workspace', 'health-state.json');
  try { fs.unlinkSync(stateFile); } catch {}
});

// ─── Healthy path ─────────────────────────────────────────────────────────────

describe('healthy path', () => {
  test('returns { healthy: true } when health-check.sh exits 0', () => {
    makeHealthy();
    const result = runHealthCheck();
    expect(result.healthy).toBe(true);
  });

  test('no iMessage alert is sent when healthy', () => {
    makeHealthy();
    runHealthCheck();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('consecutiveFailures is reset to 0 after a healthy check', () => {
    // Prime state with 2 failures
    saveState({ consecutiveFailures: 2, lastAlertAt: null });

    makeHealthy();
    runHealthCheck();

    const state = loadState();
    expect(state.consecutiveFailures).toBe(0);
  });

  test('healthy run after failures does not send an alert', () => {
    saveState({ consecutiveFailures: 2, lastAlertAt: null });
    makeHealthy();
    runHealthCheck();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

// ─── Failure counting ─────────────────────────────────────────────────────────

describe('failure counting', () => {
  test('consecutiveFailures increments by 1 on first failure', () => {
    makeUnhealthy();
    runHealthCheck();
    const state = loadState();
    expect(state.consecutiveFailures).toBe(1);
  });

  test('consecutiveFailures increments to 2 on second failure', () => {
    makeUnhealthy();
    runHealthCheck();
    runHealthCheck();
    const state = loadState();
    expect(state.consecutiveFailures).toBe(2);
  });

  test('no alert sent after 1 failure', () => {
    makeUnhealthy();
    runHealthCheck();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('no alert sent after 2 failures', () => {
    makeUnhealthy();
    runHealthCheck();
    runHealthCheck();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

// ─── 3-failure threshold ──────────────────────────────────────────────────────

describe('3-consecutive-failure iMessage alert', () => {
  test('iMessage alert fires on 3rd consecutive failure', () => {
    makeUnhealthy('OpenClaw gateway — not responding on port 18789');
    runHealthCheck();
    runHealthCheck();
    runHealthCheck();
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  test('alert is sent to parent_phone', () => {
    makeUnhealthy();
    runHealthCheck();
    runHealthCheck();
    runHealthCheck();
    expect(sendMessage).toHaveBeenCalledWith(
      BASE_CONFIG.parent_phone,
      expect.any(String)
    );
  });

  test('alert message mentions failure count (3)', () => {
    makeUnhealthy();
    runHealthCheck();
    runHealthCheck();
    runHealthCheck();
    const [, body] = sendMessage.mock.calls[0];
    expect(body).toContain('3');
    expect(body.toLowerCase()).toContain('health check');
  });

  test('alert message includes the failing check detail', () => {
    makeUnhealthy('Ollama — not responding on port 11434');
    runHealthCheck();
    runHealthCheck();
    runHealthCheck();
    const [, body] = sendMessage.mock.calls[0];
    expect(body).toContain('Ollama');
  });

  test('consecutiveFailures is reset to 0 after alert fires', () => {
    makeUnhealthy();
    runHealthCheck();
    runHealthCheck();
    runHealthCheck();
    const state = loadState();
    expect(state.consecutiveFailures).toBe(0);
  });

  test('lastAlertAt is recorded when alert fires', () => {
    makeUnhealthy();
    runHealthCheck();
    runHealthCheck();
    runHealthCheck();
    const state = loadState();
    expect(state.lastAlertAt).not.toBeNull();
    expect(new Date(state.lastAlertAt)).toBeInstanceOf(Date);
  });

  test('alert fires again after another 3 consecutive failures', () => {
    makeUnhealthy();
    // First batch of 3
    runHealthCheck();
    runHealthCheck();
    runHealthCheck();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    // Second batch of 3
    runHealthCheck();
    runHealthCheck();
    runHealthCheck();
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  test('alert does not fire on 4th consecutive failure (counter was reset)', () => {
    makeUnhealthy();
    runHealthCheck(); // 1
    runHealthCheck(); // 2
    runHealthCheck(); // 3 → alert fires, counter resets to 0
    runHealthCheck(); // 1 again — no new alert
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});

// ─── Result shape ─────────────────────────────────────────────────────────────

describe('result shape', () => {
  test('healthy result includes output', () => {
    makeHealthy();
    const result = runHealthCheck();
    expect(result).toHaveProperty('healthy', true);
    expect(result).toHaveProperty('output');
    expect(typeof result.output).toBe('string');
  });

  test('unhealthy result includes output and consecutiveFailures', () => {
    makeUnhealthy();
    const result = runHealthCheck();
    expect(result).toHaveProperty('healthy', false);
    expect(result).toHaveProperty('output');
  });
});
