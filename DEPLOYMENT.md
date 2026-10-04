# Taegan OpenClaw — Deployment Guide

This guide is written for someone comfortable using Terminal but not necessarily a developer.
Follow every step in order. The whole process takes under 30 minutes.

---

## Prerequisites

Before you start, have these ready:

- Mac Mini running macOS 13 or later, connected to your home network
- The Mac Mini must be **logged in** (not just on) so LaunchAgents can run
- Apple ID signed into the **Messages** app on the Mac Mini
- Accounts and credentials for:
  - [Twilio](https://console.twilio.com) — free trial works
  - [ElevenLabs](https://elevenlabs.io) — free tier works
  - ClassLink URL + Taegan's school login

---

## Step 1 — Open Terminal

Press **Command + Space**, type `Terminal`, press Enter.

All commands below are typed into Terminal and run by pressing Enter.

---

## Step 2 — Clone the repository

```bash
cd ~
git clone https://github.com/YOUR_USERNAME/taegan-openclaw.git
cd taegan-openclaw
```

> If you don't have `git`, run `xcode-select --install` first and follow the prompts.

---

## Step 3 — Run setup

This installs Node.js, downloads Playwright's browser, installs the LaunchAgent, and runs the test suite.

```bash
bash scripts/setup.sh
```

The script will tell you if anything fails. It takes 5–15 minutes depending on your internet speed.

---

## Step 4 — Fill in your credentials (`.env`)

```bash
nano .env
```

Fill in **every line** that has an `=` with no value after it:

| Variable | Where to find it |
|---|---|
| `TWILIO_ACCOUNT_SID` | [Twilio Console](https://console.twilio.com) → Account Info |
| `TWILIO_AUTH_TOKEN` | Same page |
| `TWILIO_FROM_NUMBER` | Twilio → Phone Numbers → your number (format: `+15551234567`) |
| `ELEVENLABS_API_KEY` | ElevenLabs → Profile → API Key |
| `ELEVENLABS_VOICE_ID` | ElevenLabs → Voices → click a voice → copy ID from URL |
| `GMAIL_CLIENT_ID` | Google Cloud Console → see Step 4a below |
| `GMAIL_CLIENT_SECRET` | Same as above |
| `GMAIL_REFRESH_TOKEN` | Same as above |
| `CLASSLINK_URL` | The URL of Taegan's school ClassLink login page |
| `CLASSLINK_USER` | Taegan's ClassLink username |
| `CLASSLINK_PASS` | Taegan's ClassLink password |

Save: **Control + O**, Enter, **Control + X**

---

### Step 4a — Set up Gmail access (school email monitor)

This is a one-time setup to let OpenClaw read Taegan's school Gmail for Canvas and Classroom notifications.

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and sign in with the school Google account (or a parent Google account that has access).
2. Create a new project (name it anything, e.g. "OpenClaw").
3. Enable the **Gmail API**: search "Gmail API" in the top search bar → click Enable.
4. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - Application type: **Desktop app**
   - Name: `OpenClaw`
   - Click Create. Copy the **Client ID** and **Client Secret** into `.env`.
5. Go to **OAuth consent screen** → set User type to **External**, fill in any app name, add the school Gmail address as a test user, and save.
6. Get a refresh token. In Terminal, run:

```bash
node -e "
const { google } = require('googleapis');
const c = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  'urn:ietf:wg:oauth:2.0:oob'
);
console.log(c.generateAuthUrl({ access_type:'offline', scope:['https://www.googleapis.com/auth/gmail.readonly'] }));
"
```

Copy the URL it prints, open it in a browser, sign in with the school Gmail account, approve access, and copy the code shown.

Then run (replace CODE with what you copied):

```bash
node -e "
const { google } = require('googleapis');
const c = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  'urn:ietf:wg:oauth:2.0:oob'
);
c.getToken('CODE').then(r => console.log('REFRESH TOKEN:', r.tokens.refresh_token));
"
```

Paste the printed refresh token into `.env` as `GMAIL_REFRESH_TOKEN`.

> **Gmail credentials are optional.** If you skip this step, OpenClaw skips the email monitor silently and everything else still works.

---

---

## Step 5 — Fill in your schedule (`config.yaml`)

```bash
nano config.yaml
```

Fill in:

- `taegan_phone` — Taegan's phone number in `+1XXXXXXXXXX` format
- `parent_phone` — Your phone number in `+1XXXXXXXXXX` format
- Both numbers in `approved_contacts`
- `practice_days` — days of week with after-school practice (0=Sun, 1=Mon, …, 6=Sat)
- `pushup_week` — start at `1`, bump by 1 every Monday
- `taegan_playlist_url` — leave blank for now, add later

Save: **Control + O**, Enter, **Control + X**

---

## Step 6 — Start the system

```bash
bash scripts/start.sh
```

You should see log lines confirming each module started. Press **Control + C** to stop watching — the app keeps running in the background.

---

## Step 7 — Verify the LaunchAgent is registered

The LaunchAgent makes the app restart automatically on reboot.

```bash
launchctl list | grep taegan
```

You should see a line with `com.taegan.openclaw`. If nothing appears, run:

```bash
launchctl load ~/Library/LaunchAgents/com.taegan.openclaw.plist
```

---

## Step 8 — Run the health check

```bash
bash scripts/health-check.sh
```

All four checks should show `[OK]`. If any fail, the output will tell you exactly what's wrong.

---

## ✅ 8-Item Verification Checklist

Work through this top to bottom before considering the system live.

- [ ] **1. Tests pass** — `npm test` runs and shows all green (no failures)
- [ ] **2. Health check passes** — `bash scripts/health-check.sh` shows 4/4 OK
- [ ] **3. iMessage works** — send a test from Terminal:
  ```bash
  node -e "require('./src/imessage').sendMessage('+1TAEGANNUMBER', 'OpenClaw test — ignore')"
  ```
  Taegan should receive the message within 10 seconds
- [ ] **4. Gateway responds** — `curl -sf http://127.0.0.1:18789/ && echo OK`
- [ ] **5. Ollama running** — `curl -sf http://127.0.0.1:11434/api/tags | head -c 100`
- [ ] **6. LaunchAgent loaded** — `launchctl list | grep taegan` shows an entry
- [ ] **7. Scraper data and snapshots exist** (after first 6 AM or 3 PM run) —
  ```bash
  ls -la ~/.openclaw/workspace/canvas-data.json
  ls -la ~/.openclaw/workspace/skyward-data.json
  ls ~/.openclaw/workspace/snapshots/
  ```
- [ ] **8. Parent receives test alert** —
  ```bash
  node -e "require('./src/imessage').sendMessage('+1PARENTNUMBER', 'OpenClaw is live. All systems running.')"
  ```

---

## Ongoing Maintenance

| Task | When | Command |
|---|---|---|
| Bump push-up week | Every Monday | Edit `pushup_week` in `config.yaml` |
| Add playlist URL | When ready | Edit `taegan_playlist_url` in `config.yaml` |
| Add game dates | Each season | Add to `game_schedule` in `config.yaml` |
| View logs | Anytime | `tail -f ~/.openclaw/logs/cron.log` |
| View escalation history | Anytime | `cat ~/.openclaw/workspace/escalation-log.json` |
| Restart the app | If needed | `bash scripts/start.sh` |
| Tune scraper selectors | If scraper breaks | `npx playwright codegen $CLASSLINK_URL` |

---

## Troubleshooting

**iMessage not sending** — Make sure Messages is open and signed in on the Mac Mini. The Mac must be awake (not sleeping).

**Scraper failing** — Fill in `CLASSLINK_URL`, `CLASSLINK_USER`, `CLASSLINK_PASS` in `.env`, then run `npx playwright install chromium`.

**App not auto-starting after reboot** — Run `launchctl load ~/Library/LaunchAgents/com.taegan.openclaw.plist`.

**Health alert flooding** — Check `bash scripts/health-check.sh` to see which check is failing, then fix the underlying issue.
