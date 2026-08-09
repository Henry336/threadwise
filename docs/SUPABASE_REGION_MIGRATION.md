# Supabase Seoul → Singapore Migration

Status: **completed in production in July 2026**

Document reviewed: **2026-08-10**

Threadwise moved from a Supabase project in Seoul (`ap-northeast-2`) to a new project in Singapore (`ap-southeast-1`). Supabase projects cannot change region in place, so this was a database-to-database migration followed by a Render connection-string cutover.

The migration verified exact application-table row counts and sequence state before production resumed. Telegram queries that had often taken roughly 1–2.5 seconds became near-immediate after the application and database were in the same region.

This file is retained as an operational record and reusable runbook. **Do not run it against production merely because it is in the repository.** A future migration requires a new backup, an empty target, fresh credentials, and an approved maintenance window.

Official references:

- [Change Project Region](https://supabase.com/docs/guides/troubleshooting/change-project-region-eWJo5Z)
- [Migrating within Supabase](https://supabase.com/docs/guides/platform/migrating-within-supabase)
- [Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Available regions](https://supabase.com/docs/guides/platform/regions)

## Scope

Threadwise uses Supabase as PostgreSQL. It does not depend on Supabase Auth, Storage, Edge Functions, Realtime, or browser-side Supabase keys.

The workflow copies:

- The complete Threadwise `public` schema
- All application rows
- Prisma migration history
- Application sequence state

It deliberately leaves Supabase-managed internal schemas alone.

Only Render's `DATABASE_URL` changes at cutover. Telegram, dashboard signing, Vercel, OpenAI, and OAuth credentials are independent of the database region.

## Migration Assets

- `scripts/migrate-supabase-seoul-to-singapore.ps1` validates expected source/target regions and invokes the PostgreSQL migrator.
- The migrator takes a transaction-consistent source backup, deploys the repository Prisma schema, imports application data in one transaction, and compares public table row counts and sequence state.
- It accepts an empty target or an empty Prisma schema from a failed attempt and refuses to overwrite different non-empty target data.
- `.github/workflows/migrate-supabase-region.yml` can run from GitHub's network when a local network blocks PostgreSQL port 5432.
- GitHub receives only a non-sensitive report. Database dumps are not uploaded as artifacts.

## Completed Procedure

The production migration followed this order:

1. Create an empty Supabase project in Singapore.
2. Obtain the source and target Session pooler URIs on port `5432`.
3. Store them temporarily as encrypted GitHub Actions secrets, never in Git or command history.
4. Run the non-mutating preflight.
5. Suspend Render to stop writes.
6. Run the guarded migration.
7. Verify table counts and sequences.
8. Replace Render's `DATABASE_URL` with the Singapore pooler URI.
9. Resume and verify the bot and dashboard.
10. Remove temporary GitHub secrets and retain the source through the rollback window.

No real connection string or password belongs in this document.

## Reusable Operator Runbook

### 1. Prepare

- Take a fresh source backup.
- Confirm the target is empty.
- Confirm both connection strings are pooler URLs reachable from the chosen runner.
- Confirm the source and target regions.
- Do not delete or modify the source project during the rollback window.

### 2. Store Temporary Encrypted URLs

Use hidden input rather than passing URLs as command-line arguments:

```powershell
gh secret set SOURCE_SUPABASE_DATABASE_URL
gh secret set TARGET_SUPABASE_DATABASE_URL
```

### 3. Run The Preflight

```powershell
gh workflow run migrate-supabase-region.yml -f mode=preflight
gh run watch
```

The preflight checks connectivity, PostgreSQL versions, source data, target retry safety, source/target regions, and required permissions. It must not change database data.

### 4. Quiesce Writes

Suspend the Render service. Do not use Telegram or dashboard mutation flows after suspension.

### 5. Run The Guarded Migration

```powershell
gh workflow run migrate-supabase-region.yml `
  -f mode=migrate `
  -f "confirmation=MIGRATE TO SINGAPORE"
gh run watch
```

The workflow fails closed unless the secrets exist, the confirmation matches, the source is Seoul, and the target is Singapore.

### 6. Cut Over

Set Render's `DATABASE_URL` to the target Session pooler URI, save, and resume the service. `render.yaml` runs Prisma migrations in its pre-deploy step.

### 7. Verify Production

- Confirm `/health` is healthy and reports the expected version/commit.
- Confirm Prisma migrations completed.
- Create a uniquely named temporary note or task in Telegram.
- List/open it and archive it.
- Confirm the same data appears in the dashboard.
- Check reminders and any enabled Calendar flow.
- Compare representative latency with the previous region.

### 8. Remove Temporary Secrets

```powershell
gh secret delete SOURCE_SUPABASE_DATABASE_URL
gh secret delete TARGET_SUPABASE_DATABASE_URL
```

Keep the source and a verified backup through the rollback window.

## Rollback Pattern

- If migration fails before Render changes, resume Render with the source unchanged.
- If verification fails after cutover, suspend Render, restore the old source `DATABASE_URL`, and resume.
- Reconcile any writes made only in the target before retrying.
- Never delete the source during the rollback window.

## Optional Local Preflight

Some campus networks block PostgreSQL port `5432`. Prefer GitHub Actions in that environment. On a network that permits PostgreSQL, copy `.env.region-migration.example` to the ignored `.env.region-migration`, fill both URLs, and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\migrate-supabase-seoul-to-singapore.ps1 `
  -EnvFile .\.env.region-migration
```

The local migration additionally requires `-Migrate -SourceQuiesced` and must run only while writes are stopped.
