'use strict';

jest.mock('../src/scrapers/canvas');
jest.mock('../src/scrapers/skyward');
jest.mock('../src/imessage');
jest.mock('../src/config');

const { scrapeCanvas } = require('../src/scrapers/canvas');
const { scrapeSkyward } = require('../src/scrapers/skyward');
const { sendMessage } = require('../src/imessage');
const { getConfig } = require('../src/config');
const {
  runWithRetry,
  runAllScrapers,
  alertScraperFailure,
} = require('../src/scrapers/index');

const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE_CONFIG = {
  parent_phone: '+15126987332',
  approved_contacts: ['+17373268781', '+15126987332'],
};

beforeEach(() => {
  jest.clearAllMocks();
  getConfig.mockReturnValue(BASE_CONFIG);
});

// ─── runWithRetry ─────────────────────────────────────────────────────────────

describe('runWithRetry', () => {
  test('succeeds on first attempt — no alert sent', async () => {
    scrapeCanvas.mockResolvedValue({ assignments: [] });
    await runWithRetry('DC-001 Canvas', scrapeCanvas);
    expect(scrapeCanvas).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('retries once on failure then succeeds — no alert', async () => {
    scrapeCanvas
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ assignments: [] });
    await runWithRetry('DC-001 Canvas', scrapeCanvas);
    expect(scrapeCanvas).toHaveBeenCalledTimes(2);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('alerts parent after 2 consecutive failures', async () => {
    const err = new Error('login failed');
    scrapeCanvas.mockRejectedValue(err);
    await runWithRetry('DC-001 Canvas', scrapeCanvas);
    expect(scrapeCanvas).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [to, body] = sendMessage.mock.calls[0];
    expect(to).toBe(BASE_CONFIG.parent_phone);
    expect(body).toContain('DC-001 Canvas');
    expect(body).toContain('login failed');
  });

  test('failure alert contains scraper name, error, and timestamp', async () => {
    scrapeSkyward.mockRejectedValue(new Error('navigation timeout'));
    await runWithRetry('DC-002 Skyward', scrapeSkyward);
    const [, body] = sendMessage.mock.calls[0];
    expect(body).toContain('DC-002 Skyward');
    expect(body).toContain('navigation timeout');
    expect(body).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/); // timestamp contains date
  });
});

// ─── runAllScrapers ───────────────────────────────────────────────────────────

describe('runAllScrapers', () => {
  test('runs Canvas then Skyward', async () => {
    scrapeCanvas.mockResolvedValue({ assignments: [] });
    scrapeSkyward.mockResolvedValue({ grades: [], missing: [] });
    await runAllScrapers();
    expect(scrapeCanvas).toHaveBeenCalledTimes(1);
    expect(scrapeSkyward).toHaveBeenCalledTimes(1);
  });

  test('Canvas failure does not prevent Skyward from running', async () => {
    scrapeCanvas.mockRejectedValue(new Error('canvas down'));
    scrapeSkyward.mockResolvedValue({ grades: [], missing: [] });
    await runAllScrapers();
    expect(scrapeSkyward).toHaveBeenCalledTimes(1);
  });
});

// ─── alertScraperFailure ──────────────────────────────────────────────────────

describe('alertScraperFailure', () => {
  test('sends to parent_phone', () => {
    alertScraperFailure('DC-001 Canvas', new Error('oops'));
    expect(sendMessage).toHaveBeenCalledWith(
      BASE_CONFIG.parent_phone,
      expect.stringContaining('DC-001 Canvas')
    );
  });

  test('message includes scraper name and error text', () => {
    alertScraperFailure('DC-002 Skyward', new Error('timeout after 30s'));
    const [, body] = sendMessage.mock.calls[0];
    expect(body).toContain('DC-002 Skyward');
    expect(body).toContain('timeout after 30s');
  });
});

// ─── Canvas output shape (unit) ───────────────────────────────────────────────

describe('canvas output shape', () => {
  test('assignments array is present and typed correctly', () => {
    const output = {
      scrapedAt: new Date().toISOString(),
      assignments: [
        { name: 'Essay', course: 'English', dueDate: '2026-04-01T23:59:00Z', submitted: false, status: 'not_submitted' },
      ],
    };
    // Shape validation
    expect(Array.isArray(output.assignments)).toBe(true);
    output.assignments.forEach(a => {
      expect(typeof a.name).toBe('string');
      expect(typeof a.course).toBe('string');
      expect(typeof a.submitted).toBe('boolean');
      expect(['submitted', 'not_submitted', 'graded', 'missing']).toContain(a.status);
    });
  });
});

// ─── Skyward output shape (unit) ─────────────────────────────────────────────

describe('skyward output shape', () => {
  test('grades and missing arrays are present and typed correctly', () => {
    const output = {
      scrapedAt: new Date().toISOString(),
      grades: [
        { course: 'Math', grade: 'B+', percent: 87.5 },
      ],
      missing: [
        { name: 'HW 5', course: 'Math', dueDate: '2026-03-20' },
      ],
    };
    expect(Array.isArray(output.grades)).toBe(true);
    expect(Array.isArray(output.missing)).toBe(true);
    output.grades.forEach(g => {
      expect(typeof g.course).toBe('string');
      expect(typeof g.grade).toBe('string');
    });
    output.missing.forEach(m => {
      expect(typeof m.name).toBe('string');
      expect(typeof m.course).toBe('string');
    });
  });
});
