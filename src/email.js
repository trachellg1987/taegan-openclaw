'use strict';

/**
 * Email delivery for messages to the parent (nightly summary, grade and
 * health alerts, reports). Replaces SMS so no A2P registration is needed.
 * Urgent "Taegan didn't respond" escalations still go out as phone calls.
 *
 * Configured with SMTP_USER, SMTP_PASS and PARENT_EMAIL in .env. Defaults to
 * Gmail (smtp.gmail.com:465), where SMTP_PASS must be a Google app password.
 */

const nodemailer = require('nodemailer');
const { getConfig } = require('./config');

function isConfigured(env = getConfig().env) {
  return Boolean(env.smtp_user && env.smtp_pass && env.parent_email);
}

let _transport = null;
let _transportKey = null;
function getTransport(env) {
  const key = `${env.smtp_host}:${env.smtp_port}:${env.smtp_user}`;
  if (!_transport || _transportKey !== key) {
    const port = Number(env.smtp_port) || 465;
    _transport = nodemailer.createTransport({
      host: env.smtp_host || 'smtp.gmail.com',
      port,
      secure: port === 465,
      auth: { user: env.smtp_user, pass: env.smtp_pass },
    });
    _transportKey = key;
  }
  return _transport;
}

/** Subject from the message's first line, e.g. "⚠️ OpenClaw alert" → "Taegbot: ⚠️ OpenClaw alert". */
function subjectFor(body) {
  const first = body.split('\n').find(l => l.trim()) || 'Update';
  const trimmed = first.trim();
  return `Taegbot: ${trimmed.length > 80 ? trimmed.slice(0, 77) + '…' : trimmed}`;
}

/**
 * Email the parent. Returns the SMTP message id.
 */
async function sendParentEmail(body) {
  const { env } = getConfig();
  const info = await getTransport(env).sendMail({
    from: `Taegbot <${env.smtp_user}>`,
    to: env.parent_email,
    subject: subjectFor(body),
    text: body,
  });
  return info.messageId;
}

module.exports = { isConfigured, sendParentEmail, subjectFor };
