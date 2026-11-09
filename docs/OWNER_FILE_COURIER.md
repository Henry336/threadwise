# Owner-only laptop file courier

Date: 2026-07-29
Reviewed against backend v0.32.0: 2026-08-10

## Boundary

- `/files` is separate from private `/codex` prompting and Gemini Ideas Intelligence.
- Every command, natural-language request, Send callback, and Cancel callback requires the exact configured Telegram owner and chat.
- Before use, Telegram must prove that the configured group still contains exactly the owner and Threadwise. Lookup failure or a third member fails closed.
- Results and transfers always use the configured owner chat stored on the durable job. A callback from another user or chat cannot retarget one.

## Durable flow

1. Telegram creates a `FileCourierJob` containing request metadata only.
2. The trusted laptop worker claims the job with the existing worker token and a renewable lease.
3. Search uses Windows Search first and a bounded recursive fallback only for unindexed roots. Results are capped and stored as metadata in `FileCourierResult`.
4. Telegram renders each result with a separate Send button. No bytes have moved yet.
5. Send creates a new durable job containing the exact selected path, size, modified time, and filesystem identity.
6. The laptop revalidates the path under an explicit root, rejects unsafe path forms and reparse points, creates a private local snapshot, and rechecks it.
7. A raw exact-length stream passes from that snapshot through Fastify into grammY `InputFile` and Telegram `sendDocument`. It is never buffered into PostgreSQL or written to Render storage.
8. The local snapshot is removed in `finally`, whether delivery succeeds or fails.

Expired leases are claimable after worker restart. Live leases are not. Completed metadata reports have an independent delivery retry loop. Send delivery records the Telegram message id before becoming terminal; delivery failure becomes a failed audited job.

## Configuration

Render:

```text
FILE_COURIER_MAX_BYTES=50000000
```

Laptop `.env.codex-worker`:

```text
THREADWISE_FILE_ROOTS=C:\Users\Henry\Documents;C:\Users\Henry\OneDrive\Desktop
THREADWISE_FILE_MAX_BYTES=50000000
THREADWISE_FILE_SCAN_LIMIT=50000
```

No root is assumed. Full-drive access must be explicit, for example `C:\;D:\`.

The standard hosted Telegram Bot API documents a 50 MB `sendDocument` limit. The local Bot API server can upload up to 2000 MB, but this deployment uses Telegram's hosted API and caps both configuration and validation at 50,000,000 bytes.

## Audit actions

- `QUEUED`
- `CLAIMED`
- `RECLAIMED`
- `LOOKUP_COMPLETED`
- `SEND_REQUESTED`
- `UPLOAD_STARTED`
- `DELIVERED`
- `FAILED`
- `CANCELED`

Audit rows contain state and bounded diagnostic metadata, never file contents.

## Using it

Moved from the README on 2026-11-09.

Separate roots with semicolons. Full-drive access is supported only when deliberately configured, such as `THREADWISE_FILE_ROOTS=C:\;D:\`. Windows Search is tried first; a bounded traversal covers roots that are not indexed. The worker advertises whether its roots are valid, so Telegram refuses requests rather than leaving them queued when file courier is unconfigured.

Use:

```text
/files find curriculum PDF
/files recent
/files get "C:\Users\Henry\Documents\curriculum.pdf"
Send me the latest curriculum PDF from my laptop.
```

Search and recent-file responses keep up to 100 validated metadata matches and
show eight at a time. Use the inline Previous/Next controls to move through the
same durable result set; page changes do not require the laptop worker to remain
online. Send buttons retain the global result number on every page.

Search and exact-path requests return filename, parent folder, size, modified time, and type. They do not transfer content. The owner must tap **Send** on one exact result, and may cancel a request before the worker claims it.

`FILE_COURIER_MAX_BYTES` is the cloud-side cap and `THREADWISE_FILE_MAX_BYTES` is the laptop-side cap; the lower effective limit wins. The standard hosted Telegram Bot API currently accepts documents up to 50 MB (50,000,000 bytes), while a self-hosted Local Bot API server supports larger uploads. Threadwise uses the standard hosted API and therefore caps configuration at 50,000,000 bytes. See the official [Telegram Bot API `sendDocument` documentation](https://core.telegram.org/bots/api#senddocument).

File jobs use renewable leases, recover after worker restarts or expired claims, and write audit events for queueing, claiming, completion, cancellation, upload start, delivery, and failure. A Telegram delivery error becomes a failed job and owner-visible report instead of retaining a server copy.
