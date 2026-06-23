// =============================================================================
//  LiveWords · storyData Cloud Function (Public Showcase Stub)
// =============================================================================
//
//  ⚠️  This is a PUBLIC, REDACTED version of the storyData cloud function.
//      The full implementation contains LiveWords' core business assets:
//      prompt templates, eval rubrics, content quality policies. Those are
//      intentionally NOT published.
//
//      This file documents the runtime contracts and exported actions so the
//      architecture is reviewable, while keeping the proprietary core private.
//
//  📖  Architecture reference: docs/architecture.md
//  📖  Story engine design:    docs/story-engine.md
//
// =============================================================================

'use strict';

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// -----------------------------------------------------------------------------
// 1. NoSQL Collections (see docs/architecture.md §2 for full schema)
// -----------------------------------------------------------------------------
//
//   users                    — user profile + activeStory state (single source
//                              of truth for live cycle, with monotonic `rev`)
//   user_words               — per-user word mastery state
//   dictionary               — shared word dictionary (CEFR-tagged)
//   story_episode_drafts     — generation drafts (status: generating|ready|failed)
//   story_draft_retry_queue  — lease-based retry queue, timer-driven
//   story_user_ops           — operation-level idempotency records
//   story_archive            — completed cycles archive
//   gen_logs                 — generation observability log
//
// -----------------------------------------------------------------------------
// 2. Runtime Contracts (authoritative — see docs/architecture.md)
// -----------------------------------------------------------------------------
//
//   2.1 Idempotent mutations
//       Every retry-prone mutation accepts `operationId` and replays the
//       previously persisted response instead of writing twice.
//
//   2.2 Optimistic concurrency
//       Story progression writes require `expectedRev`. On stale revision,
//       returns typed error code `REV_CONFLICT` and does NOT mutate state.
//
//   2.3 Retain-and-mark expiry + bounded revival
//       Expired stories are marked, not deleted. One bounded revival per
//       cycle, gated by `reviveEligibleUntil` and `reviveCount`.
//
//   2.4 Protagonist Mode
//       Story prompts inject a protagonist deterministically:
//         cycle.protagonist → users.nickName → fallback
//
//   2.5 Mid-week branch immutability
//       At configured boundary, first valid choice persists `selectedBranch`.
//       Conflicting resubmission → typed code `BRANCH_IMMUTABLE`.
//
//   2.6 Admin-gated eval/retry paths
//       `devOpenid` only applies to eval allowlist actions, gated by
//       `ENABLE_DEV_OPENID=1` plus HMAC `adminAuth`. Normal client invocation
//       of `processDraftRetryQueue` → `FORBIDDEN_ACTION`.
//
// -----------------------------------------------------------------------------
// 3. Story Generation Pipeline (high-level)
// -----------------------------------------------------------------------------
//
//   Episode N generation:
//     ┌────────────────────────────────────────────────────────────┐
//     │ ensureEpisodeDraft({ episodeIndex, operationId, ... })     │
//     │   ↓                                                        │
//     │ startOrResumeEpisodeDraft()                                │
//     │   ↓                                                        │
//     │ buildStorySafePrompt(vibe, history, targetWords, cefr, N)  │ ← redacted
//     │   ↓                                                        │
//     │ generateStoryParagraph(...)  → LLM call                    │ ← redacted
//     │   ↓ (validate JSON + mixed-token policy + word coverage)  │
//     │ repair() if needed, else mark `failed`                     │
//     │   ↓                                                        │
//     │ persist draft → commitEpisodeDraft() with operationId      │
//     └────────────────────────────────────────────────────────────┘
//
//   Hard constraints (enforced in prompt + validator):
//     • Episodes 1..6 → cliffhanger required
//     • Episode 7    → finale required
//     • All target words must appear (allow morphological variants)
//     • Non-target English in mixed output is policy-restricted
//     • Output must parse as single-line JSON
//
//   Quality control:
//     • promptMeta with episodeIndexRequested / historyEpisodesUsed /
//       flowOk / mismatchReasons / systemPromptSha1 / userPromptSha1
//     • Pluggable writing skills via `story_prompt_skills` collection
//
// -----------------------------------------------------------------------------
// 4. Exported Actions (the cloud function entry routes on `action`)
// -----------------------------------------------------------------------------
//
//   Story lifecycle:
//     • startStoryCycle           — begin a new 7-episode cycle
//     • ensureEpisodeDraft        — idempotent draft request for episode N
//     • commitEpisodeDraft        — finalize a ready draft into activeStory
//     • submitBranchChoice        — mid-week branch selection (immutable)
//     • reviveExpiredStory        — bounded revival of expired cycle
//     • archiveStory              — move completed cycle into story_archive
//
//   Read paths:
//     • getActiveStory            — current cycle state for client
//     • getEpisodeDraft           — draft inspection
//     • listArchive               — paginated archive
//
//   Admin / eval (HMAC-gated):
//     • processDraftRetryQueue    — timer-driven retry processor
//     • evalRun*                  — eval pipeline entry points
//
// -----------------------------------------------------------------------------
// 5. Entry Point
// -----------------------------------------------------------------------------

exports.main = async (event /* , context */) => {
  // In the full implementation, this dispatches `event.action` to the handlers
  // documented above. Each handler enforces the contracts in §2 (operationId
  // dedup, expectedRev concurrency, admin auth where applicable) and reports
  // back a typed result envelope.
  //
  // Source for this stub: see project README — full implementation kept
  // private. For collaboration access, contact the maintainer.

  return {
    ok: false,
    code: 'PUBLIC_SHOWCASE_STUB',
    message:
      'This is a redacted public version of storyData. The proprietary core ' +
      '(prompts, eval rubrics, content policy) is intentionally not published. ' +
      'See README.md for context.',
    action: event && event.action,
  };
};
