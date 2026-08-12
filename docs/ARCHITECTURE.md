# Architecture Notes

Updated: 2026-08-13

Current backend release: v0.32.0

Threadwise is intentionally split into small modules so future contributors can change one feature without reshaping the whole bot.

## Core Principles

- Keep task and reminder behavior deterministic.
- Store all durable state in PostgreSQL.
- Treat AI as an adapter, not the center of the app.
- Parse command-like natural language locally before attempting AI classification.
- Resolve clear natural language locally; offer immediate Task/Note/Idea/Ignore choices for ambiguous private messages.
- Auto-save only high-confidence task, note, and idea captures, and make them undoable.
- Treat destructive-looking operations, such as note merging, as preview-and-confirm flows.
- Keep personal data scoped to a human owner and shared data scoped to one verified group workspace.
- Keep routine capture quiet; preserve important interpretations and persistent action/error surfaces.
- Keep Telegram handlers thin; domain behavior belongs in services.

## Application content protection

Threadwise can optionally protect high-value textual content at the Prisma boundary with versioned AES-256-GCM. The extension encrypts writes and decrypts reads for tasks, notes, ideas, saved-image filename/caption/OCR, and Study-resource title/body/link/filename/caption/OCR fields. A random 96-bit nonce and model/field additional authenticated data make copied or modified ciphertext fail closed.

Search remains server-side and deterministic through a separately derived HMAC key. Each protected model stores field-separated blind prefix, word, and trigram tokens in a PostgreSQL GIN-indexed array. Mixed-rollout queries check both legacy plaintext and blind tokens, then verify the decrypted content exactly before returning it. This preserves partial and scoped image OCR/caption search without decrypting every row in application memory.

`CONTENT_ENCRYPTION_MODE=off` is deliberately inert. Existing plaintext remains readable and a configured key may decrypt already migrated rows, but no write changes until the mode is explicitly `write`. The batch migration rewrites through the same Prisma extension and is dry-run-only unless `--apply` is supplied. The master key lives only in server secrets and never crosses into Telegram, Vercel, or the browser.

This is application-level encryption, not end-to-end encryption: the running backend can decrypt content because search, reminders, synchronization, and dashboard rendering require it. Ownership, due dates, statuses, recurrence, provider identifiers, and other operational metadata remain queryable. The complete activation and recovery boundary is documented in `docs/CONTENT_ENCRYPTION.md`.

## Canonical campus places and journeys

Study routing uses one deterministic place boundary in `src/services/studyTransit.ts`. A resolved place carries a stable id, display name, aliases, venue-or-stop type, coordinates, and ranked nearby stops. Telegram origin setup, natural-language directions, timetable destinations, proactive class reminders, and the protected dashboard search endpoint all call this boundary; none maintains a separate list of place aliases. Exact aliases resolve immediately, fuzzy ambiguity returns bounded candidates, and unresolved timetable labels remain visible but cannot silently enable a travel reminder.

A `StudyJourneyEstimate` is a complete route plan rather than a bus-only answer. It records the initial walking leg, boarding stop, live arrival choices, bus and transfer legs, alighting stop, final walking leg, total travel time, predicted arrival and leave time, data freshness, live/fallback status, and alternative plans. The public Improved NextBus provider remains advisory: unavailable live data produces a labelled conservative fallback and never an invented arrival.

Origin selection is deterministic: an unexpired temporary current location wins, then the timetable block's explicit origin, then the saved default. Current locations are accepted only through Telegram's native private-chat location control, expire after four hours, and are cleared by **I'm here**; Threadwise stores a short-lived point for route calculation and does not continuously track movement. Group prompts deep-link the owner to the private control instead of requesting public location data.

Telegram's native command catalogue is also scoped, not global. Startup registers Personal, Group, Study, Beacon owner/moderator, English, and Burmese command sets with `setMyCommands`. This improves discovery without changing the natural-language-first router or exposing owner-only controls such as Beacon purge to other actors.

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

Natural-language handling has two deterministic layers before the AI adapter. `naturalCommands.ts` handles executable requests and help questions such as `how do I set reminders?`, `show task 1`, `archive note 1`, `change timezone to Myanmar`, `warn me 10 mins before due tasks`, `merge notes 1 2 3`, and `undo`. If no command-like request matches, `deterministic.ts` scores the message as a possible task, scheduled reminder, note, idea, or noise. A low-confidence private message is persisted briefly as a `PendingCapture` and immediately receives actor-bound Task, Note, Idea, and Ignore buttons. It does not wait for AI on the response-critical path. Low-confidence group conversation remains ignored unless it was explicitly addressed to Threadwise.

