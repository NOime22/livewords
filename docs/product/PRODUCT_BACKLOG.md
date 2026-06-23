# LiveWords Product Backlog

Source of truth for implemented behavior is `docs/CURRENT_ARCHITECTURE.md`.
This backlog tracks product status without overriding architecture contracts.

## Shipped In Current Iteration

### P0: Protagonist Mode (Delivered)

- Story prompt flow injects protagonist context when available.
- Protagonist sourcing is deterministic and metadata is exposed in prompt tracing.
- Contract references: protagonist prompt mode and prompt metadata fields.

### P0: Story Revival (Delivered)

- Story expiry uses retain-and-mark, not destructive deletion.
- Expired cycle can be revived within eligibility window using bounded limit.
- Active-cycle metadata includes `expiredAt`, `reviveEligibleUntil`, `reviveCount`.

### P1: Mid-Week Choice (Delivered)

- Branch choice is available at configured mid-week boundary.
- Selected branch is immutable for that cycle.
- Conflicting resubmission returns `BRANCH_IMMUTABLE`.

## Reliability Contracts (Delivered, Product-Critical)

- Mutation idempotency via `operationId` on retry-prone write paths.
- Story optimistic concurrency via `expectedRev` with typed `REV_CONFLICT`.
- Regression and rollout verification are standardized under:
  - `npm run verify:rollout`
  - `npm run verify:regression`

## Icebox (Not Delivered)

### Funny Fail / Bad Endings

- Keep as optional P2 content variation.

### Ending Quality Based on Learning Score

- Keep as optional P2 gamification extension.
