#!/usr/bin/env bash
# setup-vps.sh — Install Taegan OpenClaw on a fresh Ubuntu 24.04 VPS.
#
# Run as root on the VPS:
#   curl -fsSL -o setup-vps.sh https://raw.githubusercontent.com/... (or scp it over)
#   bash setup-vps.sh
#
# Safe to re-run. Does NOT start the app until .env and config.yaml exist.

set -euo pipefail

APP_USER=openclaw
APP_HOME=/home/$APP_USER
PROJECT_DIR=$APP_HOME/taegan-openclaw
REPO_URL=https://github.com/trachellg1987/taegan-openclaw.git
OPENCLAW_VERSION=2026.9.7

ok()   { echo "  ✓ $1"; }
step() { echo ""; echo "── $1"; }

[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo bash $0"; exit 1; }

step "1. System packages and timezone"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ca-certificates cron ufw >/dev/null
timedatectl set-timezone America/Chicago
ok "git, curl, cron installed; timezone America/Chicago"

step "2. Firewall (SSH + Twilio webhook — gateway stays on localhost)"
ufw allow OpenSSH >/dev/null
ufw allow 8080/tcp >/dev/null
ufw --force enable >/dev/null
ok "ufw enabled"

step "3. Node.js 22"
if ! node --version 2>/dev/null | grep -q '^v22\.'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
ok "Node $(node --version), npm $(npm --version)"

step "4. App user '$APP_USER'"
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$APP_USER"
fi
loginctl enable-linger "$APP_USER"   # lets the OpenClaw gateway user service run without a login
sudo -u "$APP_USER" mkdir -p "$APP_HOME/.openclaw/workspace/snapshots" "$APP_HOME/.openclaw/logs"
ok "user ready, ~/.openclaw created"

step "5. Clone repo"
if [ ! -d "$PROJECT_DIR/.git" ]; then
  echo "  GitHub will ask for a username (trachellg1987) and a token as the password."
  sudo -u "$APP_USER" git clone "$REPO_URL" "$PROJECT_DIR"
else
  sudo -u "$APP_USER" git -C "$PROJECT_DIR" pull --ff-only
fi
ok "code at $PROJECT_DIR"

step "6. npm dependencies and Playwright Chromium"
sudo -u "$APP_USER" bash -c "cd '$PROJECT_DIR' && npm ci --no-audit --no-fund"
(cd "$PROJECT_DIR" && npx --yes playwright install-deps chromium >/dev/null)
sudo -u "$APP_USER" bash -c "cd '$PROJECT_DIR' && npx playwright install chromium"
ok "dependencies installed"

step "7. OpenClaw $OPENCLAW_VERSION"
npm install -g "openclaw@$OPENCLAW_VERSION" --no-audit --no-fund >/dev/null
ok "openclaw $(openclaw --version 2>/dev/null || echo installed)"

step "8. Tests"
sudo -u "$APP_USER" bash -c "cd '$PROJECT_DIR' && npm test 2>&1 | grep -E '^(Tests|Test Suites):'"

step "9. systemd service and watchdog cron"
cp "$PROJECT_DIR/scripts/vps/taegan-openclaw.service" /etc/systemd/system/taegan-openclaw.service
cp "$PROJECT_DIR/scripts/vps/taegan-openclaw.cron" /etc/cron.d/taegan-openclaw
chmod 644 /etc/cron.d/taegan-openclaw
chmod +x "$PROJECT_DIR/scripts/vps/watchdog.sh" "$PROJECT_DIR/scripts/"*.sh
systemctl daemon-reload
systemctl enable taegan-openclaw >/dev/null
ok "taegan-openclaw enabled at boot; watchdog every 5 min"

step "10. Secrets"
MISSING=0
for f in .env config.yaml; do
  if [ -f "$PROJECT_DIR/$f" ]; then
    chown "$APP_USER:$APP_USER" "$PROJECT_DIR/$f"; chmod 600 "$PROJECT_DIR/$f"
    ok "$f present"
  else
    echo "  ✗ $f missing — copy it from the Mac (see DEPLOYMENT-VPS.md)"; MISSING=1
  fi
done

if [ "$MISSING" -eq 0 ]; then
  systemctl restart taegan-openclaw
  sleep 3
  systemctl --no-pager status taegan-openclaw | head -5
else
  echo ""
  echo "Service is enabled but NOT started. Copy .env and config.yaml, then run:"
  echo "  sudo systemctl start taegan-openclaw"
fi

echo ""
echo "Next: set up the OpenClaw gateway as the app user:"
echo "  sudo -iu $APP_USER openclaw onboard --install-daemon"
