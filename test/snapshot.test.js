'use strict';

/**
 * DEP-002 — Item 9: Snapshot saves and compares correctly
 *
 * Tests for src/scrapers/snapshot.js (DC-005).
 * Covers: save, compare new-missing alert, prune, and full cycle.
 */

jest.mock('../src/imessage');
jest.mock('../src/config');

const path = require('path');
const os   = require('os');

// ─── Redirect HOME to a temp directory BEFORE requiring the module under test ─
// snapshot.js captures process.env.HOME in module-level constants, so HOME must
// be set before the first require() so those constants resolve to TMP_HOME.

const TMP_HOME  = os.tmpdir();
const ORIG_HOME = process.env.HOME;
process.env.HOME = TMP_HOME;

const { sendMessage } = require('../src/imessage');
const { getConfig } = require('../src/config');

afterAll(() => {
  process.env.HOME = ORIG_HOME;
});

// Load module AFTER HOME is redirected so all paths resolve to TMP_HOME
const {
  saveSnapshot,
  compareAndAlert,
  pruneSnapshots,
  runSnapshotCycle,
  todayKey,
  yesterdayKey,
  snapshotPath,
} = require('../src/scrapers/snapshot');

const fs = require('fs');

const WORKSPACE     = path.join(TMP_HOME, '.openclaw', 'workspace');
const CANVAS_FILE   = path.join(WORKSPACE, 'canvas-data.json');
const SKYWARD_FILE  = path.join(WORKSPACE, 'skyward-data.json');
const SNAPSHOTS_DIR = path.join(WORKSPACE, 'snapshots');

const BASE_CONFIG = {
  parent_phone: '+15126987332',
  approved_contacts: ['+17373268781', '+15126987332'],
};

// ─── Test data helpers ────────────────────────────────────────────────────────

function makeCanvas(assignments = []) {
  return JSON.stringify({ scrapedAt: new Date().toISOString(), assignments });
}

function makeSkyward(grades = [], missing = []) {
  return JSON.stringify({ scrapedAt: new Date().toISOString(), grades, missing });
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  getConfig.mockReturnValue(BASE_CONFIG);

  // Ensure workspace and snapshots directories exist
  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });

  // Clean up snapshot files from previous tests
  for (const f of fs.readdirSync(SNAPSHOTS_DIR)) {
    fs.unlinkSync(path.join(SNAPSHOTS_DIR, f));
  }

  // Clean up source data files
  for (const f of [CANVAS_FILE, SKYWARD_FILE]) {
    try { fs.unlinkSync(f); } catch {}
  }
});

// ─── saveSnapshot ─────────────────────────────────────────────────────────────

describe('saveSnapshot', () => {
  test('creates snapshots directory if it does not exist', () => {
    // Remove the dir first
    fs.rmSync(SNAPSHOTS_DIR, { recursive: true, force: true });
    fs.writeFileSync(CANVAS_FILE, makeCanvas());
    expect(() => saveSnapshot()).not.toThrow();
    expect(fs.existsSync(SNAPSHOTS_DIR)).toBe(true);
  });

  test('canvas snapshot file is created at the correct path', () => {
    fs.writeFileSync(CANVAS_FILE, makeCanvas([{ name: 'Essay', course: 'English', dueDate: null, submitted: false, status: 'not_submitted' }]));
    saveSnapshot();

    const dest = snapshotPath('canvas', todayKey());
    expect(fs.existsSync(dest)).toBe(true);
  });

  test('skyward snapshot file is created at the correct path', () => {
    fs.writeFileSync(SKYWARD_FILE, makeSkyward([], [{ name: 'HW 1', course: 'Math' }]));
    saveSnapshot();

    const dest = snapshotPath('skyward', todayKey());
    expect(fs.existsSync(dest)).toBe(true);
  });

  test('snapshot file content matches source data', () => {
    const canvasData = makeCanvas([{ name: 'Unit Test', course: 'CS', dueDate: null, submitted: false, status: 'not_submitted' }]);
    fs.writeFileSync(CANVAS_FILE, canvasData);
    saveSnapshot();

    const snap = fs.readFileSync(snapshotPath('canvas', todayKey()), 'utf8');
    expect(JSON.parse(snap)).toEqual(JSON.parse(canvasData));
  });

  test('skips gracefully when source file does not exist (no throw)', () => {
    expect(() => saveSnapshot()).not.toThrow();
  });

  test('overwriting today\'s snapshot on a second call keeps latest data', () => {
    const v1 = makeSkyward([], [{ name: 'Old HW', course: 'Math' }]);
    const v2 = makeSkyward([], [{ name: 'New HW', course: 'Math' }]);

    fs.writeFileSync(SKYWARD_FILE, v1);
    saveSnapshot();
    fs.writeFileSync(SKYWARD_FILE, v2);
    saveSnapshot();

    const snap = JSON.parse(fs.readFileSync(snapshotPath('skyward', todayKey()), 'utf8'));
    expect(snap.missing[0].name).toBe('New HW');
  });
});

