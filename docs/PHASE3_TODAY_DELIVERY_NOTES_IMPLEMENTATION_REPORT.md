# Phase 3 Today delivery and Note-session implementation report

Date: 28 August 2026 SGT  
Status: implemented; expanded acceptance gate passed; paired merge and authorized release in progress.

Publication boundary: backend commit `2ac4824` and dashboard commit `e1b0150` on paired branch
`codex/phase3-today-delivery-notes`.

Short owner update: [`PHASE1_3_TODAY_MORNING_UPDATE.md`](PHASE1_3_TODAY_MORNING_UPDATE.md).

## Delivered

- One owner-gated scheduler composes the user's Personal, assigned Group, and Study work into a
  private morning plan and evening wrap-up.
- Both deliveries are independently opt-in, bounded, timezone-aware, quiet-hours-aware, empty-state
  suppressing, and idempotent per user/date/kind. They do not create task reminders.
- Personal Reminder settings contain the explicit consent and branded delivery-time controls. Group
  settings omit these private fields.
- Carryover now opens a focused decision before changing the planned day. After three carried days,
  the copy asks for an explicit fresh plan without increasing notification frequency.
- Expired task drafts atomically become inert and replace their original Telegram review card with
  `Draft expired · Nothing was saved.`
- Private Note sessions now use one persistent status card, update its exact paragraph count while
  remaining otherwise silent, and auto-save after one hour. The same card becomes the saved, canceled,
  or auto-saved result and links to the exact saved note.
- Dashboard Today routes now receive the configured owner gate from the running server.

## Data and release boundary

- Additive migration `20260828180000_phase3_today_delivery_notes` stores only the Telegram status
  message ID for an active private Note session.
- Existing exact note text, deadlines, reminders, Canvas data, and first-planned dates are unchanged.
- The feature remains fail-closed when `TODAY_FOUNDATION_OWNER_TELEGRAM_ID` is unset.
- No production database, environment setting, migration, deployment, or merge was changed.

## Validation

- Backend: Prisma format/generate/validate, TypeScript typecheck, production build, 961 tests passed
  with 6 intentional skips, focused Phase 3 and expanded acceptance regressions, and a tracked-file
  secret scan.
- Dashboard: TypeScript typecheck, lint, 139 tests, isolated optimized build, tracked-file secret scan,
  and release-artifact browser smoke with 7 passes and 1 intentional mobile skip.
- The 21st CLI was unavailable. The implementation reused the tracked `.21st` design decisions,
  Threadwise switches, fields, tokens, responsive rules, and branded accessible time picker.

## Deliberately deferred

- Shared Group digests require a separate workspace opt-in and real-user validation.
- Optional Note cleanup must be a previewed derived copy and never overwrite exact source text.
- Production migration, owner-gate configuration, deployment, and wider rollout require separate
  authorization after paired review and merge.

## Expanded acceptance gate — passed

After the implementation validation above, the owner required the complete recorded conversation to
become an executable three-level acceptance suite. Parser tests must cover plan/deadline/reminder/
ambiguity semantics. Service tests must cover atomic drafts, Carryover, delivery idempotency,
authorization, and Study deduplication. Telegram/dashboard tests must cover dialogue, button budget,
exact deep links, accessibility, and responsive behaviour.

The mandatory edge matrix is midnight and timezone changes, DST gap/overlap, restart during `Add more`,
duplicate Telegram updates and callback replay, one invalid batch item, no private bot relationship,
Canvas matching with deadline preservation, quiet hours, disabled briefings, and cross-workspace draft
or agenda access attempts. All required categories now have executable coverage. The expansion also
corrected private delivery-chat repair for existing users and exact Canvas Study planning while
preserving the provider deadline.
