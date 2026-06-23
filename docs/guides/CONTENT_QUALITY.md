# LiveWords Content Quality Guide (Story Mode)

Architecture source of truth: `docs/CURRENT_ARCHITECTURE.md`.

## 1. Input Contract

For episode `N`, generation context must include:

- Stable cycle vibe/theme context
- Current episode target words snapshot
- Continuity history from episodes `1..N-1`

Episode endings:

- Episodes `1..6`: cliffhanger required
- Episode `7`: finale required

## 2. Output Contract

Model output must parse as JSON and include:

```json
{"paragraph":{"english":"...","mixed":"..."},"state":{}}
```

Required fields:

- `paragraph.english`: English narrative output
- `paragraph.mixed`: Chinese narrative with controlled English-token policy

## 3. Controlled Mixed-Token Policy

- Target vocabulary words must remain in English tokens inside mixed content.
- Non-target English tokens are restricted and validated.
- Validation failure triggers repair flow; unrecoverable failures mark draft `failed`.

## 4. Continuity and Context Metadata

`story_episode_drafts.promptMeta` is required for flow observability and QA.

Required metadata anchors:

- Revision/flow checks: `episodeIndexRequested`, `historyEpisodesUsed`, `missingEpisodes`, `flowOk`
- Protagonist metadata: `protagonist`, `protagonistSource`
- Context flags:
  - `contextFlags.protagonistMode`
  - `contextFlags.revivalActive`
  - `contextFlags.revivalEligible`
  - `contextFlags.branchPlanned`

Notes:

- Protagonist mode metadata must represent actual prompt behavior.
- Branch context metadata is used for post-choice continuity checks.
- Revival flags must align with retain-and-mark lifecycle state.

## 5. Lifecycle-Aligned Content Rules

Content generation must align with story lifecycle invariants:

- Expired cycles remain retained and can be inspected for eligible revival.
- Revival transitions are bounded by revival count and eligibility window.
- Mid-week choice path is immutable after selection (`BRANCH_IMMUTABLE` on conflict).

## 6. QA Hooks

Recommended command-level checks:

- `npm run smoke:storyData`
- `node scripts/smoke/storyData.js --case quality-context`
- `npm run verify:regression`
