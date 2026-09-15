# September 15 idle-egress containment

## Confirmed production behavior

The v0.35.4 Calendar queue correctly drained and reported success, but its integrity sweep still marked
all 49 settled timetable links pending every 15 minutes. Production aggregates showed a successful
49-link pass at 09:25 SGT on September 15 even though no timetable edit was pending. This meant an idle
timetable generated up to 196 Google PATCH operations per hour, plus the associated external-database
reads and writes.

The latest completed Render NAT points available during diagnosis included a sustained September 14
run between 15.16 and 21.13 MB/h. Production stayed healthy on the expected v0.35.4 deployment. A safe
55-second database counter sample measured 239 statements and about 3.12 MB/h of SQL text before wire
protocol and TLS overhead. These measurements prove avoidable recurring work; they do not attribute
every billed byte to one destination.

## v0.35.5 containment

- Local timetable mutations still enqueue the affected link immediately.
- Failed provider operations still use the existing six-attempt bounded backoff.
- Unchanged Google events are reconciled once per 24 hours, preserving repair of provider-side edits or
  deletion while reducing the former steady replay by about 99% (196/hour to about 49/day for 49 links).
- Visible dashboard owners share one revision watcher every two minutes rather than every 30 seconds.
  Same-page mutations remain immediate; Telegram/cross-device changes can take up to two minutes.

No migration, credential change, user-data deletion, Calendar-content logging, or hosting-plan change is
required. The bandwidth monitor remains authoritative after deployment because Render publishes hourly
data with delay and source attribution is aggregate-only.

## v0.35.6 Canvas follow-on

A post-v0.35.5 sample overlapped automatic Canvas synchronization and measured 1,420 database statements
in 55 seconds, with an instantaneous SQL-text rate of 31.90 MB/h. The dominant application statements
were provider-identical assignment/item updates, per-assignment week upserts, and material upserts that
resent extracted page text. v0.35.6 compares canonical fields before persistence, skips unchanged item
transactions and material upserts, and consolidates freshness timestamps into bounded bulk updates.
Actual Canvas source changes and missing/deactivation behavior still persist normally.

The final v0.35.6 gate passes 1,057 tests with 6 intentional skips, focused containment tests 16/16,
typecheck, production build, tracked-secret scan, and zero-finding production/full dependency audits.

## Release evidence

Final runtime `c50611b36a5058cc0f441199a1f09c6398b73cde` became live as v0.35.6 through Render
deployment `dep-dakabkek1f9s73fu7dog` at 09:58:03 SGT on September 15. Public health returned HTTP 200,
`ok=true`, v0.35.6, and the exact commit prefix. The Calendar queue settled with 49 links and zero
pending/failing rows. A post-release idle sample measured 133 statements over 55 seconds and an
estimated 2.50 MB/h of SQL text, versus 239 statements and 3.12 MB/h before this release.

The next natural Canvas run was due at 10:17:46 SGT. Its no-op behavior and at least two completed,
delayed Render hourly points remain required evidence; the idle SQL delta is not a billing metric.

## Release gate

Focused queue/realtime tests pass 17/17. The complete suite passes 1,056 tests with 6 intentional skips;
typecheck, production build, tracked-secret scan, and both dependency audits pass. Sharp 0.35.4 and
Vitest 4.1.11 were the minimal patched dependency updates identified by the audit. Push the exact
validated commit to `main`, wait for Render health to report
v0.35.5 and its commit prefix, confirm the Calendar queue is settled, then compare at least two completed
post-release NAT hours. Do not declare the incident resolved from code inspection alone.