Group routing lives in `src/bot/groupRouting.ts`. Slash commands are explicit. Ordinary group text is ignored unless it contains the exact runtime bot mention or replies to a normal/receiver-bound Threadwise message. Generic `@something_bot` mentions and a plain leading product name do not activate the router. Two deliberately narrow headings—`TODO:` and `ACTION ITEMS:`—also activate the batch-import path. This keeps normal conversation quiet while giving groups one familiar, low-ceremony capture convention. Telegram privacy mode still controls which unmentioned messages are delivered by Telegram; an exact mention or reply is the universally reliable path.

Group TODO import is a durable preview-and-commit workflow rather than a loop that creates one task per line immediately. `src/services/taskImports.ts` parses the bounded list, resolves unambiguous active-member usernames/display names, preserves recognizable team-owner labels, leaves ordinary parenthetical details untouched, interprets dates in the group timezone, and stores `PendingTaskImport` plus ordered `PendingTaskImportItem` rows. Telegram exposes the complete ordered review as six-task pages by editing one compact message; import and cancel still act on the review as a whole. The authenticated dashboard is an optional details editor, where the sender or a freshly verified group owner/admin may change inclusion, title, assignees, team owner, due time, and initial Open/Done status. Reviewed assignees enter task creation as structured data rather than being re-parsed from synthetic text entities. Import claims the review, refreshes that lease between rows, creates each task through the existing task service, records per-row success/failure, and leaves failed rows retryable. The source-row id is also unique on the created task, making callbacks and interrupted retries idempotent even across competing recovery attempts.

Forum groups can optionally create one dedicated Threadwise topic. Creation is admin-only and persists the Telegram topic id on `GroupWorkspace`; it is an organizational convention, not an alternate data scope or a requirement for group features.

`ensureUser` in `src/services/users.ts` resolves the current Threadwise owner. Private chats use the human Telegram user id. Group and supergroup chats use a synthetic owner id of `chat:<telegram chat id>` and store `reminderChatId` as the real chat id, so existing `userId`-scoped service functions can operate on shared group data without a parallel set of tables.

Group task assignment is durable metadata, not just title text. New assignments take effect immediately; no acceptance step is required. Any active member may claim currently unassigned work through a race-safe mutation. Assignees may complete or snooze their own work, while assignment and reassignment require the task creator or a freshly verified Telegram group owner/admin. Legacy accept, decline, block, unblock, and handoff commands/callbacks return an explanation of the current model without mutating state. Existing historical assignment/audit rows remain readable.

Group availability is modeled separately from tasks. `AvailabilityPoll` owns the shared scheduling window and optimistic revision; `AvailabilityResponse` is unique per poll and human Telegram id; `AvailabilityCalendarEvent` records only that human's optional provider event. `src/services/groupScheduling.ts` generates the bounded grid, verifies every selected cell, ranks only contiguous windows long enough for the requested duration, filters responses to current active members, and never places another member's raw cell choices in the returned view.

Telegram cannot attach a `web_app` inline button to a normal group message, so Find a time uses the bot's Main Mini App with a short `startapp` parameter. Vercel validates Telegram's signed init data, selects the opaque group workspace, and then opens the requested poll. Telegram retains one compact poll card; availability responses, live dashboard events, manager actions, and finalization refresh that card rather than posting one message per response.

Shared group control panels use Telegram Bot API receiver-bound ephemeral delivery (`src/bot/ephemeral.ts`). The group keeps one public anchor, but each member receives their own private menu surface. Callback data is still bound to the acting Telegram identity. Shared task, reminder, and scheduling cards remain public because they represent group state.

Private Note sessions are durable state, not an in-memory mode. `NoteCaptureSession` records the owner and expiry; each incoming message is appended immediately as an ordered `NoteCaptureSegment`. While active, ordinary classification pauses and the reply keyboard contains Save note and Cancel. Save joins exact segments with blank lines; the background sweep auto-saves non-empty inactive sessions after roughly 30 minutes and discards empty ones. `src/bot/notePagination.ts` splits long display text at paragraph, then sentence, then safe character boundaries while leaving the stored note unchanged.

