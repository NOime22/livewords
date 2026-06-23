// =============================================================================
//  LiveWords · fetchStory Cloud Function (Public Showcase Stub)
// =============================================================================
//
//  ⚠️  This is a PUBLIC, REDACTED version of the fetchStory cloud function.
//
//      The original file in the private repo is an internal eval helper that
//      drives admin-only batch evaluation flows (e.g. auto-generating all 7
//      episodes for a single eval run, reading raw `story_eval_runs` records).
//      It is NOT part of the user-facing runtime.
//
//      It depends on private modules (e.g. scripts/story-eval/admin-auth) that
//      are intentionally not published. To avoid confusing readers with a
//      broken require path, the body is replaced with a stub that throws.
//
//  📖  Architecture reference: docs/architecture.md
//
// =============================================================================

'use strict';

exports.main = async () => {
  return {
    ok: false,
    code: 'NOT_AVAILABLE_IN_PUBLIC_BUILD',
    message:
      'fetchStory is an admin/eval helper. Its full implementation, including ' +
      'admin authentication and batch-eval orchestration, is intentionally not ' +
      'published. See docs/eval-methodology.md for the methodology overview.',
  };
};
