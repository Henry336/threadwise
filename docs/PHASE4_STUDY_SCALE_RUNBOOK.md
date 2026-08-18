# Phase 4 Study scale activation runbook

This runbook covers the additive Phase 4 Study scalability migration. It does not
authorize deployment or production writes. Phase 4 is stacked on Phase 3 and cannot
be activated until Gate 3A proves a current provider backup, isolated restore, and
independent recovery of the content-encryption key.

## Shipped behavior

- Study evidence reads at most 20 sessions, 28 resource excerpts, 16 work items,
  28 Canvas excerpts, and 16 assignments. AI prompt construction remains capped at
  48,000 characters.
- Dashboard resource pages contain at most 30 previews. The legacy dashboard snapshot
  remains contract-compatible but contains at most 400 records with text fields capped at
  700 characters, never 400 full bodies. Explicit resource detail still returns the complete record.
- Resource analysis excerpts are capped at 5,000 Unicode code points; Canvas excerpts
  are capped at 1,600. Protected excerpts use the existing server-side content
  encryption policy. A readiness flag distinguishes a completed empty excerpt from a
  row awaiting backfill.
- Existing pre-backfill rows remain readable through tenant-scoped, ID-bounded fallback
  queries. Those fallback queries disappear from the steady-state path once the guarded
  backfill marks rows ready.
- Note resource writes, revisions, outgoing wiki links, and audit records commit in one
  transaction. Optimistic-concurrency conflicts commit no side effects.
- Wiki-link candidates use a GIN-indexed set of normalized targets from the changed note.
  Revision history keeps 20 distinct snapshots with bodies no larger than 100,000
  characters.

## Before activation

1. Resolve Phase 3 Gate 3A and retain its approved backup reference. Never store the
   backup identifier or encryption key in Git, logs, or this document.
2. Deploy and validate Phase 3 in its prescribed order before Phase 4.
3. Run Prisma validation, formatting check, generation, TypeScript, build, the complete
   test suite, and the production dependency audit on the exact Phase 4 commit.
4. Exercise the additive migration and backfill against synthetic staging data that
   includes empty content, long Unicode content, mixed encrypted/plaintext legacy rows,
   concurrent edits, interrupted runs, duplicate retries, and more than each documented
   payload budget.
5. Record safe aggregate evidence only: row counts, ready counts, excerpt-size maxima,
   conflict counts, query counts, payload sizes, and latency percentiles. Do not record
   note text, Canvas text, credentials, or identifiers.

## Guarded backfill

The script is dry-run only unless `--apply` is present. Apply additionally requires:

- `THREADWISE_PHASE4_STUDY_SCALE_ACK=apply-phase-4-study-scale`
- `CONTENT_ENCRYPTION_MODE=write`
- the existing `CONTENT_ENCRYPTION_KEY`
- a safe `THREADWISE_VERIFIED_BACKUP_REFERENCE`

Run `npm run db:migrate-phase4-study-scale` first. After the dry-run aggregates are
approved, run `npm run db:migrate-phase4-study-scale -- --apply` only in the controlled
environment. The job uses batches of 25, a lease, cursor checkpoints, compare-and-set
updates, a hashed backup reference, and an idempotent completion record. A concurrent
content edit stops the run safely; rerun after the edit settles.

## Activation gate

Do not activate the runtime until all of the following are true:

- every intended Study resource and Canvas material is marked excerpt-ready;
- encrypted excerpt aggregate checks pass and no plaintext duplicate was introduced;
- wiki lookup keys exist for active notes and not for non-note resources;
- bounded query, response, memory, and latency measurements pass at the agreed synthetic
  target scale;
- full bodies, search, backlinks, revisions, Telegram delivery, Canvas evidence, and
  optimistic concurrency pass behavioral smoke tests;
- no private content appears in logs or migration output.

## Rollback

Before runtime activation, rollback is code-only: do not deploy the Phase 4 branch.
After the additive schema exists, the previous runtime can ignore the new columns. If
the backfill stops, preserve its maintenance checkpoint and fix the cause; do not delete
or truncate original bodies. If the new runtime misbehaves, restore the prior runtime
while retaining additive columns and backfilled excerpts. Dropping columns or restoring
the database is an exceptional operation requiring a separately approved plan and the
proven Gate 3A backup/key controls.

## Current evidence

Local synthetic validation covers bounded preview/evidence selections, a 10,000-record
excerpt derivation budget, encrypted excerpt fields, indexed wiki targeting, revision
deduplication/retention, atomic note mutation side effects, concurrency failure, and
legacy fallback readability. Prisma validation/format/generation, TypeScript, build, all
117 test files (884 passed and 6 intentionally skipped), and a production dependency audit
with zero findings passed on the final worktree. No production database, deployment,
backfill, or load test was performed during implementation.
