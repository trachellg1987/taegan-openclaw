'use strict';

/**
 * Tests for src/scrapers/gmail.js (DC-003).
 * All external calls (Gmail API, iMessage) are mocked.
 * googleapis is mocked via a factory so the package need not be installed.
 */

jest.mock('../src/imessage');
jest.mock('../src/config');

// Factory mock with virtual:true — googleapis need not be installed.
// Jest skips module resolution entirely and uses the factory directly.
jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        setCredentials: jest.fn(),
      })),
    },
    gmail: jest.fn(),
  },
}), { virtual: true });

const path = require('path');
const fs   = require('fs');
const os   = require('os');

// ─── Redirect HOME BEFORE requiring the module ────────────────────────────────

const TMP_HOME  = os.tmpdir();
const ORIG_HOME = process.env.HOME;
process.env.HOME = TMP_HOME;

const { sendMessage } = require('../src/imessage');
const { getConfig }   = require('../src/config');
const { google }      = require('googleapis');

afterAll(() => {
  process.env.HOME = ORIG_HOME;
  const stateFile = path.join(TMP_HOME, '.openclaw', 'workspace', 'gmail-state.json');
  try { fs.unlinkSync(stateFile); } catch {}
});

// ─── Config fixtures ──────────────────────────────────────────────────────────

const BASE_CONFIG_WITH_GMAIL = {
  parent_phone: '+15126987332',
  env: {
    gmail_client_id:     'client-id-test',
    gmail_client_secret: 'client-secret-test',
    gmail_refresh_token: 'refresh-token-test',
  },
};

const BASE_CONFIG_NO_GMAIL = {
  parent_phone: '+15126987332',
  env: {
    gmail_client_id:     '',
    gmail_client_secret: '',
    gmail_refresh_token: '',
  },
};

// ─── Gmail API mock helpers ───────────────────────────────────────────────────

let mockMessagesList;
let mockMessagesGet;

function setupGmailMock() {
  mockMessagesList = jest.fn();
  mockMessagesGet  = jest.fn();

  const mockGmailClient = {
    users: {
      messages: {
        list: mockMessagesList,
        get:  mockMessagesGet,
      },
    },
  };

  // Reset OAuth2 constructor mock
  google.auth.OAuth2.mockImplementation(() => ({
    setCredentials: jest.fn(),
  }));

  // Return the mock Gmail client when google.gmail() is called
  google.gmail.mockReturnValue(mockGmailClient);
}

// ─── State file helpers ───────────────────────────────────────────────────────

const STATE_FILE = path.join(TMP_HOME, '.openclaw', 'workspace', 'gmail-state.json');

function clearStateFile() {
  try { fs.unlinkSync(STATE_FILE); } catch {}
}

// ─── Load module under test AFTER mocks and HOME redirect ────────────────────

const {
  pollGmail,
  buildSummary,
  parseMessage,
  classifyEmail,
  loadState,
  saveState,
} = require('../src/scrapers/gmail');

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  clearStateFile();
  getConfig.mockReturnValue(BASE_CONFIG_WITH_GMAIL);
  setupGmailMock();
});

// ─── parseMessage ─────────────────────────────────────────────────────────────

describe('parseMessage', () => {
  test('extracts subject, from, and snippet', () => {
    const msg = {
      payload: {
        headers: [
          { name: 'Subject', value: 'Canvas: New Assignment' },
          { name: 'From',    value: 'notifications@instructure.com' },
        ],
      },
      snippet: 'A new assignment has been posted.',
    };
    const parsed = parseMessage(msg);
    expect(parsed.subject).toBe('Canvas: New Assignment');
    expect(parsed.from).toBe('notifications@instructure.com');
    expect(parsed.snippet).toBe('A new assignment has been posted.');
  });

  test('handles missing headers gracefully', () => {
    const msg = { payload: { headers: [] }, snippet: 'Test' };
    const parsed = parseMessage(msg);
    expect(parsed.subject).toBe('');
    expect(parsed.from).toBe('');
    expect(parsed.snippet).toBe('Test');
  });

  test('decodes HTML entities in snippet', () => {
    const msg = {
      payload: { headers: [] },
      snippet: "It&#39;s a &quot;test&quot; snippet.",
    };
    const parsed = parseMessage(msg);
    expect(parsed.snippet).toBe("It's a \"test\" snippet.");
  });
});

// ─── classifyEmail ────────────────────────────────────────────────────────────

describe('classifyEmail', () => {
  test('instructure.com → canvas', () => {
    expect(classifyEmail('noreply@instructure.com')).toBe('canvas');
  });

  test('canvas in from → canvas', () => {
    expect(classifyEmail('canvas@school.edu')).toBe('canvas');
  });

  test('classroom.google.com → classroom', () => {
    expect(classifyEmail('notifications@classroom.google.com')).toBe('classroom');
  });

  test('googleclassroom.com → classroom', () => {
    expect(classifyEmail('noreply@googleclassroom.com')).toBe('classroom');
  });

  test('unknown domain → other', () => {
    expect(classifyEmail('principal@school.edu')).toBe('other');
  });
});

// ─── buildSummary ─────────────────────────────────────────────────────────────

