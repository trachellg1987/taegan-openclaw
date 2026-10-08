# Taegan OpenClaw — VPS Deployment (Hostinger, Ubuntu 24.04)

Moves OpenClaw off the Mac Mini onto a Linux VPS. Texts now go out by
**Twilio SMS** instead of iMessage (iMessage only works on a Mac).

## 1. Before you start

- Hostinger VPS with **Ubuntu 24.04**, and its IP address.
- **Twilio SMS number.** The same Twilio number used for escalation calls can send SMS.
  For US numbers, Twilio requires **A2P 10DLC registration** (Console → Messaging →
  Regulatory Compliance) before texts are delivered. Unregistered numbers get error 30034.
  Registration can take days, so start it early.
- A GitHub token with `repo` scope (github.com/settings/tokens) to clone the private repo.

## 2. Run the installer on the VPS

From the Mac Terminal:

```bash
ssh root@VPS_IP
```

On the VPS:

```bash
curl -fsSL -o setup-vps.sh \
  -H "Authorization: token YOUR_GITHUB_TOKEN" \
  https://raw.githubusercontent.com/trachellg1987/taegan-openclaw/main/scripts/vps/setup-vps.sh
bash setup-vps.sh
```

This installs Node 24, git, Playwright Chromium and OpenClaw 2026.9.7, clones the repo,
runs the tests, and installs the systemd service and the 5-minute watchdog cron. The app
does not start yet because the secrets are missing. Re-running the script later never
starts the app unless you pass `--start` (`bash setup-vps.sh --start`).

## 3. Copy secrets from the Mac (never through GitHub or chat)

On the **Mac**:

```bash
cd ~/taegan-openclaw
scp .env config.yaml root@VPS_IP:/home/openclaw/taegan-openclaw/
```

On the **VPS**, lock them down and start the app:

```bash
chown openclaw:openclaw /home/openclaw/taegan-openclaw/{.env,config.yaml}
chmod 600 /home/openclaw/taegan-openclaw/{.env,config.yaml}
nano /home/openclaw/taegan-openclaw/.env   # confirm TWILIO_ACCOUNT_SID / AUTH_TOKEN / FROM_NUMBER
systemctl start taegan-openclaw
```

## 3b. Let Taegan's replies stop escalations

SMS has no read receipts, so a **reply from Taegan** (any text: "ok", "done"…)
cancels the pending 5-minute escalation calls. NT-005 (phone down at 9:50 PM)
still always escalates. Escalation calls also use this server to play the ElevenLabs voice.

1. Add to `/home/openclaw/taegan-openclaw/.env`:
   ```
   PUBLIC_BASE_URL=http://179.236.242.215:8080
   WEBHOOK_PORT=8080
   ```
   Then run `systemctl restart taegan-openclaw`.
2. **Twilio Console** → Phone Numbers → Active numbers → your number →
   Messaging → **A message comes in**: Webhook, `http://179.236.242.215:8080/sms`,
   HTTP POST. Save.
