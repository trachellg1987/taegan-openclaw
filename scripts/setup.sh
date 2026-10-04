#!/usr/bin/env bash
# setup.sh — Install Taegan OpenClaw on a fresh Mac Mini
# Run once after cloning the repo. Takes under 30 minutes.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
HOME_DIR="$HOME"
PLIST_NAME="com.taegan.openclaw.plist"
LAUNCH_AGENTS="$HOME_DIR/Library/LaunchAgents"

# ── Helpers ───────────────────────────────────────────────────────────────────
log()    { echo "  → $1"; }
header() { echo ""; echo "━━━ $1 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; }
warn()   { echo "  ⚠  $1"; }
ok()     { echo "  ✓  $1"; }

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║    Taegan OpenClaw — Setup                   ║"
echo "╚══════════════════════════════════════════════╝"

# ── 1. Homebrew ───────────────────────────────────────────────────────────────
header "1/8  Homebrew"
if ! command -v brew >/dev/null 2>&1; then
  log "Installing Homebrew (this may take a few minutes)..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Add Homebrew to PATH for Apple Silicon Macs
  if [ -f /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  fi
  ok "Homebrew installed"
else
  ok "Homebrew already installed: $(brew --version | head -1)"
fi

# ── 2. Node.js ────────────────────────────────────────────────────────────────
header "2/8  Node.js"
if ! command -v node >/dev/null 2>&1; then
  log "Installing Node.js via Homebrew..."
  brew install node
  ok "Node.js installed: $(node --version)"
else
  NODE_MAJOR=$(node --version | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_MAJOR" -lt 18 ]; then
    warn "Node.js $(node --version) found but version 18+ required. Upgrading..."
    brew upgrade node || brew install node
  fi
  ok "Node.js: $(node --version)"
fi

# ── 3. npm dependencies ───────────────────────────────────────────────────────
header "3/8  npm packages"
npm --prefix "$PROJECT_DIR" install
ok "npm packages installed"

# ── 4. Playwright browser ────────────────────────────────────────────────────
header "4/8  Playwright (Chromium)"
log "Downloading Chromium (one-time, ~150 MB)..."
npx --prefix "$PROJECT_DIR" playwright install chromium 2>&1 | grep -E "Downloading|chromium" || true
ok "Chromium installed"

# ── 5. Workspace directories ─────────────────────────────────────────────────
header "5/8  Workspace directories"
mkdir -p "$HOME_DIR/.openclaw/workspace/snapshots"
mkdir -p "$HOME_DIR/.openclaw/logs"
ok "~/.openclaw/workspace/ and ~/.openclaw/logs/ ready"

# ── 6. Config files ───────────────────────────────────────────────────────────
header "6/8  Configuration files"
if [ ! -f "$PROJECT_DIR/.env" ]; then
  cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
  warn ".env created — YOU MUST fill in credentials before starting"
  warn "  nano $PROJECT_DIR/.env"
else
  ok ".env already exists"
fi

if [ ! -f "$PROJECT_DIR/config.yaml" ]; then
  cp "$PROJECT_DIR/config.yaml.example" "$PROJECT_DIR/config.yaml"
  warn "config.yaml created — YOU MUST fill in phone numbers and schedule"
  warn "  nano $PROJECT_DIR/config.yaml"
else
  ok "config.yaml already exists"
fi

# ── 7. LaunchAgent ────────────────────────────────────────────────────────────
header "7/8  LaunchAgent (auto-start on reboot)"
mkdir -p "$LAUNCH_AGENTS"
PLIST_SRC="$SCRIPT_DIR/$PLIST_NAME"
PLIST_DEST="$LAUNCH_AGENTS/$PLIST_NAME"

# Patch __PROJECT_DIR__ and __HOME__ placeholders
sed "s|__PROJECT_DIR__|$PROJECT_DIR|g; s|__HOME__|$HOME_DIR|g" \
  "$PLIST_SRC" > "$PLIST_DEST"

# Unload first in case it was previously installed
launchctl unload "$PLIST_DEST" 2>/dev/null || true
launchctl load "$PLIST_DEST" 2>/dev/null && ok "LaunchAgent installed and loaded" \
  || warn "LaunchAgent install failed — try: launchctl load $PLIST_DEST"

# ── 8. Run tests ──────────────────────────────────────────────────────────────
header "8/8  Verification"
chmod +x "$SCRIPT_DIR/start.sh" "$SCRIPT_DIR/health-check.sh"
if npm --prefix "$PROJECT_DIR" test --silent; then
  ok "All tests pass"
else
  warn "Some tests failed — check output above before starting"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  Setup complete!                                         ║"
echo "║                                                          ║"
echo "║  Required before starting:                               ║"
echo "║    1. nano $PROJECT_DIR/.env"
echo "║       Add Twilio, ElevenLabs, ClassLink credentials      ║"
echo "║    2. nano $PROJECT_DIR/config.yaml"
echo "║       Add Taegan's phone, parent phone, schedule         ║"
echo "║                                                          ║"
echo "║  Then start:                                             ║"
echo "║    bash $PROJECT_DIR/scripts/start.sh                    ║"
echo "║                                                          ║"
echo "║  The app will auto-start on every reboot.                ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