Private Study Mode is a separate owner-only domain inside the same bot, service, reminder loop, and database. `STUDY_OWNER_TELEGRAM_ID` and `STUDY_ALLOWED_CHAT_ID` establish the maximum allowed scope; an active `StudyWorkspace.boundChatId` is the durable second factor. Because the configured group is a sealed, single-purpose workspace, every owner-authored text, photo, document, location, callback, and reply-keyboard control in that exact chat routes to Study Mode rather than requiring a mention. The first bare `/study` can bind the verified group and opens onboarding; slash commands remain compatibility fallbacks.

Study services are split by responsibility. `study.ts` owns weeks, modules, work, sessions, mistakes, reviews, schedule blocks, dashboard aggregation, and CSV exports. `studyNaturalLanguage.ts` performs deterministic intent and module extraction. `studyCanvas.ts` owns a single-flight, paginated, retry-bounded, read-only Canvas mirror. `studyAttention.ts` scores work from deadlines, explicit priority, mastery, backlog age, effort, and source uncertainty. `studyResources.ts` owns module resources, reply/pending captures, local OCR metadata, durable silent note sessions, and Unicode-safe Telegram pagination. `studyTransit.ts` consumes the public Improved NextBus contract and manages saved/default/temporary origins. `studyReminders.ts` derives and prioritizes proactive candidates while `studyCapture.ts` and `study.ts` keep Telegram handlers thin.

`studyNusmods.ts` is the deterministic timetable-import boundary. It parses only canonical NUSMods semester share URLs, derives the academic year from the configured Study semester, fetches the selected modules from the public NUSMods API, matches the exact lesson type and class number, and upserts recurring blocks with `source=NUSMODS` plus stable source references. A re-import reconciles only that source namespace: stale NUSMods selections are deactivated, while manual schedule blocks are never rewritten. Published venue labels are passed through `studyTransit.ts`; a resolved venue enables the existing live-journey and class-departure pipeline, while an unresolved venue stays visible and produces an explicit import warning.

Study write routing is explicit. `activeModuleId` plus `activeModuleUntil` form a visible ten-minute
capture context, not an indefinite default. Switching modules restarts the window; ordinary captures
do not extend it. After expiry, captures without one unambiguous module reference or module-specific
bot reply are persisted as `StudyPendingCapture` rows until the owner chooses an active module.
Image pending rows retain caption, optional OCR preview, sender, and sent-time metadata and are
atomically consumed only when the owner saves. Canvas source metadata follows
the same separation: sync may refresh known rows, but `StudyModule.active`, module/item archive
timestamps, and local closed item statuses remain owner decisions. Inactive modules are excluded at
the query boundary from operational projections, reminders, travel, search, reviews, and exports.

Study privacy fails closed. Each command and callback verifies the exact actor, exact chat, active binding, and current two-member count. The `chat_member` handler unbinds the workspace if another human joins; reminders and auto-save acknowledgements recheck the group before proactive output. Study queries include `workspaceId`, and the feature remains absent from global search and every ordinary personal/group dashboard route.

The Study dashboard is a separately sealed projection of this domain. `src/dashboard/workspaces.ts` marks a workspace as `mode=STUDY` only when the signed principal, configured owner, configured chat, live Telegram membership, and active `StudyWorkspace` binding match. `src/dashboard/study.ts` repeats the exact gate before every snapshot, search, content, and mutation request; a mismatch returns an opaque not-found response. The current shell includes Overview, Timetable, Work, Deep Work, Modules, Library, Search, Review, and Settings. Timetable derives a full 00:00–24:00 weekly/day view from recurring schedule blocks and planned work while keeping deadline markers distinct from scheduled study time; class blocks may carry a destination, normal origin, and travel buffer. Protected Telegram image/file bytes are fetched server-side only after this lookup. Each request resolves a fresh Telegram file path, retries one stale-download failure, accepts only an upstream raster MIME, enforces the size bound, and returns credential-free temporary or permanent errors.

Deep Work sessions remain canonical backend records even while their controls appear across several dashboard routes. `StudySession` stores exact timestamps, an optional topic and focus structure, a technique list, outcome data, and a soft-archive marker. `StudySessionResource` links notes, images, files, questions, and other module resources without copying content. The dashboard may PATCH a session while it is active or after completion and may archive completed history; every mutation repeats the Study owner/group gate and validates that linked resources belong to the same workspace and module. Archiving adjusts recorded item minutes but retains the session row for auditability. No AI service participates in timing, completion, resource linking, or retrieval.