describe('buildSummary', () => {
  test('includes "School email update" header', () => {
    const summary = buildSummary([]);
    expect(summary).toContain('School email update');
  });

  test('groups Canvas and Classroom emails separately', () => {
    const details = [
      { subject: 'Canvas Assignment', from: 'noreply@instructure.com',           snippet: 'Due Friday.' },
      { subject: 'Classroom Post',    from: 'notifications@classroom.google.com', snippet: 'New post.' },
    ];
    const summary = buildSummary(details);
    expect(summary).toContain('Canvas');
    expect(summary).toContain('Google Classroom');
    expect(summary).toContain('Canvas Assignment');
    expect(summary).toContain('Classroom Post');
  });

  test('shows "other" section for unclassified emails', () => {
    const details = [
      { subject: 'Lunch Menu', from: 'cafeteria@school.edu', snippet: 'Pizza Friday!' },
    ];
    const summary = buildSummary(details);
    expect(summary).toContain('Other school email');
    expect(summary).toContain('Lunch Menu');
  });

  test('truncates snippet to 80 characters', () => {
    const longSnippet = 'A'.repeat(100);
    const details = [
      { subject: 'Test', from: 'noreply@instructure.com', snippet: longSnippet },
    ];
    const summary = buildSummary(details);
    expect(summary).toContain('A'.repeat(80));
    expect(summary).not.toContain('A'.repeat(81));
  });

  test('shows overflow indicator when more than 3 canvas messages', () => {
    const details = Array.from({ length: 5 }, (_, i) => ({
      subject: `Assignment ${i}`,
      from: 'noreply@instructure.com',
      snippet: '',
    }));
    const summary = buildSummary(details);
    expect(summary).toContain('2 more');
  });
});

// ─── State management ─────────────────────────────────────────────────────────

describe('state management', () => {
  test('loadState returns defaults when file does not exist', () => {
    const state = loadState();
    expect(state.lastCheckedAt).toBeNull();
    expect(state.processedIds).toEqual([]);
  });

  test('saveState persists and loadState reads back correctly', () => {
    const state = { lastCheckedAt: '2026-03-31T12:00:00.000Z', processedIds: ['id1', 'id2'] };
    saveState(state);
    const loaded = loadState();
    expect(loaded.lastCheckedAt).toBe(state.lastCheckedAt);
    expect(loaded.processedIds).toEqual(['id1', 'id2']);
  });

  test('saveState caps processedIds at 500 entries', () => {
    const ids = Array.from({ length: 600 }, (_, i) => `id-${i}`);
    saveState({ lastCheckedAt: null, processedIds: ids });
    const loaded = loadState();
    expect(loaded.processedIds.length).toBe(500);
    expect(loaded.processedIds[0]).toBe('id-100');
  });
});

// ─── pollGmail ────────────────────────────────────────────────────────────────

describe('pollGmail', () => {
  test('skips poll silently when Gmail credentials are absent', async () => {
    getConfig.mockReturnValue(BASE_CONFIG_NO_GMAIL);
    await pollGmail();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(google.gmail).not.toHaveBeenCalled();
  });

  test('sends no iMessage when no new messages exist', async () => {
    mockMessagesList.mockResolvedValue({ data: { messages: [] } });
    await pollGmail();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('sends no iMessage when all messages are already processed', async () => {
    saveState({ lastCheckedAt: null, processedIds: ['id-1'] });
    mockMessagesList.mockResolvedValue({ data: { messages: [{ id: 'id-1' }] } });
    await pollGmail();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('fetches message details for new messages', async () => {
    mockMessagesList.mockResolvedValue({ data: { messages: [{ id: 'msg-new' }] } });
    mockMessagesGet.mockResolvedValue({
      data: {
        snippet: 'You have a new assignment.',
        payload: {
          headers: [
            { name: 'Subject', value: 'New Canvas Assignment' },
            { name: 'From',    value: 'noreply@instructure.com' },
          ],
        },
      },
    });

    await pollGmail();

    expect(mockMessagesGet).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'me', id: 'msg-new' })
    );
  });

  test('sends iMessage summary to parent when new messages exist', async () => {
    mockMessagesList.mockResolvedValue({ data: { messages: [{ id: 'msg-canvas-1' }] } });
    mockMessagesGet.mockResolvedValue({
      data: {
        snippet: 'A new assignment is posted.',
        payload: {
          headers: [
            { name: 'Subject', value: 'Canvas: Algebra HW 8 posted' },
            { name: 'From',    value: 'noreply@instructure.com' },
          ],
        },
      },
    });

    await pollGmail();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      BASE_CONFIG_WITH_GMAIL.parent_phone,
      expect.stringContaining('Canvas')
    );
  });

  test('processed message ID is saved to state after poll', async () => {
    mockMessagesList.mockResolvedValue({ data: { messages: [{ id: 'msg-save-test' }] } });
    mockMessagesGet.mockResolvedValue({
      data: {
        snippet: 'Test',
        payload: { headers: [] },
      },
    });

    await pollGmail();

    const state = loadState();
    expect(state.processedIds).toContain('msg-save-test');
  });

  test('lastCheckedAt is updated after poll even with no new messages', async () => {
    mockMessagesList.mockResolvedValue({ data: { messages: [] } });

    const before = Date.now();
    await pollGmail();
    const after = Date.now();

    const state = loadState();
    const checked = new Date(state.lastCheckedAt).getTime();
    expect(checked).toBeGreaterThanOrEqual(before);
    expect(checked).toBeLessThanOrEqual(after);
  });

  test('handles Gmail API list failure without crashing', async () => {
    mockMessagesList.mockRejectedValue(new Error('Network error'));
    await expect(pollGmail()).resolves.not.toThrow();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('continues processing remaining messages when one fetch fails', async () => {
    mockMessagesList.mockResolvedValue({
      data: { messages: [{ id: 'msg-fail' }, { id: 'msg-ok' }] },
    });
    mockMessagesGet
      .mockRejectedValueOnce(new Error('fetch error'))
      .mockResolvedValueOnce({
        data: {
          snippet: 'OK message',
          payload: { headers: [
            { name: 'Subject', value: 'Good message' },
            { name: 'From',    value: 'noreply@instructure.com' },
          ] },
        },
      });

    await pollGmail();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [, body] = sendMessage.mock.calls[0];
    expect(body).toContain('Good message');
  });
});