3. **Hostinger hPanel** → VPS → Firewall: if a firewall is enabled there, allow TCP port 8080.
   (The setup script already opens it in the server's own firewall.)
4. Test: text anything to the Twilio number from Taegan's phone, then run
   `grep webhook /home/openclaw/.openclaw/logs/openclaw.stdout.log | tail -3`.
   You should see `Reply from Taegan — cancelled N escalation timer(s)`.

Without `PUBLIC_BASE_URL`, everything else still works, but every routine
text escalates to a call after 5 minutes and calls use Twilio's built-in voice.

## 3c. Telegram reminders (Taegan has no phone number)

Taegan's routine reminders arrive in Telegram from a **dedicated reminder bot**, each
with a ✅ **Done** button. Tapping Done or replying cancels that escalation. If he
doesn't respond within 5 minutes, **the parent gets a phone call** (Twilio voice
calls don't need A2P approval). At 9:50 PM (NT-005) he gets a second nudge instead
of a call. Parent alerts and summaries still go by SMS once A2P is approved.

1. In Telegram, message **@BotFather** → `/newbot` → e.g. "Taegan Routine",
   username `TaeganRoutineBot`. Keep this separate from the Taegbot (OpenClaw) bot.
   Paste the token only into `.env`, never into a chat.
2. In the Telegram account Taegan uses, open the new bot and tap **Start**.
   Bots can't message an account until it has started the bot.
3. Add to `/home/openclaw/taegan-openclaw/.env`:
   ```
   TELEGRAM_BOT_TOKEN=<token from BotFather>
   TELEGRAM_CHAT_ID=<Taegan's Telegram user id>
   ```
   `taegan_phone` in `config.yaml` can stay a placeholder as long as it's in
   `approved_contacts`; `parent_phone` must be the parent's real number.
4. `systemctl restart taegan-openclaw`, then check the log shows
   `[telegram] Listening for Done taps and replies`.

## 3d. Parent messages by email (no A2P needed)

Nightly summaries, grade and missing-assignment alerts, health alerts and reports go
to the parent's **email** instead of SMS. Urgent "Taegan didn't respond" escalations
stay **phone calls**. With this set, the Twilio A2P campaign isn't needed.

1. Turn on 2-Step Verification for the sending Gmail account, then create an
   **app password** at myaccount.google.com/apppasswords (name it "Taegbot").
   Google shows a 16-character password once. Paste it only into `.env`.
2. Add to `/home/openclaw/taegan-openclaw/.env`:
   ```
   SMTP_USER=<sending gmail address>
   SMTP_PASS=<16-character app password, no spaces>
   PARENT_EMAIL=<where alerts should arrive>
   ```
3. `systemctl restart taegan-openclaw`, then send a test:
   ```bash
   sudo -iu openclaw bash -c "cd taegan-openclaw && node -e \"const c=require('./src/config').getConfig(); require('./src/imessage').sendMessage(c.parent_phone, 'Taegbot email test').then(r => console.log(r ? 'SENT' : 'FAILED — see stderr'))\""
   ```

## 4. OpenClaw gateway and Claude API

```bash
sudo -iu openclaw openclaw onboard --install-daemon
```

Choose **Anthropic** as the provider, paste your Anthropic API key, and pick the Claude
model to use in place of `ollama/mistral-32k`. Ollama is not needed on the VPS, and the
health check skips it when it isn't installed.

## 5. Verify

```bash
# Service status
systemctl status taegan-openclaw

# Startup log — should list routines, scrapers (6:00 AM + 3:00 PM) and health monitor
tail -30 /home/openclaw/.openclaw/logs/openclaw.stdout.log

# Health check
sudo -iu openclaw bash taegan-openclaw/scripts/health-check.sh

# Test SMS (replace with Taegan's number exactly as written in config.yaml)
sudo -iu openclaw bash -c "cd taegan-openclaw && node -e \"require('./src/imessage').sendMessage('+1TAEGANNUMBER', 'OpenClaw test from the new server — ignore').then(r => console.log(r ? 'SENT ' + r : 'FAILED — see stderr'))\""

# Watchdog cron is installed
cat /etc/cron.d/taegan-openclaw
```

## 6. Shut down the Mac Mini services

Only after the VPS has sent a test SMS and `systemctl status` shows **active (running)**.

On the **Mac**:

```bash
launchctl unload ~/Library/LaunchAgents/com.taegan.openclaw.plist
openclaw gateway stop
pgrep -fl "src/index.js" || echo "Mac app stopped"
```

If both machines run at once, Taegan gets every message twice.

## Day-to-day

| Task | Command (on VPS) |
|---|---|
| Status | `systemctl status taegan-openclaw` |
| Restart | `systemctl restart taegan-openclaw` |
| App logs | `tail -f /home/openclaw/.openclaw/logs/openclaw.stdout.log` |
| SMS log | `tail /home/openclaw/.openclaw/logs/imessage.log` |
| Watchdog restarts | `cat /var/log/taegan-watchdog.log` |
| Deploy new code | `sudo -iu openclaw git -C taegan-openclaw pull && systemctl restart taegan-openclaw` |
