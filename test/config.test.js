'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

// We test loadConfig in isolation by manipulating env and writing temp files
describe('config loader', () => {
  const { _resetConfig } = require('../src/config');
  const YAML_PATH = path.join(__dirname, '..', 'config.yaml');

  const validEnv = {
    TWILIO_ACCOUNT_SID: 'ACtest',
    TWILIO_AUTH_TOKEN: 'token',
    TWILIO_FROM_NUMBER: '+15550000001',
    ELEVENLABS_API_KEY: 'el-key',
    ELEVENLABS_VOICE_ID: 'voice-id',
  };

  const validYaml = `
taegan_phone: "+15550000002"
parent_phone: "+15550000003"
approved_contacts:
  - "+15550000002"
  - "+15550000003"
practice_days: [1, 2, 3, 4]
game_schedule: []
morning:
  wake_time: "06:00"
  depart_time: "07:10"
  blackout_after: "07:30"
after_school:
  idle_start: "16:45"
  routine_start: "17:15"
  end_buffer_start: "18:25"
  blackout_after: "18:45"
nighttime:
  exercise_time: "20:45"
  shower_time: "21:15"
  brush_time: "21:30"
  tidy_time: "21:40"
  screen_off_time: "21:50"
  lights_out_time: "22:30"
`;

  // These tests write and delete config.yaml in the project root, so move a
  // real one aside and put it back afterwards
  const BACKUP_PATH = `${YAML_PATH}.test-backup`;

  beforeAll(() => {
    if (fs.existsSync(YAML_PATH)) fs.renameSync(YAML_PATH, BACKUP_PATH);
  });

  afterAll(() => {
    if (fs.existsSync(BACKUP_PATH)) fs.renameSync(BACKUP_PATH, YAML_PATH);
  });

  beforeEach(() => {
    _resetConfig();
    Object.assign(process.env, validEnv);
    fs.writeFileSync(YAML_PATH, validYaml);
  });

  afterEach(() => {
    _resetConfig();
    Object.keys(validEnv).forEach(k => delete process.env[k]);
    if (fs.existsSync(YAML_PATH)) fs.unlinkSync(YAML_PATH);
  });

  test('loads successfully with valid env and yaml', () => {
    const { getConfig } = require('../src/config');
    const cfg = getConfig();
    expect(cfg.taegan_phone).toBe('+15550000002');
    expect(cfg.parent_phone).toBe('+15550000003');
    expect(cfg.approved_contacts).toContain('+15550000002');
    expect(cfg.morning.wake_time).toBe('06:00');
  });

  test('throws when a required env variable is missing', () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    const { getConfig } = require('../src/config');
    expect(() => getConfig()).toThrow(/TWILIO_ACCOUNT_SID/);
  });

  test('throws when config.yaml is missing', () => {
    fs.unlinkSync(YAML_PATH);
    const { getConfig } = require('../src/config');
    expect(() => getConfig()).toThrow(/config.yaml not found/);
  });

  test('throws when approved_contacts is empty', () => {
    fs.writeFileSync(YAML_PATH, validYaml.replace(/approved_contacts[\s\S]*?game_schedule/, 'approved_contacts: []\ngame_schedule'));
    const { getConfig } = require('../src/config');
    expect(() => getConfig()).toThrow(/approved_contacts/);
  });

  test('config object is frozen', () => {
    const { getConfig } = require('../src/config');
    const cfg = getConfig();
    expect(Object.isFrozen(cfg)).toBe(true);
    expect(Object.isFrozen(cfg.morning)).toBe(true);
  });
});
