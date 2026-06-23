// =============================================================================
//  LiveWords · storyEval mode toggle (Public Showcase Stub)
// =============================================================================
//
//  The original file is the runtime client of LiveWords' internal eval
//  workbench: it carries the rubric score fields, failure tags, fixed test
//  cases, and chain configuration that drive the in-app eval mode.
//
//  Those signals are part of LiveWords' core IP. Only the public on/off
//  toggle surface is kept here so the rest of the codebase still links.
//
//  📖  Methodology overview: docs/eval-methodology.md
//
// =============================================================================

const EVAL_MODE_STORAGE_KEY = "storyEvalModeEnabled";

function loadEvalModeEnabled() {
  try {
    return Boolean(wx.getStorageSync(EVAL_MODE_STORAGE_KEY));
  } catch (_) {
    return false;
  }
}

function saveEvalModeEnabled(enabled) {
  try {
    wx.setStorageSync(EVAL_MODE_STORAGE_KEY, Boolean(enabled));
  } catch (_) {}
}

module.exports = {
  loadEvalModeEnabled,
  saveEvalModeEnabled,
};
