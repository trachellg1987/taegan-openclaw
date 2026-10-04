'use strict';

/**
 * Tests for src/imessage.js — outbound texts via Twilio SMS.
 * All Twilio traffic is mocked.
 */

jest.mock('../src/config');

const mockMessagesCreate = jest.fn();
const mockTwilioFactory = jest.fn(() => ({ messages: { create: mockMessagesCreate } }));
jest.mock('twilio', () => mockTwilioFactory);

const { getConfig } = require('../src/config');
const { sendMessage, splitBody, MAX_SMS_LENGTH } = require('../src/imessage');

const APPROVED = '+15550000002';
const UNAPPROVED = '+15559999999';
const FROM = '+15550000001';

const ENV = {
  twilio_account_sid: 'ACtest1234567890',
  twilio_auth_token: 'authtokentest',
  twilio_from_number: FROM,
};

let stderrSpy;

beforeEach(() => {
  jest.clearAllMocks();
  getConfig.mockReturnValue({
    approved_contacts: [APPROVED, '+15550000003'],
    env: ENV,
  });
  mockMessagesCreate.mockResolvedValue({ sid: 'SM123' });
  stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  stderrSpy.mockRestore();
});

test('sends SMS to approved contact via Twilio', async () => {
  const sids = await sendMessage(APPROVED, 'Hello Taegan');
  expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
  expect(mockMessagesCreate).toHaveBeenCalledWith({ from: FROM, to: APPROVED, body: 'Hello Taegan' });
  expect(sids).toEqual(['SM123']);
});

test('creates the Twilio client with account SID and auth token', async () => {
  // Client is cached per account SID, so force a fresh one
  getConfig.mockReturnValue({
    approved_contacts: [APPROVED],
    env: { ...ENV, twilio_account_sid: 'ACother' },
  });
  await sendMessage(APPROVED, 'Hi');
  expect(mockTwilioFactory).toHaveBeenCalledWith('ACother', ENV.twilio_auth_token);
});

test('blocks message to unapproved number and throws', () => {
  expect(() => sendMessage(UNAPPROVED, 'Should not send')).toThrow(/not in approved_contacts/);
  expect(mockMessagesCreate).not.toHaveBeenCalled();
});

test('blocked send is logged, not thrown silently', () => {
  // Verify the error message is descriptive
  let err;
  try {
    sendMessage(UNAPPROVED, 'test');
  } catch (e) {
    err = e;
  }
  expect(err.message).toMatch(UNAPPROVED);
});

test('throws synchronously when Twilio credentials are missing', () => {
  getConfig.mockReturnValue({
    approved_contacts: [APPROVED],
    env: { ...ENV, twilio_from_number: undefined },
  });
  expect(() => sendMessage(APPROVED, 'Hi')).toThrow(/TWILIO_FROM_NUMBER/);
  expect(mockMessagesCreate).not.toHaveBeenCalled();
});

test('Twilio delivery failure resolves to null instead of rejecting', async () => {
  mockMessagesCreate.mockRejectedValue(Object.assign(new Error('Invalid To number'), { code: 21211 }));
  await expect(sendMessage(APPROVED, 'Hi')).resolves.toBeNull();
  expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid To number'));
});

test('long messages are split into multiple SMS parts in order', async () => {
  mockMessagesCreate
    .mockResolvedValueOnce({ sid: 'SM1' })
    .mockResolvedValueOnce({ sid: 'SM2' });
  const body = 'a'.repeat(MAX_SMS_LENGTH - 10) + '\n' + 'b'.repeat(50);
  const sids = await sendMessage(APPROVED, body);
  expect(sids).toEqual(['SM1', 'SM2']);
  expect(mockMessagesCreate.mock.calls[0][0].body).toBe('a'.repeat(MAX_SMS_LENGTH - 10));
  expect(mockMessagesCreate.mock.calls[1][0].body).toBe('b'.repeat(50));
});

describe('splitBody', () => {
  test('short body is a single part', () => {
    expect(splitBody('hello')).toEqual(['hello']);
  });

  test('every part fits within the SMS limit', () => {
    const parts = splitBody('word '.repeat(1000));
    expect(parts.length).toBeGreaterThan(1);
    parts.forEach(p => expect(p.length).toBeLessThanOrEqual(MAX_SMS_LENGTH));
  });

  test('hard-splits text with no spaces or newlines', () => {
    const parts = splitBody('x'.repeat(MAX_SMS_LENGTH * 2 + 5));
    expect(parts.map(p => p.length)).toEqual([MAX_SMS_LENGTH, MAX_SMS_LENGTH, 5]);
  });
});
