# Content encryption rollout

Threadwise supports optional server-side application encryption for task, note, idea, saved-image metadata, and Study resource content. It is **off by default** and must not be enabled casually.

## What it protects

- Authenticated AES-256-GCM encrypts selected content before PostgreSQL receives it.
- Random nonces prevent identical text from producing identical ciphertext.
- Model and field names are authenticated, so ciphertext cannot be moved between protected fields unnoticed.
- A separately derived HMAC key produces field-scoped blind search tokens. PostgreSQL GIN indexes keep candidate lookup efficient; Threadwise verifies candidates after decryption.
- Existing plaintext rows remain readable while a rollout is in progress.

The server still holds the key and can decrypt content. This reduces exposure through Supabase/SQL consoles, raw backups, and database-only access; it is not end-to-end encryption and does not prevent an authorized operator or compromised running server from reading content.

## Protected in version 1

| Model | Protected fields |
| --- | --- |
| Task | title, description, source text |
| Note | title, body, summary, source text |
| Idea | title, concept, problem, target user, source text, market notes |
| Saved image | filename, caption, OCR text |
| Study resource | title, body, URL, filename, caption, OCR text |

Scheduling, status, recurrence, ownership, authorization, public identifiers, timestamps, Telegram provider identifiers, and binary image delivery remain unchanged so reminders and synchronization continue to work normally.

## Safe activation

1. Deploy the schema migration while `CONTENT_ENCRYPTION_MODE=off`. This only adds empty search-token columns and indexes.
2. Create and verify a restorable database backup.
3. Generate one 32-byte key locally:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

4. Store the result only as the Render secret `CONTENT_ENCRYPTION_KEY`. Never commit or paste it into logs, tickets, screenshots, or chat.
5. Keep `CONTENT_ENCRYPTION_MODE=off`, deploy, and verify normal reads. Adding the key alone is inert.
6. Set `CONTENT_ENCRYPTION_MODE=write`, deploy, and test a new task, note, idea, saved image, Study resource, and partial search.
7. Run a dry run to review record counts:

   ```powershell
   npm run db:encrypt-content
   ```

8. Run the migration once from a trusted one-off environment with the same database URL and secrets:

   ```powershell
   npm run db:encrypt-content -- --apply
   ```

9. Re-run the dry run, application tests, representative searches, reminders, dashboard edits, Study capture, and group capture. Retain the pre-migration backup until those checks pass.

## Failure and recovery rules

- **Never lose or rotate the key ad hoc.** Encrypted rows cannot be recovered without it.
- A wrong or missing key fails encrypted reads rather than returning corrupt text.
- Restore the pre-migration backup if activation must be rolled back. Switching write mode off does not decrypt existing rows.
- The migration is safe to rerun with the same key, but it will generate fresh ciphertext. Do not run simultaneous copies.
- Key rotation requires a dedicated decrypt-with-old/re-encrypt-with-new migration and is intentionally not automated in version 1.
- Blind indexes leak bounded equality/frequency information to a database-only attacker. They do not contain plaintext, and the HMAC key is separate from the encryption key.

## Expected performance

Encryption/decryption is linear in the small amount of content being read or written and occurs only on protected Prisma results. Search remains indexed; reminders and synchronization continue to query unencrypted operational metadata. The migration is intentionally sequential in batches of 100 to avoid connection spikes on the small Supabase pool.
