# Architecture Notes

Threadwise is intentionally split into small modules so future contributors can change one feature without reshaping the whole bot.

## Core Principles

- Keep task and reminder behavior deterministic.
- Store all durable state in PostgreSQL.
- Treat AI as an adapter, not the center of the app.
- Parse command-like natural language locally before attempting AI classification.
- Ask before saving ambiguous natural-language messages.
- Auto-save only high-confidence task, note, and idea captures, and make them undoable.
- Treat destructive-looking operations, such as note merging, as preview-and-confirm flows.
- Keep Telegram handlers thin; domain behavior belongs in services.

## Request Flow

1. Telegram sends an update.
2. `src/bot` checks access rules, group addressing rules, and duplicate update claims.
3. `src/bot` routes it to a command, callback, or natural-language handler.
4. The handler calls a domain service.
5. Services read/write through Prisma.
6. AI calls happen only through the `AiProvider` interface, after deterministic handlers have taken the obvious cases.
7. Replies are formatted by bot/service formatter helpers.

Telegram copy follows a small convention: show the saved content first, then a compact metadata block with stable IDs and dates, then any assistant guidance. Shared formatting helpers live in `src/utils/messageFormat.ts`; task list/detail/search formatters live in `src/bot/formatters.ts`; note and idea card formatting lives with their services. New contributors should change copy in those formatter functions instead of spreading ad hoc message strings through handlers.

Recent reversible actions are tracked in `AuditLog` with an `undoable:` action prefix. `/undo` consumes the latest undoable entry and restores or archives the affected item without hard-deleting rows, so public IDs do not get reused.

Natural-language handling has two deterministic layers before the AI adapter. `naturalCommands.ts` handles executable requests and help questions such as `how do I set reminders?`, `help me with notes`, `show me the notes`, `show task 1`, `archive note 1`, `change timezone to Myanmar`, `remind me again every 3 hours`, `warn me 10 mins before due tasks`, `allow up to 200 reminders per day`, `quiet hours off`, `merge notes 1 2 3`, and `undo`. If no command-like request matches, `deterministic.ts` scores the message as a possible task, scheduled reminder, note, idea, or noise. AI classification is only used when the deterministic score is not confident enough.

Group routing lives in `src/bot/groupRouting.ts`. Slash commands are treated as explicit bot requests. Plain natural-language messages in group chats are ignored unless they mention the bot or reply to one of its messages; the mention is stripped before normal parsing so `@ThreadwiseBot remind me to...` follows the same deterministic path as a private message. This keeps group conversations quiet and prevents accidental captures from unrelated chat.

`ensureUser` in `src/services/users.ts` resolves the current Threadwise owner. Private chats use the human Telegram user id. Group and supergroup chats use a synthetic owner id of `chat:<telegram chat id>` and store `reminderChatId` as the real chat id, so existing `userId`-scoped service functions can operate on shared group data without a parallel set of tables.

Group task assignment is task metadata, not just title text. `Task.assignedUsername`, `Task.assignedTelegramId`, and `Task.assignedDisplayName` are set from leading `@username` mentions or Telegram text-mention entities when available. The reminder and task formatters show `Assigned To`, and natural commands such as `assign task 2 to @henry_derek` update the stored assignee.

Group availability is modeled separately from tasks. `AvailabilityPoll` owns the shared scheduling window and optimistic revision; `AvailabilityResponse` is unique per poll and human Telegram id; `AvailabilityCalendarEvent` records only that human's optional provider event. `src/services/groupScheduling.ts` generates the bounded grid, verifies every selected cell, ranks only contiguous windows long enough for the requested duration, filters responses to current active members, and never places another member's raw cell choices in the returned view.

Telegram cannot attach a `web_app` inline button to a normal group message, so Find a time uses the bot's Main Mini App with a short `startapp` parameter. Vercel validates Telegram's signed init data, selects the opaque group workspace, and then opens the requested poll. Telegram retains one compact poll card; availability responses, live dashboard events, manager actions, and finalization refresh that card rather than posting one message per response.

Inline item actions stay intentionally shallow. Task buttons can complete, snooze, star, edit, and cancel. Note buttons can star, edit, and archive. Idea buttons can star and edit. Save/edit/action replies include inline undo or cancel buttons where supported, so users do not need to remember `/undo` or `cancel edit`. Edit buttons create a short-lived `PendingItemEdit` record, then the next normal user message is applied to the selected title/body/details/concept field with undo support.

Note merges use `PendingNoteMerge` records. `/merge notes ...` creates a preview from active notes, `Try again` regenerates the preview with stronger connection/preservation instructions, and `Merge` creates a new note while archiving the originals with `archivedReason = merged` and `mergedIntoNoteId` pointing to the generated note. Undo archives the generated note and restores the originals.

## Reminder Flow

