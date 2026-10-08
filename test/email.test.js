'use strict';

/**
 * Tests for src/email.js and parent-email routing in src/imessage.js.
 * nodemailer is mocked; no real email is sent.
 */

jest.mock('../src/config');

const mockSendMail = jest.fn();
const mockCreateTransport = jest.fn(() => ({ sendMail: mockSendMail }));
jest.mock('nodemailer', () => ({ createTransport: mockCreateTransport }));

const mockSmsCreate = jest.fn(async () => ({ sid: 'SM1' }));
jest.mock('twilio', () => jest.fn(() => ({ messages: { create: mockSmsCreate } })));

const { getConfig } = require('../src/config');
const email = require('../src/email');
const { sendMessage } = require('../src/imessage');

const TAEGAN = '+15550000002';
const PARENT = '+15550000003';

const ENV = {
  twilio_account_sid: 'ACtest',
  twilio_auth_token: 'authtokentest',
  twilio_from_number: '+15550000001',
  smtp_user: 'sender@gmail.com',
  smtp_pass: 'app-password',
  parent_email: 'parent@example.com',
};

beforeEach(() => {
  jest.clearAllMocks();
  getConfig.mockReturnValue({
    taegan_phone: TAEGAN,
    parent_phone: PARENT,
    approved_contacts: [TAEGAN, PARENT],
    env: ENV,
  });
  mockSendMail.mockResolvedValue({ messageId: '<abc@gmail.com>' });
  jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => jest.restoreAllMocks());

describe('sendParentEmail', () => {
  test('sends to PARENT_EMAIL through Gmail SMTP by default', async () => {
    await expect(email.sendParentEmail('⚠️ OpenClaw alert\nStep: MR-001')).resolves.toBe('<abc@gmail.com>');
    expect(mockCreateTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: ENV.smtp_user, pass: ENV.smtp_pass },
    }));
    expect(mockSendMail).toHaveBeenCalledWith({
      from: `Taegbot <${ENV.smtp_user}>`,
      to: ENV.parent_email,
      subject: 'Taegbot: ⚠️ OpenClaw alert',
      text: '⚠️ OpenClaw alert\nStep: MR-001',
    });
  });

  test('subject uses the first non-blank line, truncated', () => {
    expect(email.subjectFor('\n\nNightly summary\nmore')).toBe('Taegbot: Nightly summary');
    const long = email.subjectFor('x'.repeat(200));
    expect(long.length).toBeLessThanOrEqual('Taegbot: '.length + 80);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('isConfigured', () => {
  test('needs user, password and parent email', () => {
    expect(email.isConfigured(ENV)).toBe(true);
    expect(email.isConfigured({ ...ENV, parent_email: '' })).toBe(false);
    expect(email.isConfigured({ ...ENV, smtp_pass: undefined })).toBe(false);
  });
});

describe('sendMessage routing to the parent', () => {
  test('messages to the parent are emailed, not texted', async () => {
    await expect(sendMessage(PARENT, 'Nightly summary')).resolves.toEqual(['<abc@gmail.com>']);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSmsCreate).not.toHaveBeenCalled();
  });

  test('email failure resolves to null instead of rejecting', async () => {
    mockSendMail.mockRejectedValueOnce(new Error('Invalid login'));
    await expect(sendMessage(PARENT, 'Hi')).resolves.toBeNull();
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('Invalid login'));
  });

  test('without email settings, parent messages fall back to SMS', async () => {
    getConfig.mockReturnValue({
      taegan_phone: TAEGAN,
      parent_phone: PARENT,
      approved_contacts: [TAEGAN, PARENT],
      env: { ...ENV, smtp_user: '' },
    });
    await sendMessage(PARENT, 'Hi');
    expect(mockSmsCreate).toHaveBeenCalledWith(expect.objectContaining({ to: PARENT }));
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  test('messages to Taegan are never emailed', async () => {
    await sendMessage(TAEGAN, 'Wake up!');
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(mockSmsCreate).toHaveBeenCalledWith(expect.objectContaining({ to: TAEGAN }));
  });
});
