# Architecture Notes

Threadwise is intentionally split into small modules so future contributors can change one feature without reshaping the whole bot.

## Core Principles

- Keep task and reminder behavior deterministic.
- Store all durable state in PostgreSQL.
- Treat AI as an adapter, not the center of the app.
- Ask before saving ambiguous natural-language messages.
- Auto-save only high-confidence task, note, and idea captures, and make them undoable.
- Treat destructive-looking operations, such as note merging, as preview-and-confirm flows.
- Keep Telegram handlers thin; domain behavior belongs in services.

## Request Flow

1. Telegram sends an update.
2. `src/bot` routes it to a command, callback, or natural-language handler.
3. The handler calls a domain service.
4. Services read/write through Prisma.
5. AI calls happen only through the `AiProvider` interface, after deterministic handlers have taken the obvious cases.
6. Replies are formatted by bot formatter helpers.

Recent reversible actions are tracked in `AuditLog` with an `undoable:` action prefix. `/undo` consumes the latest undoable entry and restores or archives the affected item without hard-deleting rows, so public IDs do not get reused.

Inline item actions stay intentionally shallow. Task buttons can complete, snooze, star, and edit. Note and idea buttons can star and edit. Edit buttons create a short-lived `PendingItemEdit` record, then the next normal user message is applied to the selected title/body/details/concept field with undo support.

Note merges use `PendingNoteMerge` records. `/merge notes ...` creates a preview from active notes, `Try again` regenerates the preview with stronger connection/preservation instructions, and `Merge` creates a new note while archiving the originals with `archivedReason = merged` and `mergedIntoNoteId` pointing to the generated note. Undo archives the generated note and restores the originals.

## Reminder Flow

1. The reminder loop periodically queries open tasks where `nextReminderAt <= now`.
2. It checks quiet hours and max reminders per day.
3. It sends a Telegram DM with inline buttons.
4. It records `ReminderDelivery`.
5. It advances `nextReminderAt` using the user's current reminder interval.

This avoids in-memory timers. If Render restarts, the database remains the source of truth.

Scheduled reminders use a separate due-nudge cadence. If `dueNudgeMinutes` is 5, a dated task starts nudging 5 minutes before the due time, then repeats every 5 minutes until it is done, snoozed, canceled, or rescheduled. Due-nudge deliveries bypass quiet hours and daily caps because they represent an explicit dated reminder window; undated recurring reminders still respect quiet hours and caps.

Changing `/settings interval` updates the user's setting and reschedules open tasks onto the new cadence without pulling future first scheduled reminders before their due time. For short intervals, Threadwise also raises an obviously-too-low daily cap so the new cadence can actually repeat. Turning quiet hours off rechecks open tasks, so reminders that were deferred by quiet hours can become eligible again.

## AI Adapter

The `AiProvider` interface supports:

- Message classification
- Idea structuring
- Task extraction
- Idea scoring
- Embeddings
- Provider status and a small live health check for the private admin endpoint

`OpenAiProvider` is the production provider. `HeuristicAiProvider` keeps local development and tests usable without an API key. Common task/reminder extraction, simple note structuring, Gmail triage, and clear message classification are handled before the provider so the bot remains useful when API quota is exhausted. Embeddings are deterministic local vectors by default, which keeps capture and search from consuming OpenAI quota.

The deterministic classifier uses fixed weighted signals over small rule tables, so runtime is linear in message length with a small constant factor. It records the winning reason in structured logs. Synthesis calls are wrapped by a bounded in-memory cache keyed by content hash; lookups are O(1), duplicate concurrent calls share a promise, and the oldest entries are evicted when the cache exceeds its cap.

OpenAI chat completions use a configurable model chain. The current model is tried first; if OpenAI returns a rate-limit or model availability error, Threadwise records the event and tries the next configured model from `OPENAI_MODEL_FALLBACKS`. This is reactive rather than predictive: the app can detect and recover after a failed request, but it cannot know a model is rate-limited before a request is attempted. AI is reserved for synthesis-heavy work such as complex note/idea structuring, note merges, note analysis, idea scoring, and richer Gmail summaries for messages that already look important.

The private `GET /admin/ai/status` endpoint is enabled only when `ADMIN_STATUS_TOKEN` is set. It is intentionally not exposed through Telegram.

## Performance Model

Most Telegram updates now stay on the deterministic path. For a message of length `L`, intent scoring, date parsing, title cleanup, and local embedding are `O(L)` with small fixed rule tables. Task and note creation add a constant number of indexed database reads/writes. In practice, deterministic request latency should be dominated by PostgreSQL plus Telegram reply time rather than local parsing.

Approximate per-request work:

- Natural reminder/task capture: `O(L) + DB create + Telegram reply`
- Simple note capture: `O(L) + DB create + Telegram reply`
- Search: `O(Q + N * D + N * F)`, where `Q` is query length, `N` is the bounded recent-item window currently loaded per type, `D` is the fixed local embedding dimension, and `F` is text checked for lexical matches. The current implementation caps each item type at 100 rows.
- Gmail scan: `O(M * K)` deterministic triage, where `M` is unread messages fetched and `K` is a small fixed important-word list. AI summary calls happen only for messages that pass the deterministic importance gate.
- Synthesis features such as note merge, note analysis, idea scoring, and complex note cleanup: local cache lookup is `O(1)`; cache misses pay OpenAI latency and provider rate limits.

Concurrent deterministic updates scale mostly with Node.js async I/O and the database connection pool. If `R` clear reminders arrive at the same time, local CPU work is roughly `O(R * L)` and the database sees roughly `R` small create transactions. If `R` identical synthesis requests arrive at the same time, the cache stores the in-flight promise so they share one OpenAI call; if they are all different synthesis requests, OpenAI becomes the bottleneck.

Current bottlenecks to watch as usage grows:

- Public IDs are generated with per-user counts. This is fine for personal scale, but a per-user counter table would be better for very high write volume.
- Search loads recent rows into memory and scores app-side. This is fine for hundreds of personal items; move to pgvector or indexed full-text search if users reach thousands to tens of thousands of items.
- Telegram itself is an external latency floor. Even fully deterministic handling still waits on Telegram send operations.

## Search

Search is personal-scale lexical plus deterministic semantic search:

- Generate a local deterministic embedding for the query.
- Load recent user items.
- Optionally restrict by item type for commands such as `/search notes deployment`.
- Normal task search includes open tasks only.
- `/search done <query>` searches completed tasks explicitly.
- Compare app-side with cosine similarity and a small lexical fallback for exact title/body matches.
- Store short-lived `PendingSearch` records for paginated Telegram callbacks instead of putting long queries in callback data.

This is intentionally simple. If the dataset grows, move embeddings to pgvector or a vector database without changing command behavior.

## Archives

Archive fields hide items from active views without hard-deleting them. `archivedReason` explains why an item left the active surface, and merged notes keep `mergedIntoNoteId` so archived views can show where the content went. `/archived <type>` pages through archived notes, ideas, and tasks.

## Calendar Integration

The first implementation stores due dates and returns:

- Google Calendar template links
- `.ics` files

Full OAuth sync should be added as a provider module later, with token storage scoped per user.
