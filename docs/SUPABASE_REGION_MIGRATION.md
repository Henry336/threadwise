# Supabase Seoul → Singapore migration

Supabase projects cannot change region in place. Threadwise therefore moves to a new project created in **Southeast Asia (Singapore)** (`ap-southeast-1`) and keeps the Seoul project untouched as the rollback source.

Official references:

- [Change Project Region](https://supabase.com/docs/guides/troubleshooting/change-project-region-eWJo5Z)
- [Migrating within Supabase](https://supabase.com/docs/guides/platform/migrating-within-supabase)
- [Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Available regions](https://supabase.com/docs/guides/platform/regions)

## What this migration copies

Threadwise uses Supabase only as PostgreSQL. It does not use Supabase Auth, Storage, Edge Functions, Realtime, or browser-side Supabase keys. The migration therefore copies the complete Threadwise `public` schema and data, including Prisma migration history, while leaving Supabase-managed internal schemas alone.

Only Render's `DATABASE_URL` changes at cutover. The Telegram bot token, dashboard authentication, Vercel variables, OAuth credentials, and Supabase publishable key do not change.

## What is already prepared

- `scripts/migrate-supabase-seoul-to-singapore.ps1` validates both regions and invokes the proven PostgreSQL migrator.
- The migrator performs a transaction-consistent source backup, deploys the repository's Prisma schema, imports all application data in one transaction, and compares every public table row count and sequence state exactly.
- It accepts an empty target or an empty Prisma schema left by a previous failed attempt; it refuses to overwrite different or non-empty target data.
- `.github/workflows/migrate-supabase-region.yml` runs the migration from GitHub's network, avoiding campus Wi-Fi blocks on PostgreSQL port 5432.
- GitHub receives only a non-sensitive verification report. Database dump files are not uploaded as artifacts.
- The Seoul project remains unchanged until it is deliberately deleted later, so it is the immediate rollback source.

## Your minimal steps when you return

1. In Supabase, create a new project in **Southeast Asia (Singapore)**. Do not create tables manually.
2. In each Supabase project, open **Connect → Session pooler → URI** and copy the port `5432` connection string:
   - current Seoul source (`ap-northeast-2`)
   - new Singapore target (`ap-southeast-1`)
3. Give both URLs to Codex in this task. They will be stored temporarily as encrypted GitHub Actions secrets, never committed, and removed after cutover.
4. When prompted, suspend the Render `threadwise` service. Codex can then run the guarded migration.
5. Replace Render's `DATABASE_URL` with the Singapore Session pooler URL, save, and resume the service. If Render API access is available at that time, Codex can perform this step too.

That is all the manual setup required. Do not delete the Seoul project during the migration.

## Prepared operator runbook

These steps are for Codex/the operator; the user does not need to type them manually.

### 1. Store temporary encrypted URLs

Run `gh secret set SOURCE_SUPABASE_DATABASE_URL` and `gh secret set TARGET_SUPABASE_DATABASE_URL`, entering each value at the hidden prompt. Do not pass URLs as command-line arguments.

### 2. Run the live-safe preflight

```powershell
gh workflow run migrate-supabase-region.yml -f mode=preflight
gh run watch
```

Preflight verifies connectivity, PostgreSQL versions, source data, target emptiness/retry safety, Seoul/Singapore host regions, and trigger-bypass permission. It makes no database changes.

### 3. Quiesce writes

Suspend the Render web service. The dashboard may briefly show its connection fallback while the service is suspended; this is expected. Do not send Telegram writes after suspension.

### 4. Run the guarded migration

```powershell
gh workflow run migrate-supabase-region.yml `
  -f mode=migrate `
  -f "confirmation=MIGRATE TO SINGAPORE"
gh run watch
```

The workflow fails closed unless the source and target secrets exist, the exact confirmation matches, the source is Seoul, and the target is Singapore.

### 5. Cut Render over

Set Render `DATABASE_URL` to the target Session pooler URI, save, and resume. Wait for `/health` to report healthy.

### 6. Verify production

- Confirm `/health` is healthy and Prisma migrations complete.
- In Telegram, create a uniquely named temporary note or task, list/open it, then delete/archive it.
- Open the dashboard and confirm the same user data appears.
- Confirm a normal query is faster from Render Singapore.

### 7. Remove temporary secrets

```powershell
gh secret delete SOURCE_SUPABASE_DATABASE_URL
gh secret delete TARGET_SUPABASE_DATABASE_URL
```

Keep the Seoul project for at least 48 hours after successful production verification. Delete it only after the bot, reminders, dashboard, integrations, and a fresh backup have been checked.

## Rollback

- **Migration fails before Render changes:** resume Render unchanged; it still points to Seoul.
- **Production verification fails after cutover:** suspend Render, restore its old Seoul `DATABASE_URL`, save, and resume. Any writes made only in Singapore after cutover must be reconciled before a later retry.
- Never delete or modify the Seoul project during the rollback window.

## Optional local preflight

Campus Wi-Fi previously blocked database port 5432, so GitHub Actions is preferred. On a network that permits PostgreSQL, copy `.env.region-migration.example` to the ignored `.env.region-migration`, fill both URLs, and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\migrate-supabase-seoul-to-singapore.ps1 -EnvFile .\.env.region-migration
```

The local migration command additionally requires `-Migrate -SourceQuiesced` and should only run after Render is suspended.