Optional module analysis is a separate evidence-processing boundary, not part of Deep Work's canonical control path. Protected `GET` and `POST /api/threadwise/study/modules/:moduleId/analysis` routes repeat the Study owner/group gate: `GET` reads the latest cache, while `POST` is the only way to request work. `GeminiStudyAnalysisJob` snapshots completed, non-archived module sessions and linked resources, hashes that evidence for idempotency, and is claimed by the existing owner-scoped private Gemini CLI worker. The service filters unknown evidence ids, drops uncited findings, records uncertainty as a limitation, and never writes mastery, task, reminder, schedule, or session state. A completed cache remains readable when the worker is offline; absent workers or provider failures disable only this optional surface.

Inline item actions follow `One message, one decision`. An ordinary task, note, idea, or image card renders no more than three immediate actions across no more than two rows. Task cards prioritize completion, snooze, and an exact dashboard continuation; list rows reveal numbered item controls only after an explicit Choose action. Secondary editing, starring, archiving/cancellation, Calendar, and assignment management remain available through exact dashboard links or focused Telegram subflows rather than one permanent button wall. Save/edit/action replies retain inline undo or cancel controls where supported, and `PendingItemEdit` keeps text-edit continuations restart-safe.

Note merges use `PendingNoteMerge` records. `/merge notes ...` creates a preview from active notes, `Try again` regenerates the preview with stronger connection/preservation instructions, and `Merge` creates a new note while archiving the originals with `archivedReason = merged` and `mergedIntoNoteId` pointing to the generated note. Undo archives the generated note and restores the originals.

## Dashboard Flow

The dashboard is a separate Next.js/Vercel client. It never connects directly to PostgreSQL or receives a database credential.

1. Telegram Login or signed Mini App init data establishes the human Telegram identity on Vercel.
2. The dashboard signs a short-lived EdDSA JWT with `iss=threadwise-dashboard`, `aud=threadwise-api`, a positive Telegram `sub`, a unique `jti`, and a lifetime no longer than 120 seconds.
3. `src/dashboard/auth.ts` verifies the bundled public key and claims.
4. Personal calls resolve the human's owner scope. Group calls also carry `X-Threadwise-Workspace`, an opaque UUID.
5. `src/dashboard/workspaces.ts` resolves that UUID and revalidates Telegram membership before entering the synthetic group owner scope.
6. Route handlers validate payloads with the schemas in `src/dashboard/schemas.ts` and call the same domain services used by Telegram.
7. Mutation paths publish scoped events through `src/dashboard/realtime.ts`; `/api/v1/dashboard/events` streams them with private/no-store semantics so the client can refresh the affected data.

When the resolved workspace is Study Mode, the Next.js client switches to a dedicated module-first shell and requests `/api/v1/dashboard/study/snapshot`. Study mutations call the same services used by Telegram for work, resources, mastery, sessions, mistakes, weekly reviews, Canvas state, origins, and schedule blocks. Realtime revisions include Study workspace/resource/Canvas/audit changes and are keyed to the signed owner, so either surface updates the other without a second data store.

TODO reviews add actor and workspace boundaries inside the shared workspace. The original sender may update, import, or cancel their own review. Another member needs a fresh Telegram owner/admin verification before controlling it; otherwise the dashboard remains read-only and the API rejects the mutation. Telegram callbacks additionally verify that the button is being used in the exact group that created the review. Review deep links select the correct opaque workspace and exact batch. Once imported, ordinary work follows immediate assignment: assignees complete or snooze, an active member may claim an unassigned task, and creator/admin authority controls reassignment.

Group authorization has two layers. Current members may read shared data, mutate only their own availability, claim an unassigned task, and complete/snooze work assigned to them. Creator/admin operations—including assignment/reassignment—and owner/admin operations such as changing group settings or finalizing a scheduling poll perform the appropriate fresh Telegram checks. The server fails closed when a required check cannot establish the privilege.

The API intentionally never returns OAuth tokens, embeddings, raw Telegram reusable file IDs, raw group chat IDs, or another member's availability cells. Saved image bytes are fetched server-side from Telegram only after an authenticated, owner-scoped lookup.

