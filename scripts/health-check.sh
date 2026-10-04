#!/usr/bin/env bash
# health-check.sh — Verify Taegan OpenClaw is healthy
# Exits 0 if all checks pass, 1 if any fail.
# Also used by src/health-monitor.js for automated 5-minute checks.

PASS=0
FAIL=0
DETAILS=()

ok()   { echo "  [OK]   $1"; PASS=$((PASS+1)); }
fail() { echo "  [FAIL] $1"; FAIL=$((FAIL+1)); DETAILS+=("$1"); }

echo ""
echo "Taegan OpenClaw — Health Check  $(date '+%Y-%m-%d %H:%M:%S')"
echo "────────────────────────────────────────────"

# ── 1. OpenClaw gateway port 18789 ────────────────────────────────────────────
if curl -sf --max-time 3 http://127.0.0.1:18789/ >/dev/null 2>&1; then
  ok "OpenClaw gateway (port 18789)"
else
  fail "OpenClaw gateway — not responding on port 18789"
fi

# ── 2. Ollama (only when installed — skipped on the VPS, which uses the Claude API)
if ! command -v ollama >/dev/null 2>&1; then
  echo "  [SKIP] Ollama — not installed (using hosted model)"
elif curl -sf --max-time 3 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  # Check at least one model is loaded
  MODEL_COUNT=$(curl -sf http://127.0.0.1:11434/api/tags 2>/dev/null \
    | node -e "let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{ \
        try{const m=JSON.parse(d).models; console.log(m?m.length:0)}catch{console.log(0)} \
      })" 2>/dev/null || echo "0")
  if [ "$MODEL_COUNT" -gt 0 ]; then
    ok "Ollama ($MODEL_COUNT model(s) loaded)"
  else
    fail "Ollama — running but no models loaded"
  fi
else
  fail "Ollama — not responding on port 11434"
fi

# ── 3. Last scraper run within 24 hours (72h Sat–Mon: scrapers run weekdays only)
MAX_AGE_HOURS=24
case "$(TZ=America/Chicago date +%u)" in
  6|7|1) MAX_AGE_HOURS=72 ;;
esac
CANVAS_FILE="$HOME/.openclaw/workspace/canvas-data.json"
if [ -f "$CANVAS_FILE" ]; then
  SCRAPED_AT_MS=$(node -e "
    try {
      const d = require('$CANVAS_FILE');
      console.log(new Date(d.scrapedAt).getTime());
    } catch { console.log(0); }
  " 2>/dev/null || echo "0")
  NOW_MS=$(node -e "console.log(Date.now())" 2>/dev/null || echo "0")
  if [ "$SCRAPED_AT_MS" -gt 0 ] && [ "$NOW_MS" -gt 0 ]; then
    AGE_HOURS=$(( (NOW_MS - SCRAPED_AT_MS) / 3600000 ))
    if [ "$AGE_HOURS" -lt "$MAX_AGE_HOURS" ]; then
      ok "Last scraper run (${AGE_HOURS}h ago)"
    else
      fail "Last scraper run — stale (${AGE_HOURS}h ago, expected < ${MAX_AGE_HOURS}h)"
    fi
  else
    fail "Last scraper run — could not parse canvas-data.json timestamp"
  fi
else
  fail "Last scraper run — canvas-data.json not found (scrapers have not run yet)"
fi

# ── 4. Node.js process running ────────────────────────────────────────────────
if pgrep -f "src/index.js" >/dev/null 2>&1; then
  ok "OpenClaw Node.js process"
else
  fail "OpenClaw Node.js process — not found (is the app started?)"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo "────────────────────────────────────────────"
echo "Result: $PASS passed, $FAIL failed"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "Failed checks:"
  for d in "${DETAILS[@]}"; do echo "  • $d"; done
  echo ""
  exit 1
fi

exit 0
