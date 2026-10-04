'use strict';

jest.mock('child_process', () => ({ execSync: jest.fn() }));
jest.mock('../src/config');

const { execSync } = require('child_process');
const { getConfig } = require('../src/config');
const { sendMessage } = require('../src/imessage');

const APPROVED = '+15550000002';
const UNAPPROVED = '+15559999999';

beforeEach(() => {
  jest.clearAllMocks();
  getConfig.mockReturnValue({
    approved_contacts: [APPROVED, '+15550000003'],
  });
});

test('sends message to approved contact', () => {
  expect(() => sendMessage(APPROVED, 'Hello Taegan')).not.toThrow();
  expect(execSync).toHaveBeenCalledTimes(1);
  expect(execSync.mock.calls[0][0]).toContain(APPROVED);
});

test('blocks message to unapproved number and throws', () => {
  expect(() => sendMessage(UNAPPROVED, 'Should not send')).toThrow(/not in approved_contacts/);
  expect(execSync).not.toHaveBeenCalled();
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
