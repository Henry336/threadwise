# Morning update — Today planning Phases 1–3

Date: 28 August 2026 SGT  
Status: implemented, tested, documented, and pushed on guarded branches; **not live yet**.

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

- Backend: 940 tests passed, 6 intentional skips; Prisma validation, typecheck, build, focused Phase 3
  regressions, and secret scan passed.
- Dashboard: 139 tests passed; typecheck, lint, optimized build, secret scan, and browser smoke passed
  (5 passed, 1 intentional mobile skip).
- A stricter acceptance matrix was added afterward. Before merge or rollout, it must add executable
  coverage for midnight/timezone/DST boundaries, restart during `Add more`, update/callback replay,
  invalid batch rows, private-chat absence, Canvas deduplication/deadline preservation, quiet hours,
  disabled briefs, and cross-workspace access attempts.

## What happens next

1. Implement and pass the expanded parser, service, and Telegram/dashboard acceptance suite.
2. Review and merge the paired `codex/phase3-today-delivery-notes` branches together.
3. Under separate authorization, apply additive migrations, configure the owner gate, and deploy.

Until those steps finish, production behavior is unchanged.