// ─── compareAndAlert ──────────────────────────────────────────────────────────

describe('compareAndAlert', () => {
  test('no alert when today has no missing assignments', () => {
    fs.writeFileSync(snapshotPath('skyward', todayKey()), makeSkyward([], []));
    compareAndAlert();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('no alert when all missing assignments also appeared yesterday', () => {
    const missing = [{ name: 'HW 1', course: 'Math' }];
    fs.writeFileSync(snapshotPath('skyward', yesterdayKey()), makeSkyward([], missing));
    fs.writeFileSync(snapshotPath('skyward', todayKey()), makeSkyward([], missing));
    compareAndAlert();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('alert fires for a missing assignment that is new today', () => {
    fs.writeFileSync(snapshotPath('skyward', yesterdayKey()), makeSkyward([], []));
    fs.writeFileSync(snapshotPath('skyward', todayKey()), makeSkyward([], [
      { name: 'Algebra HW 7', course: 'Math' },
    ]));
    compareAndAlert();
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  test('alert is sent to parent_phone', () => {
    fs.writeFileSync(snapshotPath('skyward', todayKey()), makeSkyward([], [
      { name: 'Vocab Quiz', course: 'English' },
    ]));
    compareAndAlert();
    expect(sendMessage).toHaveBeenCalledWith(
      BASE_CONFIG.parent_phone,
      expect.any(String)
    );
  });

  test('alert message lists the new missing assignment name', () => {
    fs.writeFileSync(snapshotPath('skyward', yesterdayKey()), makeSkyward([], []));
    fs.writeFileSync(snapshotPath('skyward', todayKey()), makeSkyward([], [
      { name: 'Chapter 5 Worksheet', course: 'Science' },
    ]));
    compareAndAlert();
    const [, body] = sendMessage.mock.calls[0];
    expect(body).toContain('Chapter 5 Worksheet');
  });

  test('alert fires once even when multiple new assignments appear', () => {
    fs.writeFileSync(snapshotPath('skyward', yesterdayKey()), makeSkyward([], []));
    fs.writeFileSync(snapshotPath('skyward', todayKey()), makeSkyward([], [
      { name: 'HW A', course: 'Math' },
      { name: 'HW B', course: 'Science' },
      { name: 'HW C', course: 'History' },
    ]));
    compareAndAlert();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [, body] = sendMessage.mock.calls[0];
    expect(body).toContain('HW A');
    expect(body).toContain('HW B');
    expect(body).toContain('HW C');
  });

  test('only new assignments appear in alert (existing ones omitted)', () => {
    fs.writeFileSync(snapshotPath('skyward', yesterdayKey()), makeSkyward([], [
      { name: 'Old HW', course: 'Math' },
    ]));
    fs.writeFileSync(snapshotPath('skyward', todayKey()), makeSkyward([], [
      { name: 'Old HW', course: 'Math' },
      { name: 'New HW', course: 'Science' },
    ]));
    compareAndAlert();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [, body] = sendMessage.mock.calls[0];
    expect(body).toContain('New HW');
    expect(body).not.toContain('Old HW');
  });

  test('no alert when today skyward snapshot is missing', () => {
    // No snapshot files at all
    expect(() => compareAndAlert()).not.toThrow();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('treats first-day run (no yesterday snapshot) as all-new and alerts', () => {
    // No yesterday snapshot — all today's missing are "new"
    fs.writeFileSync(snapshotPath('skyward', todayKey()), makeSkyward([], [
      { name: 'Brand New HW', course: 'English' },
    ]));
    compareAndAlert();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [, body] = sendMessage.mock.calls[0];
    expect(body).toContain('Brand New HW');
  });
});

// ─── pruneSnapshots ───────────────────────────────────────────────────────────

describe('pruneSnapshots', () => {
  test('does not throw when snapshots directory is empty', () => {
    expect(() => pruneSnapshots()).not.toThrow();
  });

  test('files newer than 30 days are NOT deleted', () => {
    const recentKey = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10); // 5 days ago
    const filePath = snapshotPath('canvas', recentKey);
    fs.writeFileSync(filePath, makeCanvas());

    pruneSnapshots();

    expect(fs.existsSync(filePath)).toBe(true);
  });

  test('files older than 30 days ARE deleted', () => {
    const oldKey = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10); // 35 days ago
    const filePath = snapshotPath('canvas', oldKey);
    fs.writeFileSync(filePath, makeCanvas());

    pruneSnapshots();

    expect(fs.existsSync(filePath)).toBe(false);
  });

  test('files exactly 31 days old ARE deleted', () => {
    const oldKey = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    const filePath = snapshotPath('skyward', oldKey);
    fs.writeFileSync(filePath, makeSkyward());

    pruneSnapshots();

    expect(fs.existsSync(filePath)).toBe(false);
  });

  test('non-snapshot files in the directory are left alone', () => {
    const weirdFile = path.join(SNAPSHOTS_DIR, 'README.txt');
    fs.writeFileSync(weirdFile, 'not a snapshot');

    pruneSnapshots();

    expect(fs.existsSync(weirdFile)).toBe(true);
    fs.unlinkSync(weirdFile); // clean up
  });

  test('only old files are deleted, recent ones preserved', () => {
    const oldKey    = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const recentKey = new Date(Date.now() - 5  * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const oldFile    = snapshotPath('canvas', oldKey);
    const recentFile = snapshotPath('canvas', recentKey);

    fs.writeFileSync(oldFile,    makeCanvas());
    fs.writeFileSync(recentFile, makeCanvas());

    pruneSnapshots();

    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(recentFile)).toBe(true);
  });
});

// ─── runSnapshotCycle ─────────────────────────────────────────────────────────

describe('runSnapshotCycle', () => {
  test('completes without throwing even with no source data', () => {
    expect(() => runSnapshotCycle()).not.toThrow();
  });

  test('saves snapshot AND runs compare in a single cycle', () => {
    // Set up source data
    fs.writeFileSync(SKYWARD_FILE, makeSkyward([], [{ name: 'Cycle Test HW', course: 'Math' }]));

    // No yesterday snapshot → new missing alert fires
    runSnapshotCycle();

    // Snapshot was saved
    expect(fs.existsSync(snapshotPath('skyward', todayKey()))).toBe(true);
    // Alert was sent
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [, body] = sendMessage.mock.calls[0];
    expect(body).toContain('Cycle Test HW');
  });
});

// ─── Date helpers ─────────────────────────────────────────────────────────────

describe('date helpers', () => {
  test('todayKey returns YYYY-MM-DD format', () => {
    expect(todayKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('yesterdayKey is one day before todayKey', () => {
    const today     = new Date(todayKey());
    const yesterday = new Date(yesterdayKey());
    const diffDays  = (today - yesterday) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBe(1);
  });

  test('snapshotPath builds correct path for canvas', () => {
    const p = snapshotPath('canvas', '2026-03-31');
    expect(p).toContain('canvas-2026-03-31.json');
    expect(p).toContain('snapshots');
  });

  test('snapshotPath builds correct path for skyward', () => {
    const p = snapshotPath('skyward', '2026-03-31');
    expect(p).toContain('skyward-2026-03-31.json');
  });
});
