# Gate 3A recovery evidence

Date: 2026-08-18 SGT  
Status: **passed for the guarded full-stack release**

This record contains no credentials, private row content, database identifiers, or encryption
keys. The retained backup is ignored by Git and remains local to the trusted operator workspace.

## Backup evidence

- A fresh logical backup was taken from the production PostgreSQL 17.6 database through the
  authenticated Supabase pooler without mutating production.
- Source size was 40,561,811 bytes with 95 public tables.
- The compressed logical dump was encrypted with AES-256-CBC using PBKDF2-HMAC-SHA-256 and
  300,000 iterations. Its passphrase source is the ignored local Gate 3A secret file and was never
  printed or committed.
- Retained encrypted size: 2,316,816 bytes.
- Stable non-secret backup reference (SHA-256):
  `7dedcf840ca9911a4381ed05cf807a9ce673990f37f7a183b02de590416d8b87`.

## Isolated restore evidence

- The retained encrypted archive decrypted to a byte-identical logical dump.
- That decrypted archive restored successfully into a new isolated PostgreSQL 18 cluster under
  the ignored local work directory.
- Exact aggregate comparison covered all 95 production public tables and 21,563 rows. Every table
  count matched.
- All 60 checked-in migrations then applied/status-checked successfully against the restored
  database. Four release migrations were newly applied.
- After migration, all pre-existing application-table counts remained identical. The only count
  change was the expected Prisma migration-history delta from 56 to 60.
- Aggregate-only privacy inspection completed in a read-only transaction. It found valid encrypted
  envelopes, no malformed envelopes, and zero cross-workspace relationship anomalies.
- The temporary cluster, restored databases, plaintext dump, and decrypted dump were stopped and
  permanently removed after validation. The encrypted backup and ignored Gate 3A secret file were
  preserved.

## Encryption-key recovery evidence

Immediately before this run, the owner confirmed Gate 3A ready after being explicitly instructed
that this confirmation includes an independently recoverable copy of the exact production
`CONTENT_ENCRYPTION_KEY` in the approved password manager. The key value was not requested,
displayed, copied into the backup, or committed. Existing production aggregates include valid
encrypted envelopes, so that independent recovery confirmation is a mandatory rollback control.

## Release boundary

Gate 3A now permits merging and deploying the additive schema/runtime release. It does not itself
authorize destructive retention, plaintext removal, or an unreviewed backfill. Those operations
remain governed by the Phase 3 and Phase 4 runbooks and their explicit apply acknowledgements.

## Production activation evidence

- Backend PR #17 merged as `0699835d8ffe2132e8ce29dd03496d8fada71538`.
- Render `/health` returned HTTP 200 with commit `0699835d8ffe` after cutover and again after the
  paired dashboard release.
- A read-only production check reported 60 completed Prisma migrations. `PrivacyMaintenanceRun`,
  `DashboardRequestReplay`, and `SharedRateLimitBucket` all exist.
- Dashboard PR #2 merged as `b00a3d15660a5714852a7a4096387f6995127845`; Vercel reported the
  deployment complete and the canonical `/dashboard?demo=1` route returned HTTP 200.
- No destructive privacy backfill, retention, plaintext removal, token rotation, or unrelated
  production cleanup was performed during activation.

The encrypted Gate 3A archive and its ignored local passphrase-source file remain the immediate
database rollback evidence. The archive's published SHA-256 detects accidental corruption; it is
not a separate keyed authentication tag. The owner-confirmed independent production content-key
recovery remains required for any ciphertext restore.
