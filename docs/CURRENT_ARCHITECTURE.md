# LiveWords Current Architecture (Source of Truth)

This document defines the current implementation contracts for LiveWords.
If any other document conflicts with this file, this file is authoritative.

Updated: 2026-03-19

## 1. System Scope

LiveWords is a WeChat mini program with a Story Mode learning loop.

- Mini program app: `miniprogram/`
- Cloud functions: `cloudfunctions/userData`, `cloudfunctions/storyData`
- NoSQL collections: `dictionary`, `users`, `user_words`, `gen_logs`, `story_episode_drafts`, `story_draft_retry_queue`, `story_archive`, `story_user_ops`
- Verification scripts: `scripts/quality/*`, `scripts/smoke/*`

## 2. Authoritative Runtime Contracts

### 2.1 Idempotent mutations (`operationId`)

Mutation APIs that can be retried must accept `operationId` and dedupe replayed writes.

- `userData.upsertWordStatus` supports `operationId` replay safety.
- Story write paths (`commitEpisodeDraft`, branch choice submission, and related mutation routes) use operation-level dedupe with persisted operation records.
- Replayed successful mutations return a dedupe indicator instead of applying a second write.

### 2.2 Optimistic concurrency (`expectedRev` + `REV_CONFLICT`)

Story progression writes are revision-gated.

- `users.activeStory.rev` is monotonic and increments on accepted story-state mutations.
- Clients send `expectedRev` for guarded mutation paths.
- On stale revision, API returns typed conflict with code `REV_CONFLICT` and does not mutate state.

### 2.3 Expiry model: retain-and-mark + bounded revival

Expiry is non-destructive.

- Expired stories are retained in `users.activeStory` with `status: 'expired'`.
- Expiry metadata includes `expiredAt`, `reviveEligibleUntil`, and `reviveCount`.
- Revival eligibility is computed against retain-and-mark metadata.
- Revival is bounded: one revival per cycle (`reviveCount` limit).

### 2.4 Protagonist Mode and prompt metadata

Protagonist injection is enabled in Story Mode prompt construction.

- Source order is deterministic: cycle-stored protagonist -> `users.nickName` -> fallback.
- Prompt metadata records protagonist context for observability.
- `story_episode_drafts.promptMeta.contextFlags.protagonistMode` is part of the runtime contract.

### 2.5 Mid-week branch choice immutability

Branching behavior is deterministic and immutable once selected.

- Mid-week branch boundary is persisted in active cycle metadata.
- First valid choice persists `selectedBranch`.
- Conflicting second-choice submission is rejected with typed code `BRANCH_IMMUTABLE`.
- Branch context is propagated into subsequent prompt metadata.

### 2.6 Admin-gated eval and retry operations

Non-user identity paths are guarded by explicit admin auth.

- `devOpenid` is not a generic OPENID fallback; it only applies to eval allowlist actions.
- `devOpenid` requires `ENABLE_DEV_OPENID=1` plus HMAC `adminAuth` verification.
- `processDraftRetryQueue` is timer-driven by default and rejects normal client invocation with `FORBIDDEN_ACTION` unless admin-authenticated.

## 3. Story Mode Data Contracts

### 3.1 `users.activeStory`

Canonical live-cycle state is stored on user document:

- Identity and progression: `id`, `theme`, `status`, `currentEpisode`, `totalEpisodes`, `rev`
- History: ordered `history[]` episode payloads
- Lifecycle controls: `expiredAt`, `reviveEligibleUntil`, `reviveCount`
- Prompt context: protagonist and branch metadata

### 3.2 `story_episode_drafts`

Draft generation and validation records:

- Status lifecycle: `generating | ready | failed`
- Generated content: `contentEn`, `contentMixed`
- Prompt/process metadata in `promptMeta`, including `contextFlags` and revision-relevant flow signals

### 3.3 `story_user_ops`

Operation-level idempotency records for user/story mutation replay safety.

## 4. Verification Commands (Release and Regression)

The following commands are part of the release contract:

- `npm run verify`: baseline lint + tests
- `npm run verify:rollout`: rollout playbook section/gate validator
- `npm run verify:regression`: unified regression verification pack
- `npm run smoke:remote`: required release gate for staging/prod environments

## 5. Document Dependency Order

Use this order when resolving doc conflicts:

1. `docs/CURRENT_ARCHITECTURE.md` (this file)
2. `docs/guides/CONTENT_QUALITY.md`
3. `docs/guides/TESTING_GUIDE.md`
4. `docs/product/PRODUCT_BACKLOG.md`
5. `docs/README.md`
