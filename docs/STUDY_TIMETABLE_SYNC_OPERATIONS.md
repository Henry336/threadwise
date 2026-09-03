# Study timetable synchronization and reminder operations

Updated: 2026-09-04 SGT

This runbook covers the owner-gated one-way Google Calendar mirror and occurrence-based Study timetable
reminders. Threadwise PostgreSQL records remain authoritative. The Calendar mirror is opt-in, and it
does not enable Telegram reminders.

## API contract

All routes use the existing dashboard service-token boundary, workspace resolution, mutation replay
protection, shared rate limiting, and private Study owner/group gate.

| Method and route | Behavior |
| --- | --- |
| `POST /api/v1/dashboard/study/calendar/connect` | Creates a 15-minute Google OAuth state and returns `{ url }`. The callback returns to the Study timetable with a bounded success/error result. |
| `POST /api/v1/dashboard/study/calendar/sync` | Enables the mirror, queues every active/inactive block, processes an initial bounded batch, and returns `{ calendar }`. |
| `POST /api/v1/dashboard/study/calendar/stop` | Disables reconciliation without deleting existing Google events and returns `{ calendar }`. |

The Study snapshot contains only a minimal `calendar` object: provider configuration/connection state,
reconnect state, optional email, enabled/status state, synced/pending/failed counts, last successful
timestamp, and a safe error. OAuth/access tokens and event payloads never enter this DTO.

## Synchronization lifecycle

- `StudyScheduleCalendarLink.blockId` is unique. Its Google event ID is deterministically derived from
  the stable block UUID, so repeated clicks, retries, and concurrent creates converge on one event.
- A local create/edit/delete-scope mutation commits first and then marks the link `PENDING`. Provider
  failure never rolls back the timetable change.
- The queue patches first, creates only after Google returns 404, and patches after create-conflict 409.
  This recovers both manual provider deletion and ambiguous timeout-after-create outcomes.
- Reconciliation requeues enabled workspaces at most once per 15-minute window. Google edits are
  replaced with the Threadwise representation; manual Google deletions are recreated.
- Retries are bounded to six attempts with exponential delay capped at 60 minutes. Stored errors are
  machine-safe codes; the workspace snapshot exposes only actionable generic copy.
- Single blocks produce one event. Weekly blocks use RRULE plus EXDATE values for occurrence/week
  exclusions. Shortening a series patches its end; deactivating the entire series removes the event.

Calendar payloads contain only title, module label, time/recurrence, venue, and a private Threadwise
block reference. Never add saved origins, coordinates, boarding stops, services, routes, travel buffers,
or preparation notes. Operational logs may contain record IDs and safe codes, never provider tokens or
Calendar contents.

## Reminder lifecycle

`StudyScheduleReminderSequence` is unique per block and UTC calendar occurrence date. The first alert is
the earlier of 45 minutes before start and the computed leave time (journey duration plus the saved
travel buffer). Missing destinations and route failures fall back to 45 minutes.

One admitted occurrence consumes one daily Study slot. It can emit at most four physical messages: the
initial alert and three five-minute follow-ups. Attempt-specific delivery keys suppress concurrent
scheduler passes and callback replay. An abandoned unsent claim advances only after a two-minute grace
period, so a restart cannot leave a sequence permanently stuck or create an unbounded resend loop.

`Got it`, `I'm here`, starting the matching Study session, or `Mute timetable today` closes applicable
sequences. Opening route details does not acknowledge. Timetable alerts may cross Study quiet hours;
other reminder kinds retain the existing quiet-hour behavior. No sequence is created or backfilled after
its block has started, and the master timetable-reminder setting remains authoritative.

## Migration and release order

1. Back up the production database using the established migration procedure.
2. Deploy backend migration `20260903190000_add_study_calendar_and_reminder_sequences` and backend code.
3. Confirm `/health` reports the intended backend version and exact commit prefix.
4. Deploy the dashboard.
5. Verify the timetable loads before connecting Calendar; synchronization must remain off by default.
6. Connect the owner account from the branded dialog, confirm automatic OAuth resume, sync twice, and
   verify exactly one event per block series.
7. Exercise one exclusion and one edit; verify the same Google event is patched. Stop syncing and verify
   existing events remain.
8. With timetable reminders explicitly enabled, verify the 45-minute floor, acknowledgement, three-
   follow-up ceiling, and no post-start backfill.

Rollback the dashboard first if its new controls fail. Backend rollback is code-only after the additive
migration; retain the new tables/columns. Stopping synchronization is the safe user-level kill switch.
Do not delete mirrored Google events as part of rollback.

## Failure triage

- `CALENDAR_AUTH_REQUIRED`: reconnect Google from the timetable.
- `CALENDAR_NOT_CONFIGURED`: verify the existing Google client, redirect URI, and token-encryption
  secret on Render; never paste their values into logs or documentation.
- `CALENDAR_PROVIDER_UNAVAILABLE`: leave sync enabled and allow bounded retry/reconciliation.
- Pending/failed counts that do not clear after six retries: inspect only link status, attempt timestamps,
  and safe codes; do not dump event bodies or decrypted connection rows.
- Reminder sequence stalled at one attempt: inspect sequence timestamps and its attempt-specific
  `StudyReminderDelivery`; never replay all reminders manually.

## Required regression coverage

Calendar tests cover deterministic IDs, one-time/weekly mapping, exclusions, privacy, DST-aware local
wall time, and patch/create conflict recovery seams. Reminder tests cover the 45-minute floor, earlier
travel departure, four-message ceiling, abandoned-claim grace, acknowledgement/mute callbacks, quiet-
hour exception, logical daily cap, and no post-start backfill. Dashboard tests cover strict overlap
intersection, adjacency, recurrence exceptions, all orientations, accessible labels/tooltips, touch
details, responsive styling, OAuth resume, and the BFF allowlist.
