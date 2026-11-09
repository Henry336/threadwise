# Phase 2 production privacy inspection

- Date: 17 August 2026 (SGT)
- Scope: bounded, aggregate-only inspection of the production PostgreSQL database and local
  encryption/retention implementation
- Production mutation: **none**

## Executive summary

The inspection ran inside a PostgreSQL transaction that reported
`transaction_read_only=on`. It selected no row identifiers, user/workspace/Telegram identifiers,
private text, ciphertext, blind-token values, or credentials. The server is correctly configured
for encryption writes and has a structurally valid key. New encrypted envelopes are structurally
valid, and all 26 inspected cross-workspace relationships have zero anomalies.

The main privacy risk is incomplete historical migration: only 190 of 1,116 non-null protected
field values (17.0%) are encrypted, leaving 926 historical values in plaintext. AI analysis is a
second plaintext copy of sensitive Study context and has no implemented retention cleanup. Blind
search arrays also confirm the update-append defect: one Study resource has 1,960 duplicate token
entries, while edited Task/Study records have token arrays as large as 3,324/2,777 entries.

No Phase 3 write is safe yet. The first gate is to verify an actual provider backup and perform a
restore test to an isolated target. Backup/PITR state cannot be proven from SQL, and this
environment has neither a Supabase management credential nor the Supabase CLI. The repository
contains a historical migration backup runbook, but no evidence of a current restorable backup or
recent restore exercise.

## Inspection boundary and method

- `scripts/inspect-privacy-aggregates.ts` requires the exact one-off acknowledgement
  `THREADWISE_ALLOW_PRODUCTION_PRIVACY_INSPECTION=read-only-phase-2` before constructing a client.
- It creates a direct base Prisma client, avoiding the application's automatic decryption result
  extension, then makes `SET TRANSACTION READ ONLY` its first database operation.
- A 15-second statement timeout, two-second lock timeout, one connection, repeatable-read
  isolation, and a 90-second transaction ceiling bound its impact.
- Every SQL statement is fixed in source and returns only counts, enum categories, age buckets,
  byte totals/maxima/percentiles, safe configuration booleans, or anomaly totals.
- Production confirmed PostgreSQL server version number `170006` and read-only transaction state
  `on`. This is evidence of the inspection boundary, not a claim about the database provider's
  backup configuration.

## Findings

### High — P2-01: historical protected content remains mostly plaintext

Impact: database-console access, a raw database export, or a database-only compromise can still
read most historical protected content even though new writes are encrypted.

The application is in effective `write` mode, the key is present and structurally valid, all 190
observed envelopes match the expected model/field format, and there are zero wrong-field or
malformed-prefix envelopes. Coverage is nevertheless mixed:

| Model | Encrypted non-null fields | Plaintext non-null fields | Coverage |
| --- | ---: | ---: | ---: |
| Task | 84 | 602 | 12.2% |
| Note | 8 | 276 | 2.8% |
| Idea | 11 | 17 | 39.3% |
| StoredImage | 1 | 10 | 9.1% |
| StudyResource | 86 | 21 | 80.4% |
| StudyResourceRevision | 0 | 0 | n/a |
| **Total** | **190** | **926** | **17.0%** |

The policy is defined in `src/security/contentEncryption.ts:19-26`. Mixed reads are deliberate,
but the existing historical migration has not been completed. The existing script is sequential
and dry-run-first (`scripts/migrate-content-encryption.ts:3-64`), but its apply path lacks a durable
checkpoint, concurrent-update compare-and-swap, and per-batch audit state. Those gaps must be fixed
before using it in production.

### High — P2-02: Study AI artifacts duplicate sensitive context without encryption or retention

Impact: AI prompts/evidence can preserve note-derived private material after the source changes or
is deleted, expanding both breach impact and unnecessary retention.

