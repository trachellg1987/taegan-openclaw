'use strict';

jest.mock('../src/imessage');
jest.mock('../src/config');
jest.mock('fs');

const { sendMessage } = require('../src/imessage');
const { getConfig } = require('../src/config');
const fs = require('fs');

const {
  buildNightlySummary,
  checkMissingThreshold,
  checkGradeAlerts,
  checkUpcomingDeadlines,
  buildScraperFailureMessage,
  isCooledDown,
  markAlertFired,
  _resetAlertState,
  runRealTimeAlerts,
} = require('../src/dashboard/index');

const PARENT = '+15126987332';
const TAEGAN = '+17373268781';

const BASE_CONFIG = {
  taegan_phone: TAEGAN,
  parent_phone: PARENT,
  approved_contacts: [TAEGAN, PARENT],
};

// Minimal scraper data fixtures
function makeCanvas(assignments = []) {
  return JSON.stringify({ scrapedAt: new Date().toISOString(), assignments });
}

function makeSkyward(grades = [], missing = []) {
  return JSON.stringify({ scrapedAt: new Date().toISOString(), grades, missing });
}

// Future date helpers
function hoursFromNow(h) {
  return new Date(Date.now() + h * 60 * 60 * 1000).toISOString();
}
function daysFromNow(d) { return hoursFromNow(d * 24); }

beforeEach(() => {
  jest.clearAllMocks();
  getConfig.mockReturnValue(BASE_CONFIG);
  // Default: all file reads throw (no data)
  fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
  fs.existsSync.mockReturnValue(false);
  fs.mkdirSync.mockImplementation(() => {});
  fs.writeFileSync.mockImplementation(() => {});
  fs.appendFileSync.mockImplementation(() => {});
  fs.unlinkSync.mockImplementation(() => {});
});

// ─── PD-001: Nightly summary ──────────────────────────────────────────────────

