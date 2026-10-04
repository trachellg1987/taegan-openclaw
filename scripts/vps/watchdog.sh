#!/usr/bin/env bash
# watchdog.sh — run by cron every 5 minutes (see /etc/cron.d/taegan-openclaw).
# Restarts the app if systemd reports it down, and the OpenClaw gateway if it
# stops answering on port 18789. Restarts are logged to /var/log/taegan-watchdog.log.

LOG=/var/log/taegan-watchdog.log
ts() { date '+%Y-%m-%d %H:%M:%S'; }

if ! systemctl is-active --quiet taegan-openclaw; then
  echo "$(ts) taegan-openclaw down — restarting" >> "$LOG"
  systemctl restart taegan-openclaw
fi

if ! curl -sf --max-time 5 http://127.0.0.1:18789/ >/dev/null 2>&1; then
  echo "$(ts) OpenClaw gateway not responding — restarting" >> "$LOG"
  OC_UID=$(id -u openclaw)
  sudo -u openclaw XDG_RUNTIME_DIR="/run/user/$OC_UID" \
    systemctl --user restart openclaw-gateway >> "$LOG" 2>&1 \
    || echo "$(ts) gateway restart failed — check: sudo -iu openclaw openclaw gateway status" >> "$LOG"
fi
