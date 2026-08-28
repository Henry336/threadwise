# Morning update — Today planning Phases 1–3

Date: 28 August 2026 SGT  
Status: implemented, expanded acceptance gate passed, merged, migrated, and **live in production**.

## What changed

- **Phase 1 — dependable foundation:** Threadwise now treats planned day, deadline, and reminder as
  separate ideas. Durable task drafts support atomic multi-item capture across Individual, Group, and
  Study. Carryover is derived without cloning tasks, and brief settings default off behind an owner
  gate.
- **Phase 2 — useful interactions:** Telegram supports one review card with `Save N`, `Add more`, and
  `Edit details`, plus `/today` and focused Carryover planning. The dashboard now shares one responsive
  Today/Carryover/Deadline-watch planner across all three modes and opens exact authorized drafts.
- **Phase 3 — calm delivery and Notes:** Optional private morning/evening digests combine Personal,
  assigned Group, and Study work while respecting quiet hours and delivery idempotency. Stale drafts
  become visibly expired, Carryover asks before moving work, and private Note sessions use one
  persistent counter card with one-hour inactivity auto-save.

## Test position

- Backend: 961 tests passed, 6 intentional skips; Prisma validation, typecheck, build, focused Phase 3
  and expanded acceptance regressions, and secret scan passed.
- Dashboard: 139 tests passed; typecheck, lint, optimized build, secret scan, and browser smoke passed
  (7 passed, 1 intentional mobile command-palette skip).
- The expanded matrix is executable and green for midnight/timezone/DST boundaries, restart during
  `Add more`, update/callback replay, invalid batch rows, private-chat absence, Canvas deduplication/
  deadline preservation, quiet hours, disabled briefs, and cross-workspace access attempts.

## Release result

- Backend `0ab4c9cffced` is live on Render deployment `dep-da8et9mk1f9s73bss8i0`; the additive
  migration-before-start step completed and `/health` reports `ok: true` at that commit.
- Dashboard `eac5844` is successful on Vercel; hosted validate and browser checks are green.
- The Today owner gate is present and matches the established production owner identity. Its value is
  intentionally absent from source, logs, and documentation.