1. The reminder loop periodically queries open tasks where `nextReminderAt <= now`.
2. It checks quiet hours and the daily reminder safety limit.
3. It sends a Telegram DM with inline buttons.
4. It records `ReminderDelivery`.
5. It advances `nextReminderAt` using the user's current repeat timing.

This avoids in-memory timers. If Render restarts, the database remains the source of truth.

Scheduled reminders use a separate early-warning cadence. If `dueNudgeMinutes` is 5, a dated task starts warning 5 minutes before the due time, then repeats every 5 minutes until it is done, snoozed, canceled, or rescheduled. Early-warning deliveries bypass quiet hours and daily safety limits because they represent an explicit dated reminder window; undated recurring reminders still respect quiet hours and the safety limit.

Daily and weekly recurring reminders store `recurrenceRule` plus `recurrenceIntervalDays` on the task row. After each recurring delivery, the reminder pass advances `dueAt` and `nextReminderAt` to the next future occurrence instead of creating another task row. This keeps recurring reminders O(1) per delivery and avoids duplicate task buildup.

Changing `/settings interval` or natural text such as `remind me again every 3 hours` updates the user's setting and reschedules open tasks onto the new cadence without pulling future first scheduled reminders before their due time. For short repeat timings, Threadwise also raises an obviously-too-low daily safety limit so the new cadence can actually repeat. The default safety limit is 200 reminders/day, high enough for normal reminder-bot use while still guarding against accidental loops. Turning quiet hours off rechecks open tasks, so reminders that were deferred by quiet hours can become eligible again.

Telegram does not provide an exact device timezone to bots during `/start`. New-user settings can only make a best-effort guess from Telegram language code, then users can correct the value with IANA names or common aliases such as `Myanmar`, `Yangon`, `Malaysia`, and `Singapore`.

## AI Adapter

The `AiProvider` interface supports:

- Message classification
- Idea structuring
- Task extraction
- Idea scoring
- Embeddings
- Provider status and a small live health check for the private admin endpoint

`OpenAiProvider` is the production provider. `HeuristicAiProvider` keeps local development and tests usable without an API key. Common task/reminder extraction, natural settings/list/detail requests, simple note structuring, integration intent, and clear message classification are handled before the provider so the bot remains useful when API quota is exhausted. Embeddings are deterministic local vectors by default, which keeps capture and search from consuming OpenAI quota.

The deterministic classifier uses fixed weighted signals over small rule tables, so runtime is linear in message length with a small constant factor. It records the winning reason in structured logs. Synthesis calls are wrapped by a bounded in-memory cache keyed by content hash; lookups are O(1), duplicate concurrent calls share a promise, and the oldest entries are evicted when the cache exceeds its cap.

OpenAI chat completions use a configurable model chain. The current model is tried first; if OpenAI returns a rate-limit or model availability error, Threadwise records the event and tries the next configured model from `OPENAI_MODEL_FALLBACKS`. This is reactive rather than predictive: the app can detect and recover after a failed request, but it cannot know a model is rate-limited before a request is attempted. AI is reserved for synthesis-heavy work such as complex note/idea structuring, note merges, note analysis, and idea scoring.

The private `GET /admin/ai/status` endpoint is enabled only when `ADMIN_STATUS_TOKEN` is set. It is intentionally not exposed through Telegram.

## Performance Model

Most Telegram updates now stay on the deterministic path. For a message of length `L`, natural-command matching, intent scoring, date parsing, title cleanup, and local embedding are `O(L)` with small fixed rule tables. Task and note creation add a constant number of indexed database reads/writes. In practice, deterministic request latency should be dominated by PostgreSQL plus Telegram reply time rather than local parsing.

Approximate per-request work:

- Natural reminder/task capture: `O(L) + DB create + Telegram reply`
- Recurring reminder delivery: `O(1) DB update` after the normal due-task fetch; the task row is advanced in place.
- Natural command-like settings/list/detail request: `O(L) + needed DB read/write + Telegram reply`
- Simple note capture: `O(L) + DB create + Telegram reply`
- Search: `O(Q + N * D + N * F)`, where `Q` is query length, `N` is the bounded recent-item window currently loaded per type, `D` is the fixed local embedding dimension, and `F` is text checked for lexical matches. The current implementation caps each item type at 100 rows.
- Calendar/Excel auto-sync: one best-effort provider request after the corresponding Threadwise write, with the saved Threadwise record retained if the provider is unavailable.
- Synthesis features such as note merge, note analysis, idea scoring, and complex note cleanup: local cache lookup is `O(1)`; cache misses pay OpenAI latency and provider rate limits.

Concurrent deterministic updates scale mostly with Node.js async I/O and the database connection pool. If `R` clear reminders arrive at the same time, local CPU work is roughly `O(R * L)` and the database sees roughly `R` small create transactions. If `R` identical synthesis requests arrive at the same time, the cache stores the in-flight promise so they share one OpenAI call; if they are all different synthesis requests, OpenAI becomes the bottleneck.

