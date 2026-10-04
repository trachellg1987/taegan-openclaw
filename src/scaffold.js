'use strict';

/**
 * Scaffolding Fade System
 *
 * Tracks Taegan's independence training stage (1–5).
 * Stages advance automatically every 30 days when compliance >= 85%.
 * Parent can manually override stage in config.yaml (scaffold_stage key).
 *
 * Stage 1: Full support — every message + escalation call if unread
 * Stage 2: Messages sent, calls only for mandatory steps (NT-005)
 * Stage 3: Messages sent, no calls unless 2+ consecutive misses
 * Stage 4: Gentle check-ins only at key moments (wake, screen-off, lights-out)
 * Stage 5: Weekly summary only — fully independent
 */

const fs = require('fs');
const path = require('path');

const WORKSPACE = path.join(process.env.HOME, '.openclaw', 'workspace');
const STATE_FILE = path.join(WORKSPACE, 'scaffold-state.json');

const ADVANCE_DAYS = 30;
const ADVANCE_COMPLIANCE_THRESHOLD = 0.85;

// Stage 4 key moments — only these steps fire at stage 4
const STAGE4_STEPS = new Set(['MR-001', 'NT-005', 'NT-006']);

// Steps that always trigger escalation regardless of stage
const MANDATORY_STEPS = new Set(['NT-005']);

const STAGE_NAMES = ['', 'Full Support', 'Reduced Calls', 'Self-Managed', 'Check-Ins Only', 'Independent'];

// ─── State persistence ────────────────────────────────────────────────────────

function _loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { stage: 1, lastAdvancedAt: new Date().toISOString(), overridden: false };
  }
}

function _saveState(state) {
  fs.mkdirSync(WORKSPACE, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the current scaffold stage (1–5). Defaults to 1 if state file missing.
 */
function getScaffoldStage() {
  return _loadState().stage;
}

/**
 * Manually override the scaffold stage. Sets overridden=true to block auto-advance.
 */
function setScaffoldStage(stage) {
  if (stage < 1 || stage > 5) throw new Error(`Invalid scaffold stage: ${stage}`);
  const state = _loadState();
  state.stage = stage;
  state.overridden = true;
  _saveState(state);
}

/**
 * Clear the manual override so auto-advance resumes.
 */
function clearOverride() {
  const state = _loadState();
  state.overridden = false;
  state.lastAdvancedAt = new Date().toISOString();
  _saveState(state);
}

/**
 * Check if the stage should auto-advance.
 * Advances if: 30 days have passed AND compliance rate >= 85% AND not overridden.
 * @param {number} complianceRate - 0.0 to 1.0
 * @returns {boolean} true if stage was advanced
 */
function checkAutoAdvance(complianceRate) {
  const state = _loadState();
  if (state.overridden) return false;
  if (state.stage >= 5) return false;

  const daysSince = (Date.now() - new Date(state.lastAdvancedAt).getTime()) / (1000 * 60 * 60 * 24);

  if (daysSince >= ADVANCE_DAYS && complianceRate >= ADVANCE_COMPLIANCE_THRESHOLD) {
    state.stage = Math.min(5, state.stage + 1);
    state.lastAdvancedAt = new Date().toISOString();
    _saveState(state);
    return true;
  }
  return false;
}

/**
 * Whether a routine step should send a message at the given scaffold stage.
 */
function shouldSendAtStage(stepId, stage) {
  if (stage <= 3) return true;
  if (stage === 4) return STAGE4_STEPS.has(stepId);
  // stage 5: no individual messages
  return false;
}

/**
 * Whether a routine step should arm an escalation timer at the given stage.
 * Stage 3 consecutive-miss logic is evaluated externally (see escalation/index.js).
 */
function shouldEscalateAtStage(stepId, stage) {
  if (stage === 1) return true;
  if (stage === 2) return MANDATORY_STEPS.has(stepId);
  if (stage === 3) return true; // arm the timer; call decision made in escalation module
  if (stage === 4) return MANDATORY_STEPS.has(stepId);
  return false; // stage 5: no escalation
}

/**
 * Returns a one-line summary for the nightly parent dashboard.
 */
function getScaffoldSummaryLine() {
  const state = _loadState();
  const name = STAGE_NAMES[state.stage] || `Stage ${state.stage}`;
  const tag = state.overridden ? ' (manual)' : '';
  return `🪜 Stage ${state.stage} — ${name}${tag}`;
}

module.exports = {
  getScaffoldStage,
  setScaffoldStage,
  clearOverride,
  checkAutoAdvance,
  shouldSendAtStage,
  shouldEscalateAtStage,
  getScaffoldSummaryLine,
  STAGE4_STEPS,
  MANDATORY_STEPS,
  STAGE_NAMES,
  _loadState,
  _resetState: () => { try { fs.unlinkSync(STATE_FILE); } catch {} },
};
