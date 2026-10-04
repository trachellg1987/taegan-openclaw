#!/usr/bin/env bash
# start.sh — Launch Taegan OpenClaw
# Verifies dependencies, then starts the Node.js process.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$HOME/.openclaw/logs"
mkdir -p "$LOG_DIR"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [start.sh] $1" | tee -a "$LOG_DIR/cron.log"
}

log "─── Starting Taegan OpenClaw ───────────────────────────"

# ── 1. Node.js ────────────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  log "ERROR: node not found. Run: bash scripts/setup.sh"
  exit 1
fi
log "Node.js: $(node --version)"

# ── 2. npm dependencies ───────────────────────────────────────────────────────
if [ ! -d "$PROJECT_DIR/node_modules" ]; then
  log "node_modules not found — running npm install..."
  npm --prefix "$PROJECT_DIR" install --silent
fi
log "npm packages: OK"

# ── 3. Config files ───────────────────────────────────────────────────────────
if [ ! -f "$PROJECT_DIR/.env" ]; then
  log "ERROR: .env not found. Copy .env.example → .env and fill in credentials."
  exit 1
fi
if [ ! -f "$PROJECT_DIR/config.yaml" ]; then
  log "ERROR: config.yaml not found. Copy config.yaml.example → config.yaml and fill in values."
  exit 1
fi
log "Config files: OK"

# ── 4. OpenClaw gateway (warning only — not fatal) ────────────────────────────
if curl -sf --max-time 3 http://127.0.0.1:18789/ >/dev/null 2>&1; then
  log "OpenClaw gateway: running on port 18789"
else
  log "WARNING: OpenClaw gateway not responding on port 18789 — iMessage may not work until it starts"
fi

# ── 5. Ollama (warning only) ──────────────────────────────────────────────────
if curl -sf --max-time 3 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  log "Ollama: running"
else
  log "WARNING: Ollama not responding on port 11434"
fi

# ── 5b. Cron jobs ─────────────────────────────────────────────────────────────
# node-cron schedules register inside src/index.js on startup — verify the
# scraper schedule files exist and node-cron is installed as a pre-flight.
CRON_PKG="$PROJECT_DIR/node_modules/node-cron"
SCRAPERS_FILE="$PROJECT_DIR/src/scrapers/index.js"

if [ ! -d "$CRON_PKG" ]; then
  log "ERROR: node-cron not found — run npm install"
  exit 1
fi
if [ ! -f "$SCRAPERS_FILE" ]; then
  log "ERROR: src/scrapers/index.js missing — repo may be incomplete"
  exit 1
fi

# If a prior run exists, show the last cron schedule registration from the log
CRON_LOG_FILE="$LOG_DIR/cron.log"
if [ -f "$CRON_LOG_FILE" ] && grep -q "DC-004.*SCHEDULED" "$CRON_LOG_FILE" 2>/dev/null; then
  LAST_SCHED=$(grep "DC-004.*SCHEDULED" "$CRON_LOG_FILE" | tail -1)
  log "Cron jobs: previously registered — $LAST_SCHED"
else
  log "Cron jobs: will register at startup (6:00 AM and 3:00 PM weekdays, America/Chicago)"
fi

# ── 6. Start the app ──────────────────────────────────────────────────────────
log "Launching src/index.js..."
exec node "$PROJECT_DIR/src/index.js"