Group routing adds only constant-time checks per Telegram update: a few id lookups for the allowlist, a chat-type check, and at most one short bot-mention regex over the incoming message. Once routed, group commands have the same order of growth as private commands because the group chat is just another scoped owner id.

Current bottlenecks to watch as usage grows:

- Public IDs are generated with per-user counts. This is fine for personal scale, but a per-user counter table would be better for very high write volume.
- Search loads recent rows into memory and scores app-side. This is fine for hundreds of personal items; move to pgvector or indexed full-text search if users reach thousands to tens of thousands of items.
- Telegram itself is an external latency floor. Even fully deterministic handling still waits on Telegram send operations.

Message formatting helpers are constant-time apart from escaping and truncating user text. The deterministic wording variation uses a small hash over the public ID, so it is `O(id length)`, requires no network call, and produces stable output for the same item.

## Security And Data Scope

Handlers should never look up tasks, notes, ideas, calendar links, pins, or archives by public ID alone. Every lookup must include the current `userId`, either directly in Prisma or through helpers such as `findTaskReference`, `findNoteReference`, and `findIdeaReference`. This keeps another Telegram user from retrieving or mutating someone else's saved items by guessing IDs like `TASK-1`.

In group chats, the current `userId` is the synthetic chat owner. That means every member of an allowed group intentionally shares the same group tasks, notes, ideas, settings, and reminder history. Human Telegram ids may be stored on task assignment fields, but item lookup and mutation still stay scoped to the group owner id.

Availability management has an additional human boundary. Poll creation, reminders, finalization, and closure require a fresh Telegram owner/admin check. Each active member may write only the response keyed by their verified Telegram id. Shared views contain aggregate overlap counts and response identities, while only the viewer receives their own raw availability cells. Finalized Calendar events remain linked to the real personal user rather than the synthetic group owner.

Database access goes through Prisma query objects rather than string-built SQL, which keeps ordinary command text from becoming SQL injection input. Continue avoiding raw SQL unless there is a measured need, and if raw SQL is added, use Prisma parameter binding.

When `BOT_ALLOWED_TELEGRAM_IDS` is configured, access can be granted by sender id or group chat id. A group chat id may be written as the raw Telegram chat id or as `chat:<id>`. Blocked private users receive a private-bot notice; blocked group messages are ignored silently to avoid leaking bot presence into unrelated group conversations.

Do not log or display secrets. Google Calendar template links are ordinary task metadata, but Calendar/Microsoft OAuth tokens, Telegram bot tokens, OpenAI keys, and admin tokens must stay in environment variables or encrypted storage and should never appear in Telegram replies, README examples with real values, tests, or logs.

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

Archive fields hide items from active views without hard-deleting them. `archivedReason` explains why an item left the active surface, and merged notes keep `mergedIntoNoteId` so archived views can show where the content went. `/archive note 1` and note archive buttons set `archivedReason = removed` and record an undo entry; `/archived <type>` pages through archived notes, ideas, and tasks.

## Integration Lifecycle

Google Calendar and Microsoft Excel are personal-workspace mirrors. Threadwise's PostgreSQL rows remain authoritative, so a provider outage never rejects or removes a task or expense that was successfully captured.

Google Calendar stores encrypted per-user OAuth tokens and one durable provider event ID on each synchronized task. The public task ID plus `userId` is the lookup key. Creating, renaming, rescheduling, or changing recurrence patches the same primary-calendar event. Removing an event clears the provider linkage without deleting the Threadwise task. The optional `calendarAutoSync` setting applies best-effort synchronization after task writes; an explicit bulk sync backfills eligible dated tasks.

For a finalized group availability poll, Calendar is an explicit per-member mirror. A member can opt in or add/remove the meeting after finalization; the shared poll remains authoritative and unaffected by provider failure. Each `(pollId, telegramId)` pair maps to at most one Google event, and its URL is returned only to that signed-in member.

Microsoft Excel stores encrypted OAuth tokens plus the selected workbook, worksheet, and table identifiers. First connection can create the recommended workbook and import existing expenses. The optional `excelAutoSync` setting mirrors new confirmed expenses best-effort, while manual sync retries waiting rows. The standalone `.xlsx` export does not require OAuth.

OAuth pending-state rows bind the signed-in Telegram user, expire, and can preserve a selected task or requested auto-sync setting across the provider redirect. Dashboard callbacks return to the Connections tab; Telegram-initiated callbacks send a concise completion message. Provider status and mutations are exposed through the signed dashboard API, never directly to the browser database layer.

Normal task cards do not display long template URLs. Users interact through a contextual Calendar button, the integration panels, dashboard Connections, or plain-language requests. `/calendar` and `/excel` open the same panels; older subcommands remain compatibility fallbacks.

Gmail was removed from the active runtime in July 2026. Its legacy schema objects are retained inertly to avoid destructive data removal during the lifecycle revamp and should only be dropped in a separately reviewed retention migration.