## Reminder Flow

1. The reminder loop periodically queries open tasks where `nextReminderAt <= now`.
2. It distinguishes an explicit first due delivery from later repeat nudges.
3. It applies quiet hours and the daily reminder safety limit where the current delivery type requires them.
4. It batches simultaneously eligible undated tasks for the same group into compact chunks of at most eight tasks; dated and personal reminders retain their normal cards.
5. It sends to the task's personal or group reminder chat, and optionally to eligible opted-in assignees.
6. It records one `ReminderDelivery` row per included task while counting the shared Telegram message only once against the daily message limit, then removes superseded main-chat reminders.
7. It advances `nextReminderAt` or the recurring calendar occurrence. Undated group tasks use the group's configurable interval (six hours by default), slow to daily after three unanswered follow-ups, and reset that streak after meaningful task activity.

The same loop invokes a separately scoped Study reminder pass after normal task processing. It derives candidates from PostgreSQL, verifies the private group before every pass, applies Study workspace quiet hours and its daily cap, and claims a unique `StudyReminderDelivery.dedupeKey` before sending. Saturday review, Sunday preview, due mistake reattempts, red modules, Canvas uncertainty, important deadlines, optional study blocks, and missing timed practice therefore remain restart-safe without creating a second scheduler. Eligible candidates are sorted by product urgency before scheduled age so overdue and near-due work cannot be displaced by housekeeping when the daily cap is reached. A Study pass failure is isolated and cannot interrupt ordinary Threadwise reminders.

This avoids in-memory timers. If Render restarts, the database remains the source of truth.

Scheduled reminders use a separate early-warning cadence. If `dueNudgeMinutes` is 5, a dated task starts warning 5 minutes before the due time, then repeats every 5 minutes until it is done, snoozed, canceled, or rescheduled. Early-warning deliveries bypass quiet hours and daily safety limits because they represent an explicit dated reminder window; undated recurring reminders still respect quiet hours and the safety limit.

Daily and weekly recurring reminders store `recurrenceRule` plus `recurrenceIntervalDays` on the task row. After each recurring delivery, the reminder pass advances `dueAt` and `nextReminderAt` to the next future occurrence instead of creating another task row. This keeps recurring reminders O(1) per delivery and avoids duplicate task buildup.

Changing `/settings interval` or natural text such as `remind me again every 3 hours` updates the current personal or group workspace setting and reschedules open tasks onto the new cadence without pulling future first scheduled reminders before their due time. New personal workspaces default to three hours; new group workspaces default to six. For short repeat timings, Threadwise also raises an obviously-too-low daily safety limit so the new cadence can actually repeat. The default safety limit is 200 reminder messages/day, high enough for normal reminder-bot use while still guarding against accidental loops. Turning quiet hours off rechecks open tasks, so reminders that were deferred by quiet hours can become eligible again.

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
- Calendar auto-sync: one best-effort provider request after the corresponding Threadwise write, with the saved Threadwise record retained if the provider is unavailable.
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

Google Calendar is the only active personal-workspace mirror. Threadwise's PostgreSQL rows remain authoritative, so a provider outage never rejects or removes a task that was successfully captured.

Google Calendar stores encrypted per-user OAuth tokens and one durable provider event ID on each synchronized task. The public task ID plus `userId` is the lookup key. Creating, renaming, rescheduling, or changing recurrence patches the same primary-calendar event. Removing an event clears the provider linkage without deleting the Threadwise task. The optional `calendarAutoSync` setting applies best-effort synchronization after task writes; an explicit bulk sync backfills eligible dated tasks.

For a finalized group availability poll, Calendar is an explicit per-member mirror. A member can opt in or add/remove the meeting after finalization; the shared poll remains authoritative and unaffected by provider failure. Each `(pollId, telegramId)` pair maps to at most one Google event, and its URL is returned only to that signed-in member.

Microsoft Excel and Expenses are frozen experiments. Their services, schema, OAuth records, and stored data remain intact to avoid destructive cleanup, but active menus, onboarding, help, search, settings, and dashboard navigation must not expose them. The retained compatibility code stores encrypted Microsoft OAuth tokens plus workbook metadata and can mirror confirmed expenses; it is not part of the current product promise.