Production contains two failed Study connection-analysis jobs, both 1–7 days old. Together they
retain 17,903 bytes of evidence JSON, 45,270 bytes of prompts, and 157 bytes of errors (63,330
bytes total); the largest evidence/prompt values are 9,295/23,716 bytes. There are currently zero
note-edit suggestions and zero legacy Idea AI jobs.

These fields are persisted by the models at `prisma/schema.prisma:1914-1967` but are outside the
content policy. Repository searches found no delete/expiry path for `GeminiStudyAnalysisJob` or
`StudyNoteEditSuggestion`. By contrast, Study note revisions are explicitly capped at 50 per note
in `src/services/studyMarkdown.ts:5,88-94`.

Canvas page extraction is another unencrypted Study-context copy: 85 page rows hold 81,041 bytes
of extracted text (p95 2,902 bytes; maximum 7,773 bytes). Whether Canvas extraction should remain
searchable plaintext or move behind application encryption must be an explicit Phase 3 product
decision; it must not be silently treated as harmless metadata.

### Medium — P2-03: blind search tokens accumulate on updates

The implementation appends update tokens with Prisma `push` rather than replacing the complete
index (`src/security/contentEncryption.ts:170-177`). Production distributions match the expected
failure mode:

| Model | Rows | Zero-token rows | Rows over 500 | Maximum | p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Task | 229 | 201 | 10 | 3,324 | 205 |
| Note | 71 | 69 | 1 | 552 | 0 |
| Idea | 5 | 3 | 2 | 1,484 | 1,336 |
| StoredImage | 12 | 11 | 0 | 24 | 11 |
| StudyResource | 38 | 9 | 5 | 2,777 | 902 |

One Study resource contains 1,960 duplicate entries in its token array. No other inspected row has
duplicate values, but large unique arrays can still contain tokens from superseded content. This
increases database/index work and leaks a larger historical equality/frequency surface to a
database-only attacker. Zero-token rows align with historical plaintext rows, while encrypted
records have populated indexes.

### Medium — P2-04: backup, PITR, and restore readiness are unverified

SQL cannot prove provider backup state. No Supabase management token or CLI was available, and the
repository contains no dated evidence of a current backup or restore exercise. Therefore:

- current daily-backup availability: **unknown**;
- PITR enabled/retention window: **unknown**;
- last successful restore test: **not evidenced**;
- encryption-key recovery copy in an approved password manager: **requires owner confirmation**.

