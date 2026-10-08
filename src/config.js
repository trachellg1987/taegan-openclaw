'use strict';

const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const REQUIRED_ENV = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_FROM_NUMBER',
  'ELEVENLABS_API_KEY',
  'ELEVENLABS_VOICE_ID',
];

const REQUIRED_YAML = [
  'taegan_phone',
  'parent_phone',
  'approved_contacts',
  'morning.wake_time',
  'morning.depart_time',
  'after_school.routine_start',
  'nighttime.screen_off_time',
  'nighttime.lights_out_time',
];

function getNestedValue(obj, dotPath) {
  return dotPath.split('.').reduce((acc, key) => acc && acc[key], obj);
}

function loadConfig() {
  // Validate env
  const missingEnv = REQUIRED_ENV.filter(k => !process.env[k]);
  if (missingEnv.length > 0) {
    throw new Error(`Missing required .env variables: ${missingEnv.join(', ')}`);
  }

  // Load config.yaml
  const yamlPath = path.join(__dirname, '..', 'config.yaml');
  if (!fs.existsSync(yamlPath)) {
    throw new Error(
      'config.yaml not found. Copy config.yaml.example to config.yaml and fill in your values.'
    );
  }

  const raw = yaml.load(fs.readFileSync(yamlPath, 'utf8'));

  // Validate yaml fields
  const missingYaml = REQUIRED_YAML.filter(k => getNestedValue(raw, k) == null);
  if (missingYaml.length > 0) {
    throw new Error(`Missing required config.yaml fields: ${missingYaml.join(', ')}`);
  }

  if (!Array.isArray(raw.approved_contacts) || raw.approved_contacts.length === 0) {
    throw new Error('config.yaml approved_contacts must be a non-empty list');
  }

  return Object.freeze({
    taegan_phone: raw.taegan_phone,
    parent_phone: raw.parent_phone,
    approved_contacts: Object.freeze([...raw.approved_contacts]),
    practice_days: raw.practice_days || [],
    game_schedule: raw.game_schedule || [],
    taegan_playlist_url: raw.taegan_playlist_url || '',
    pushup_week: typeof raw.pushup_week === 'number' ? raw.pushup_week : 1,
    class_reminders: Object.freeze({
      a_day: Object.freeze([...((raw.class_reminders || {}).a_day || [])]),
      b_day: Object.freeze([...((raw.class_reminders || {}).b_day || [])]),
    }),
    morning: Object.freeze(raw.morning),
    after_school: Object.freeze(raw.after_school),
    nighttime: Object.freeze(raw.nighttime),
    env: Object.freeze({
      twilio_account_sid: process.env.TWILIO_ACCOUNT_SID,
      twilio_auth_token: process.env.TWILIO_AUTH_TOKEN,
      twilio_from_number: process.env.TWILIO_FROM_NUMBER,
      elevenlabs_api_key: process.env.ELEVENLABS_API_KEY,
      elevenlabs_voice_id: process.env.ELEVENLABS_VOICE_ID,
      gmail_client_id: process.env.GMAIL_CLIENT_ID,
      gmail_client_secret: process.env.GMAIL_CLIENT_SECRET,
      gmail_refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      classlink_url: process.env.CLASSLINK_URL,
      classlink_user: process.env.CLASSLINK_USER,
      classlink_pass: process.env.CLASSLINK_PASS,
      public_base_url: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
      webhook_port: process.env.WEBHOOK_PORT,
      telegram_bot_token: process.env.TELEGRAM_BOT_TOKEN,
      telegram_chat_id: process.env.TELEGRAM_CHAT_ID,
    }),
  });
}

// Singleton — load once, reuse
let _config = null;
function getConfig() {
  if (!_config) _config = loadConfig();
  return _config;
}

// Reset for tests
function _resetConfig() {
  _config = null;
}

module.exports = { getConfig, _resetConfig };