OAuth pending-state rows bind the signed-in Telegram user, expire, and can preserve a selected task or requested auto-sync setting across the provider redirect. Dashboard callbacks return to the Connections tab; Telegram-initiated callbacks send a concise completion message. Provider status and mutations are exposed through the signed dashboard API, never directly to the browser database layer.

Normal task cards do not display long template URLs. Users interact through a contextual Calendar button, dashboard Connections, or plain-language requests. `/calendar` remains a compatibility entry point.

Gmail was removed from the active runtime in July 2026. Its legacy schema objects are retained inertly to avoid destructive data removal during the lifecycle revamp and should only be dropped in a separately reviewed retention migration.

## Beacon dual-bot boundary

Beacon is an optional second grammY `Bot` instance created in `src/main.ts`. It shares the Fastify process, Prisma client, PostgreSQL database, and Render service with Threadwise, but uses a separate Telegram token, webhook path, update-id table, command list, allowlist, and `Community*` tables. The process derives a Telegram webhook header secret from the Beacon token, supplies it to `setWebhook`, and rejects requests without a timing-safe header match.

```text
Telegram → primary webhook → Threadwise bot → User / Group / Study domains
Telegram → Beacon webhook  → Beacon bot     → Community* moderation domain
```

`BEACON_TEST_CHAT_ID` and `BEACON_PRODUCTION_CHAT_ID` are the only chats Beacon recognizes. `BEACON_OWNER_TELEGRAM_ID` is the immutable authorization root. Group rows can change operational settings but cannot redefine that root. Moderator capabilities never include moderator management.

Sensitive configuration uses Telegram private chat as the control plane. `CommunityControlSession` stores only the authorized operator's selected group and current trigger-library filters. Every callback rechecks owner/moderator access; a deep link may select a group only after the same server-side authorization. Public group menus never render trigger values, report evidence, moderator permissions, audits, or safety configuration.

Beacon's interface is role-adaptive and progressively disclosed. The ordinary public group card contains only Rules and How to report. The owner private home contains Review queue, Members & offences, Policy, and More; a moderator private home contains Review queue, Rules, More, and Submit trigger only when explicitly granted. Policy contains owner-only trigger, scoring, automatic-action, and pending-submission controls. More contains only operational destinations the current actor can actually use. Rendering hides unavailable controls, while `controlAccess.ts` and callback handlers independently reject owner-only, private-only, stale, or crafted callback data.

Moderator trigger contributions are staged rather than trusted implicitly. A moderator with `canAddTriggers` writes only to the review-only Watchlist with `pendingApproval = true`. Pending rows are excluded from `policyTriggersForGroup`, cannot replace an existing normalized trigger, and become enforceable only after the owner approves them or moves them into a chosen action group. Removal, severity changes, trigger-group management, and automatic-action changes are separate permission columns.

Beacon's message path is deterministic:

1. Claim the Beacon-specific Telegram update ID.
2. Reject chats outside the configured allowlist.
3. Resolve owner, active moderator, trusted member, or ordinary member access.
4. Handle an active private configuration conversation, member report, public rules/report-help request, or role-adaptive owner/moderator command.
5. Exempt owner, active moderators, and trusted members from automatic enforcement.
6. Evaluate lockdown/new-member/flood/duplicate/mention controls.
7. Normalize Unicode and Zawgyi text, then evaluate database-backed word, phrase, and domain triggers.
8. Notify privately in Observe mode or execute the confirmed configured action in Active mode.
9. Record moderation actions and configuration audits independently of Telegram message delivery.

Report evidence is bounded and expires. Duplicate reports use `(groupId, sourceMessageId)` plus a per-reporter unique key, so one message produces one review case and one reporter cannot inflate it repeatedly.

The initial report card exposes only Dismiss, Take action, and Offence history. Take action edits that card and reveals only warning/deletion/mute/score/ban operations the current actor is permitted to execute. Trigger values remain owner-only through current menus, natural-language search, legacy callbacks, approval routes, and audit summaries; a permitted moderator can submit a non-enforcing trigger proposal only in Beacon's private chat. Permanent report bans and score-threshold bans use confirmations bound to the actor, group, target, source report/offence, topic context, and expiry.

Forum topics share one group policy. The report and moderation-action records preserve `message_thread_id`; warnings are sent back into that thread and private review/audit surfaces display the source topic. This keeps context without introducing premature per-topic rule trees.
