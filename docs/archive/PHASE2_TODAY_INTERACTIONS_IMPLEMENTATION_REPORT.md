# Phase 2 Today interactions implementation report

Date: 28 August 2026 SGT  
Status: implemented and validated on paired guarded branches; not merged or deployed.

## Delivered

- Telegram supports owner-gated batch task capture across Individual, Group, and Study with one
  durable review card, `Add more`, focused edits, exact dashboard editing, atomic save, and expiry.
- `/today`, `/todo`, and `/todos` show Today, Carryover, and Deadline watch. Carryover can be moved to
  Today without changing the task deadline or its first planned date.
- Re-planning writes an audit record. Creating planned work still creates no reminder.
- Personal, Group, and Study overviews share one responsive Today planner. It supports comma-separated
  capture, inclusion toggles, plan/deadline correction, branded Study module choice, all-or-nothing
  saving, and one-tap carryover planning.
- The dashboard proxy accepts only the exact new Today/draft paths and methods. Existing behaviour is
  preserved when the owner-gated backend returns unavailable.

## Guardrails

- `TODAY_FOUNDATION_OWNER_TELEGRAM_ID` remains the fail-closed owner gate.
- Natural task capture is deterministic and does not require an AI provider.
- Planned day, deadline, reminder, note, and timetable semantics remain separate.
- No schema migration, production configuration, deployment, or scheduled delivery was run.

## Validation

- Backend: TypeScript typecheck, production build, focused Today regressions, full suite (934 passed,
  6 intentional skips), tracked-secret scan, and diff checks.
- Dashboard: TypeScript typecheck, lint, focused regressions, full suite (138 passed), optimized build,
  and browser smoke (5 passed, 1 intentional mobile skip).
- The local 21st CLI was not installed. The UI therefore used the tracked `.21st` decisions, existing
  Threadwise components, tokens, typography, responsive rules, and branded accessible pickers.

## Phase 3 boundary

Scheduled morning/evening deliveries, proactive expiry-card replacement, richer carryover prompting,
and private Note-session refinements remain out of scope. They require separate authorization.

Subsequent status (28 August 2026 SGT): those items were separately authorized and implemented on the
paired guarded `codex/phase3-today-delivery-notes` branches. See
[`PHASE3_TODAY_DELIVERY_NOTES_IMPLEMENTATION_REPORT.md`](PHASE3_TODAY_DELIVERY_NOTES_IMPLEMENTATION_REPORT.md).
They remain unmerged and undeployed.
