# Phase 3 privacy remediation runbook

## Current release state

The implementation is complete and locally validated, but it is not authorized for production
activation until Gate 3A passes. The migration is additive; legacy columns remain available during
mixed-state reads. No production content was rewritten or deleted while building this phase.

## Gate 3A — mandatory before production apply

An operator must record all three facts without copying secrets or private data into Git or logs:

1. A current provider backup exists and has a stable, non-secret reference.
2. That backup has been restored into an isolated environment and basic schema/data checks pass.
3. The exact production `CONTENT_ENCRYPTION_KEY` is independently recoverable from the approved
   secret store. Compare only a locally computed non-secret fingerprint if verification is needed.

If any fact is unknown, stop. An application commit, successful test, or deployment authorization
does not prove recoverability.

## Deployment order

1. Review and merge the additive schema/runtime change only after Gate 3A.
2. Deploy with the current key and `CONTENT_ENCRYPTION_MODE=write`.
3. Verify health, ordinary reads, edits, search, Study analysis, and Idea analysis.
4. Run the aggregate Phase 2 inspector again. Never emit row content or identifiers.
5. Run `npm run db:migrate-phase3-privacy` in dry-run mode.
6. In a trusted one-off environment, set a safe non-secret backup reference and
   `THREADWISE_PRIVACY_MIGRATION_ACK=apply-phase-3-privacy`, then run
   `npm run db:migrate-phase3-privacy -- --apply`. Do not store values in documentation.
7. Re-run aggregate inspection and representative search/edit/analysis tests.
8. Run `npm run db:enforce-privacy-retention` in dry-run mode and review aggregate counts.
9. Set `THREADWISE_PRIVACY_RETENTION_ACK=apply-phase-3-retention` with the same verified backup
   reference, then run `npm run db:enforce-privacy-retention -- --apply` only after step 7 passes.

Both apply commands also require the existing write-mode encryption configuration and key.

## Safety and restart behavior

- Both utilities default to dry-run and require write-mode encryption, the key, an exact explicit
  acknowledgement, and a syntactically safe backup reference before apply.
- The backup reference is stored only as SHA-256. Checkpoints contain target names, cursors,
  aggregate counters, leases, and safe error codes—not private content.
- Apply batches are limited to 25. Content rewrites compare both row id and `updatedAt`; a live edit
  causes a safe stop. Rerunning resumes from the durable checkpoint.
- Only one active worker of each kind can exist. Expired leases may be reclaimed.
- Search-token backfill replaces the complete array and is idempotent.
- Retention removes failed/abandoned jobs after 14 days, minimizes completed diagnostics after 7
  days, removes superseded completed results after 30 days while preserving the newest successful
  result per scope, retains pending suggestions, and removes reviewed suggestions after 30 days.
- Completed Study evidence is reduced to encrypted citation metadata needed by the dashboard;
  high-detail text, editable note bodies, graph edges, and original prompts are removed.

## Rollback

Before backfill or retention, rollback is the prior runtime release because the schema is additive.
After content rewriting or deletion, rollback requires the verified backup and the preserved
encryption key. Disabling write mode does not decrypt rows. Never remove legacy columns in this
phase; consider that only after mixed-state verification and a separately approved migration.

## Validation record required for activation

Record commit, deployment, backup reference hash, isolated-restore date, key-recovery confirmation,
dry-run aggregate counts, maintenance-run aggregate counters, product smoke tests, and final
aggregate privacy inspection. Do not record private row ids, values, ciphertext, blind tokens, or
secrets.
