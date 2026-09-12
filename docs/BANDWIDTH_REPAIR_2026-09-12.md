# September 12 outbound-bandwidth repair

## Evidence and root cause

The deployed v0.35.3 worker was healthy, but an aggregate-only production query found 49 pending
Calendar links under a workspace labelled SYNCED. Its last successful sync remained September 11
01:10:23 UTC while every pending retry timestamp advanced each minute. The scheduler captured `now`,
then upserted each link with a later `new Date()`, then selected only links due by the earlier `now`.
The unchanged workspace flag made the next scheduler pass repeat this indefinitely.

A reproduction against deployed compiled code made 147 link writes across three passes and processed
zero events. A 65-second production query-counter sample straddled two 49-link sweeps. The steady rate
was 2,940 upserts/hour, at least 3.45 MB/hour of SQL text before parameters/protocol/TLS. This is a
confirmed functional bug and waste source, not a measurement of its total network contribution.

The separate realtime revision executes 15 SQL queries for a Study owner. A connected owner previously
caused one pass every 2.5 seconds (21,600 SQL queries/hour). Owners share watchers across their tabs.
Hidden tabs retained streams and one-minute full-snapshot timers. Study diagnostic heartbeats bumped
the workspace updatedAt revision every minute even without user changes. Bandwidth spikes correlated
with dashboard response traffic, but no per-destination packet capture was available: exact attribution
of every byte remains unproven.

## Repair and expected cost bounds

- Backend v0.35.4 atomically claims/bulk-queues reconciliation and preserves pending/failed retries.
  Newer link versions cannot be overwritten by an older in-flight request's completion. Removed links
  stay removed. Snapshot counts override stale success flags. Retry exhaustion has actionable copy.
- Backend revision polling is 30 seconds: 120 recurring passes/hour, 91.7% fewer than before. It excludes
  reminder-health timestamps but observes semantic settings, content aggregates, Study audits, and
  Calendar status. The transmitted revision is a fixed-size opaque hash.
- Dashboard v0.10.2 shares a tested sync lifecycle: zero recurring work while hidden/offline, prompt
  reconciliation on return/reconnect, five-minute visible fallback, and coalesced focus/visibility.
  Explicit mutations and note autosave retain their existing behavior. External changes may take up
  to 30 seconds to appear while visible; temporal-only details reconcile within five minutes.

No schema migration, secret rotation, data deletion, hosting-plan change, or new provider was needed.
Reconciliation still checks Google periodically so provider-side edits/deletions are repaired; it does
not skip provider checks based solely on a local hash. This release does not promise zero network use.

## Validation and rollout

Targeted executable tests cover elapsed-clock queue progress, recovery from the production-shaped
state, preserved backoff/exhaustion, in-flight edits, overlapping worker passes, missing/removed links,
empty/disabled workspaces, semantic versus diagnostic revisions, per-owner watcher sharing, hourly
request budgets, hidden/offline transitions, stream recovery, stale callbacks, and full cleanup.
Run complete backend/dashboard tests, types, builds, dashboard lint, and tracked-secret scans before
release. Record exact deployment versions and live aggregate follow-up in PROJECT_CONTEXT.md.

Deploy the backend first, then the dashboard. A hard refresh loads the new browser lifecycle; old
already-open tabs retain their old timer until refreshed, but receive the backend polling reduction.
Verify that the 49-link pending queue drains over bounded scheduler batches and that statuses/last
success advance. Sample only aggregate query counters, status counts, and machine-safe errors.

## Monitoring and billing interpretation

Render labels hourly points with the END of the measurement hour and publishes about an hour later.
Use complete windows, recording timestamps in Asia/Singapore. Compare NAT/service-initiated traffic
against both the recent ~14.3 MB/hour idle floor and the earlier 8–9 MB/hour post-first-fix baseline.
Do not declare the incident resolved from tests or deployment health alone.

The previous under-10 MB/hour healthy threshold was too generous for a 5 GB/month allowance: 8–9 MB/h
projects to 5.76–6.48 GB in 30 days. The total budget is approximately 6.94 MB/h, with lower operational
targets needed for headroom and other services. Render currently lists $0.15/GB excess bandwidth;
14 GB total against 5 GB included would mean about $1.35 bandwidth overage, excluding other charges.
Check the actual workspace invoice rather than describing this as an unlimited financial emergency.

Sources: https://render.com/docs/service-metrics and https://render.com/docs/outbound-bandwidth.