describe('PD-001 buildNightlySummary', () => {
  test('returns a string with a date header', () => {
    const msg = buildNightlySummary();
    expect(typeof msg).toBe('string');
    expect(msg).toMatch(/Taegan's Day/);
  });

  test('is under 10 lines', () => {
    const msg = buildNightlySummary();
    expect(msg.split('\n').length).toBeLessThanOrEqual(10);
  });

  test('includes missing count when skyward data available', () => {
    fs.readFileSync.mockImplementation((p) => {
      if (p.includes('skyward')) return makeSkyward([], [{ name: 'HW 1', course: 'Math', dueDate: null }]);
      throw new Error('ENOENT');
    });
    const msg = buildNightlySummary();
    expect(msg).toContain('1 assignment');
  });

  test('shows "All caught up!" when 0 missing', () => {
    fs.readFileSync.mockImplementation((p) => {
      if (p.includes('skyward')) return makeSkyward([], []);
      throw new Error('ENOENT');
    });
    const msg = buildNightlySummary();
    expect(msg).toContain('All caught up');
  });

  test('includes grade alert when grade below 80%', () => {
    fs.readFileSync.mockImplementation((p) => {
      if (p.includes('skyward')) return makeSkyward([{ course: 'Math', grade: 'D', percent: 65 }], []);
      throw new Error('ENOENT');
    });
    const msg = buildNightlySummary();
    expect(msg).toContain('Math');
    expect(msg).toContain('65%');
  });

  test('shows "All passing" when all grades >= 80%', () => {
    fs.readFileSync.mockImplementation((p) => {
      if (p.includes('skyward')) return makeSkyward([{ course: 'Math', grade: 'A', percent: 95 }], []);
      throw new Error('ENOENT');
    });
    const msg = buildNightlySummary();
    expect(msg).toContain('All passing');
  });

  test('includes upcoming deadline within 48h', () => {
    fs.readFileSync.mockImplementation((p) => {
      if (p.includes('canvas')) return makeCanvas([
        { name: 'History Essay', course: 'History', dueDate: hoursFromNow(24), submitted: false, status: 'not_submitted' },
      ]);
      throw new Error('ENOENT');
    });
    const msg = buildNightlySummary();
    expect(msg).toContain('History Essay');
  });

  test('ends with a warm closing line', () => {
    const msg = buildNightlySummary();
    expect(msg).toContain('good night');
  });
});

// ─── PD-002: Missing threshold ────────────────────────────────────────────────

describe('PD-002 checkMissingThreshold', () => {
  beforeEach(() => {
    // No alert state — all cooled down
    fs.readFileSync.mockImplementation((p) => {
      if (p.includes('alert-state')) return '{}';
      throw new Error('ENOENT');
    });
  });

  test('no alert when fewer than 3 missing', () => {
    fs.readFileSync.mockImplementation((p) => {
      if (p.includes('skyward')) return makeSkyward([], [{ name: 'A' }, { name: 'B' }]);
      if (p.includes('alert-state')) return '{}';
      throw new Error('ENOENT');
    });
    checkMissingThreshold();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('alert fires when 3 or more missing', () => {
    fs.readFileSync.mockImplementation((p) => {
      if (p.includes('skyward')) return makeSkyward([], [
        { name: 'A' }, { name: 'B' }, { name: 'C' },
      ]);
      if (p.includes('alert-state')) return '{}';
      throw new Error('ENOENT');
    });
    checkMissingThreshold();
    expect(sendMessage).toHaveBeenCalledWith(PARENT, expect.stringContaining('3 missing'));
  });

  test('alert fires at exactly 3 missing', () => {
    fs.readFileSync.mockImplementation((p) => {
      if (p.includes('skyward')) return makeSkyward([], [
        { name: 'A' }, { name: 'B' }, { name: 'C' },
      ]);
      if (p.includes('alert-state')) return '{}';
      throw new Error('ENOENT');
    });
    checkMissingThreshold();
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});

// ─── PD-002: Grade alerts ─────────────────────────────────────────────────────

describe('PD-002 checkGradeAlerts', () => {
  beforeEach(() => {
    fs.readFileSync.mockImplementation((p) => {
      if (p.includes('alert-state')) return '{}';
      throw new Error('ENOENT');
    });
  });

  test('no alert when all grades >= 80%', () => {
    fs.readFileSync.mockImplementation((p) => {
      if (p.includes('skyward')) return makeSkyward([
        { course: 'Math', grade: 'B', percent: 85 },
        { course: 'English', grade: 'A', percent: 92 },
      ], []);
      if (p.includes('alert-state')) return '{}';
      throw new Error('ENOENT');
    });
    checkGradeAlerts();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('alert fires for grade below 80%', () => {
    fs.readFileSync.mockImplementation((p) => {
      if (p.includes('skyward')) return makeSkyward([
        { course: 'Math', grade: 'C', percent: 72 },
      ], []);
      if (p.includes('alert-state')) return '{}';
      throw new Error('ENOENT');
    });
    checkGradeAlerts();
    expect(sendMessage).toHaveBeenCalledWith(PARENT, expect.stringContaining('Math'));
    expect(sendMessage).toHaveBeenCalledWith(PARENT, expect.stringContaining('72%'));
  });

  test('alert fires for D/F grade without percent', () => {
    fs.readFileSync.mockImplementation((p) => {
      if (p.includes('skyward')) return makeSkyward([
        { course: 'History', grade: 'F', percent: null },
      ], []);
      if (p.includes('alert-state')) return '{}';
      throw new Error('ENOENT');
    });
    checkGradeAlerts();
    expect(sendMessage).toHaveBeenCalledWith(PARENT, expect.stringContaining('History'));
  });

  test('no duplicate alert within 24h cooldown', () => {
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
    fs.readFileSync.mockImplementation((p) => {
      if (p.includes('skyward')) return makeSkyward([{ course: 'Math', grade: 'D', percent: 65 }], []);
      if (p.includes('alert-state')) return JSON.stringify({ 'grade_below_B_Math': recent });
      throw new Error('ENOENT');
    });
    checkGradeAlerts();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

// ─── PD-002: Upcoming deadlines ───────────────────────────────────────────────

describe('PD-002 checkUpcomingDeadlines', () => {
  beforeEach(() => {
    fs.readFileSync.mockImplementation((p) => {
      if (p.includes('alert-state')) return '{}';
      throw new Error('ENOENT');
    });
  });

  test('alert fires for major assignment due within 48h', () => {
    fs.readFileSync.mockImplementation((p) => {
      if (p.includes('canvas')) return makeCanvas([
        { name: 'Research Project', course: 'Science', dueDate: hoursFromNow(20), submitted: false, status: 'not_submitted' },
      ]);
      if (p.includes('alert-state')) return '{}';
      throw new Error('ENOENT');
    });
    checkUpcomingDeadlines();
    expect(sendMessage).toHaveBeenCalledWith(PARENT, expect.stringContaining('Research Project'));
  });

  test('no alert for non-major assignment keyword', () => {
    fs.readFileSync.mockImplementation((p) => {
      if (p.includes('canvas')) return makeCanvas([
        { name: 'Homework 12', course: 'Math', dueDate: hoursFromNow(10), submitted: false, status: 'not_submitted' },
      ]);
      if (p.includes('alert-state')) return '{}';
      throw new Error('ENOENT');
    });
    checkUpcomingDeadlines();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('no alert for submitted major assignment', () => {
    fs.readFileSync.mockImplementation((p) => {
      if (p.includes('canvas')) return makeCanvas([
        { name: 'Final Exam', course: 'History', dueDate: hoursFromNow(10), submitted: true, status: 'submitted' },
      ]);
      if (p.includes('alert-state')) return '{}';
      throw new Error('ENOENT');
    });
    checkUpcomingDeadlines();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('no alert for major assignment due after 48h', () => {
    fs.readFileSync.mockImplementation((p) => {
      if (p.includes('canvas')) return makeCanvas([
        { name: 'Final Exam', course: 'History', dueDate: daysFromNow(5), submitted: false, status: 'not_submitted' },
      ]);
      if (p.includes('alert-state')) return '{}';
      throw new Error('ENOENT');
    });
    checkUpcomingDeadlines();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  const MAJOR_KEYWORDS = ['project', 'essay', 'research', 'presentation', 'exam', 'test', 'final', 'midterm', 'report', 'paper'];
  test.each(MAJOR_KEYWORDS)('"%s" keyword triggers alert', (keyword) => {
    fs.readFileSync.mockImplementation((p) => {
      if (p.includes('canvas')) return makeCanvas([
        { name: `Unit ${keyword}`, course: 'English', dueDate: hoursFromNow(10), submitted: false, status: 'not_submitted' },
      ]);
      if (p.includes('alert-state')) return '{}';
      throw new Error('ENOENT');
    });
    checkUpcomingDeadlines();
    expect(sendMessage).toHaveBeenCalled();
    jest.clearAllMocks();
  });
});

// ─── PD-003: Scraper failure message format ───────────────────────────────────

describe('PD-003 buildScraperFailureMessage', () => {
  test('contains scraper name and error message', () => {
    const msg = buildScraperFailureMessage('DC-001 Canvas', new Error('login timeout'));
    expect(msg).toContain('DC-001 Canvas');
    expect(msg).toContain('login timeout');
  });

  test('contains a timestamp', () => {
    const msg = buildScraperFailureMessage('DC-002 Skyward', new Error('oops'));
    expect(msg).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
  });
});

// ─── All real-time alerts go to parent_phone ──────────────────────────────────

describe('all alerts target parent_phone', () => {
  beforeEach(() => {
    fs.readFileSync.mockImplementation((p) => {
      if (p.includes('skyward')) return makeSkyward(
        [{ course: 'Math', grade: 'F', percent: 50 }],
        [{ name: 'A' }, { name: 'B' }, { name: 'C' }]
      );
      if (p.includes('canvas')) return makeCanvas([
        { name: 'Final Exam', course: 'Bio', dueDate: hoursFromNow(10), submitted: false, status: 'not_submitted' },
      ]);
      if (p.includes('alert-state')) return '{}';
      throw new Error('ENOENT');
    });
  });

  test('all sendMessage calls use parent_phone', () => {
    runRealTimeAlerts();
    sendMessage.mock.calls.forEach(([to]) => {
      expect(to).toBe(PARENT);
    });
  });
});
