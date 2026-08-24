# Phase 2 — cross-mode experience

Status: implemented on guarded branches; not merged, migrated, or deployed.

## Product behavior

- Study timetable recurrence is calendar-based for new and edited blocks: once or weekly, with an
  optional end date and exact-date exceptions. Existing week-based imported blocks remain readable
  until edited or re-imported.
- `Other` timetable blocks may carry a user-defined type label.
- Removing a recurring block supports one date, that date and all future dates, or the entire series.
- Telegram links can open an exact Study work item or resource. Standard dashboard search results
  open the selected entity instead of only navigating to its collection. Authenticated exact-entity
  endpoints ensure older records still open when they are outside the current paginated snapshot.
- Due-dated automatic reminders use a finite milestone ladder (7 days, 3 days, 1 day, 6 hours,
  2 hours, 30 minutes, and due time, with the configured final nudge included). They stop after the
  deadline or the per-task budget. Undated automatic cycles stop after three deliveries.
- Digest mode combines multiple simultaneously eligible dated tasks into one Telegram message.
- Snooze remains temporary; `Dismiss reminders` ends the automatic and custom reminder cycle for the
  selected task until it is explicitly rescheduled or restored.
- Study travel reminders persist an occurrence-level state: `READY`, `FAILED`, `SENT`, `ARRIVED`, or
  `MUTED`. The dashboard snapshot includes the newest state for each block so readiness failures can
  be surfaced without guessing from logs.

## Additive database changes

Migration: `prisma/migrations/20260825120000_phase2_cross_mode_experience/migration.sql`

- `StudyScheduleBlock`: `customTypeLabel`, `recurrenceStartDate`, `recurrenceEndDate`, `excludedDates`.
- `Task`: `automaticReminderCount`, `automaticReminderBudget`, `remindersDismissedAt`.
- New `StudyTravelReminderState` occurrence ledger.

The migration does not rewrite or remove existing rows. It must follow the normal backup, isolated
restore, Prisma validation, and production migration approval gates recorded in `PROJECT_CONTEXT.md`.

## Rollback

Revert the Phase 2 backend and dashboard commits. The additive database columns/table may remain
dormant; no destructive rollback is required. Do not drop them until a later explicitly approved
cleanup confirms no deployed code depends on them.

## Validation

- Prisma format, generation, and validation passed.
- Backend typecheck and production build passed; 66 focused tests and the complete sequential suite
  passed (917 tests passed, 6 intentionally skipped).
- Dashboard typecheck, ESLint, all 127 tests, and an isolated optimized production build passed.
- Secret scans passed for all 400 tracked backend files and 151 tracked dashboard files.
- The isolated dashboard build output was removed after validation. No production database, deployed
  service, or live build directory was modified.
