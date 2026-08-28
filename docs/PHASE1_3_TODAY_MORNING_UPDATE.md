# Morning update — Today planning Phases 1–3

Date: 28 August 2026 SGT  
Status: implemented, expanded acceptance gate passed, and production release authorized; **release in progress**.

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

## What happens next

1. Review and merge the paired `codex/phase3-today-delivery-notes` branches together.
2. Apply the authorized additive migrations and configure the owner gate without recording its value.
3. Deploy backend before dashboard and verify live health, release identity, and owner-only scope.

Until those steps finish, production behavior is unchanged.
