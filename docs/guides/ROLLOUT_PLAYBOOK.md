# LiveWords Staged Rollout Playbook

## Scope

- Release target: mini-program + `userData` and `storyData` cloud functions.
- Required gate sequence: 5% -> 10% -> 50% -> 100%.
- Do not skip gates. Promotion only happens when all checks in the current gate pass.

## Environment Matrix (dev/staging/prod)

| Environment | Data profile | Deployment source | Required checks before promotion |
| --- | --- | --- | --- |
| dev | Synthetic and internal test data | Current working branch | `npm run verify`, `npm run smoke:userData`, `npm run smoke:storyData` |
| staging | Production-like schema with scrubbed data | Release candidate tag/commit | All dev checks + rollout validator + `npm run smoke:remote` + manual story/session sanity pass |
| prod | Real user traffic | Approved release tag only | All staging checks + `npm run smoke:remote` + phase gate checks + no active stop criteria |

## Preconditions

1. Checkout a release candidate and record immutable release metadata.
2. Run `npm run verify`.
3. Run `npm run smoke:userData && npm run smoke:storyData`.
4. Run `npm run verify:rollout`.
5. Run `npm run smoke:remote` (required for staging/prod promotion).
6. Record current production baseline metrics before opening 5% traffic.

## Phase Gate: 5%

### Entry Conditions

- All preconditions passed in staging.
- On-call owner and rollback owner are online.

### Stop Criteria

- Any `REV_CONFLICT` or typed API error rate increases by >= 1.0 percentage point vs baseline.
- Story generation hard failures exceed 2% for 5 consecutive minutes.
- New crash loop, auth failure, or data-corruption signal appears.

### Rollback Triggers

- Stop criteria threshold reached once.
- Smoke replay in prod sampling fails twice consecutively.

### Exit Criteria

- Hold for at least 30 minutes with no stop criteria hit.
- Metrics and logs remain stable.

## Phase Gate: 10%

### Entry Conditions

- 5% gate completed and signed off.

### Stop Criteria

- Any `REV_CONFLICT` or typed API error rate increases by >= 1.0 percentage point vs baseline.
- Story generation hard failures exceed 2% for 5 consecutive minutes.
- New crash loop, auth failure, or data-corruption signal appears.

### Rollback Triggers

- Stop criteria threshold reached once.
- User-visible broken core flow confirmed by on-call.

### Exit Criteria

- Hold for at least 30 minutes with no stop criteria hit.
- `npm run smoke:userData && npm run smoke:storyData` pass from release workspace.

## Phase Gate: 50%

### Entry Conditions

- 10% gate completed and signed off.

### Stop Criteria

- Any `REV_CONFLICT` or typed API error rate increases by >= 1.0 percentage point vs baseline.
- Story generation hard failures exceed 2% for 5 consecutive minutes.
- New crash loop, auth failure, or data-corruption signal appears.

### Rollback Triggers

- Stop criteria threshold reached once.
- Two or more high-severity user incidents are confirmed.

### Exit Criteria

- Hold for at least 60 minutes with no stop criteria hit.
- No unresolved high-severity incidents.

## Phase Gate: 100%

### Entry Conditions

- 50% gate completed and signed off.

### Stop Criteria

- Any `REV_CONFLICT` or typed API error rate increases by >= 1.0 percentage point vs baseline.
- Story generation hard failures exceed 2% for 5 consecutive minutes.
- New crash loop, auth failure, or data-corruption signal appears.

### Rollback Triggers

- Stop criteria threshold reached once in the first 2 hours.
- Any confirmed data integrity regression.

### Exit Criteria

- Hold for at least 120 minutes with no stop criteria hit.
- Incident channel marked stable and rollout marked complete.

## Rollback Commands: Mini Program

```bash
ROLLBACK_TAG="vX.Y.Z"
PROJECT_ROOT="$(pwd)"

git checkout "$ROLLBACK_TAG" -- miniprogram project.config.json
npm run verify
/Applications/wechatwebdevtools.app/Contents/MacOS/cli preview --project "$PROJECT_ROOT"

# If preview is correct, use the same tag/source for publish via release operator.
```

## Rollback Commands: Cloud Functions

```bash
ROLLBACK_TAG="vX.Y.Z"

git checkout "$ROLLBACK_TAG" -- cloudfunctions/userData cloudfunctions/storyData
npm run smoke:userData && npm run smoke:storyData

# Deploy rollback code using the project's function deployment channel.
# Example with CloudBase CLI (if configured in CI):
# tcb fn deploy userData --force
# tcb fn deploy storyData --force
```

## Rollback Verification Checklist

1. `npm run smoke:userData` returns exit code 0.
2. `npm run smoke:storyData` returns exit code 0.
3. Production error-rate and crash metrics return to baseline window.
4. Incident status updated with rollback tag, timestamp, and owner.
