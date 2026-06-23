# LiveWords Docs Entry

Start here for current behavior and verification policy.

## Recommended Read Order

1. `docs/CURRENT_ARCHITECTURE.md` (authoritative source of truth)
2. `docs/guides/CONTENT_QUALITY.md` (story content and metadata contracts)
3. `docs/guides/TESTING_GUIDE.md` (verification commands and invariants)
4. `docs/product/PRODUCT_BACKLOG.md` (delivery status and remaining backlog)
5. `docs/guides/ROLLOUT_PLAYBOOK.md` (staged rollout and rollback controls)

## Critical Verification Commands

- `npm run verify`
- `npm run verify:rollout`
- `npm run verify:regression`
- `npm run smoke:remote` (required before staging/prod promotion)

## Repository Documentation Map

- `docs/design/` - UI and interaction references
- `docs/guides/` - quality/testing/release operations
- `docs/product/` - product planning and backlog status
- `docs/history/` - historical notes (non-authoritative)

If there is any conflict, follow `docs/CURRENT_ARCHITECTURE.md`.
