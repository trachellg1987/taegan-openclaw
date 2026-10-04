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

This installs Node 22, git, Playwright Chromium and OpenClaw 2026.9.7, clones the repo,
runs the tests, and installs the systemd service and the 5-minute watchdog cron. The app
does not start yet because the secrets are missing.

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