Current Supabase documentation says automatic daily backups depend on plan, while PITR is an
optional paid add-on; it also warns that database backups do not restore Storage API objects.
Verify the actual project in its control plane rather than inferring from those defaults:
[Supabase database backups](https://supabase.com/docs/guides/platform/backups).

### Positive controls observed

- All 190 encrypted values use the correct model/field prefix and valid envelope structure.
- All 26 inspected cross-workspace relationships report zero anomalies, covering Study modules,
  weeks, items, sessions, resources, links, Canvas records, analysis jobs, suggestions, origins,
  and workspace ownership.
- Study storage is currently modest: 31 image resources declare 2,853,935 file bytes and retain
  4,810 OCR-text bytes; seven note resources hold 4,364 stored body bytes. There are no pending
  Study captures and no note revisions yet.
- Canvas has 39 file metadata rows declaring 41,412,794 remote file bytes. These are declared
  source sizes, not 41 MB of database blobs; extracted database text is limited to the 81,041 page
  bytes described above.

## Phase 3 remediation and backfill design (not implemented)

### Gate 3A — prove recoverability first

1. In the Supabase control plane, record the plan, latest successful backup, retention window, and
   PITR status without placing credentials or project identifiers in git.
2. Create a fresh encrypted logical backup from a trusted operator environment. Because 926
   protected values are plaintext, the backup itself is sensitive and must not be committed or
   stored unencrypted.
3. Restore to a separate non-production project, verify schema/table counts and representative
   decrypt/search behavior, then destroy the isolated restore after the agreed retention window.
4. Confirm the content-encryption key has an independent recoverable copy in the approved secret
   manager/password manager. Losing it makes migrated content unrecoverable.

No migration or cleanup should begin until all four checks have evidence.

### Gate 3B — minimize and encrypt AI duplicates

- Add encrypted string storage for Study job prompt/evidence/result and suggestion original,
  proposed, rationale, and applied bodies. JSON evidence/results should be serialized with a
  versioned schema before encryption and parsed only after authenticated decryption.
- Use additive dual-read fields first. Populate encrypted fields, verify them, then redact legacy
  plaintext columns in a later separately approved step. This makes the first migration reversible
  without dropping the only copy.
- Prefer references, hashes, bounded excerpts, and safe error codes over full source copies.
- Proposed retention defaults for owner approval:
  - abandoned pending/running and failed jobs: 14 days;
  - prompt/evidence diagnostic payload after completion: 7 days;
  - superseded completed results: 30 days, while retaining only the newest successful result per
    workspace/module/mode;
  - pending suggestions: retain until reviewed or superseded; applied/rejected suggestions: 30
    days, relying on the bounded note revision for durable user history.
- Decide separately whether Canvas extracted text is encrypted-and-indexed, stored only as bounded
  excerpts, or fetched on demand. Do not include it in cleanup until search/quiz behavior is tested.

### Gate 3C — restart-safe historical encryption and blind-index rebuild

- Replace token arrays from the full current plaintext of all searchable fields; never append.
- Use a durable migration-run/checkpoint table containing only target name, last cursor, aggregate
  counts, status, timestamps, and safe error codes. Do not log row content or keys.
- Take an advisory lock so only one run can apply. Process small ordered batches with a strict
  connection/statement budget.
- For each row, decrypt if needed, compute the full replacement envelope/index, and use
  `id + updatedAt` compare-and-swap. Skip and retry concurrently changed rows instead of
  overwriting live edits.
- Make dry run report encrypted/plaintext/invalid counts and projected token changes only. Apply
  mode requires a separate acknowledgement plus the verified-backup identifier.
- Resume from the durable checkpoint after interruption; reruns must converge without duplicating
  tokens. Verify every batch before advancing its checkpoint.

### Gate 3D — bounded retention cleanup

- Implement dry-run-only first with counts/bytes by retention reason.
- Delete in restart-safe bounded batches, newest-retained selection performed inside one
  transaction, with an aggregate audit record and no private payload.
- Never delete a suggestion still needed for a pending manual review. Never delete the only latest
  saved analysis result without an approved product change.

### Gate 3E — validation and rollback

- Test mixed plaintext/ciphertext reads, missing/wrong keys, authenticated tamper failure,
  interrupted/resumed batches, concurrent edits, exact search after edits, zero/large text,
  suggestion review, Study quiz/connections, Telegram capture, dashboard edits, reminders, and
  group-mode boundaries.
- Re-run this aggregate inspection after each apply stage. Expected end state: zero historical
  plaintext in the approved policy, zero malformed envelopes, rebuilt duplicate-free token arrays,
  zero cross-workspace anomalies, and retention counts matching policy.
- Before legacy plaintext is redacted, rollback uses the additive old columns and prior release.
  After redaction/backfill, rollback requires the verified pre-migration backup plus the preserved
  key. Switching encryption mode off does not decrypt stored ciphertext.

## Explicit approval gate

Phase 2 is complete. **No Phase 3 code, schema migration, backup, backfill, retention deletion,
configuration change, credential rotation, or production write has been performed.** Phase 3
requires the user's explicit authorization and confirmation of the proposed retention policy.
Even after authorization, Gate 3A must pass before any production apply or deletion.

Recommended execution remains GPT-5.6 Sol with high reasoning for the migration implementation
and threat review. Xhigh/Ultra is not warranted by default; a bounded xhigh review may be useful
only immediately before an irreversible production apply.
