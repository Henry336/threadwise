# Changelog

## v0.12.0 - 2026-07-12

### Added
- Added calendar-aware yearly recurrence and natural phrases such as `every Friday`, `on Fridays`, `every year`, `yearly`, and `annually`, alongside expanded daily wording such as `nightly`.
- Added deterministic recurring-reminder coverage for `remind me to sleep at 12 am daily`, `remind me to take out the trash every Friday at 7 pm`, and `remind me of my mom's birthday on 26 July every year`.
- Added addressed group examples for daily, weekday-weekly, and yearly recurrence, using the same natural-language parser as private chats.

### Fixed
- Fixed bot mentions beside punctuation by stripping the actual Telegram mention entity instead of relying only on surrounding whitespace.
- Addressed group greetings and unclear requests now receive a useful response instead of silently disappearing.
- Fixed recurring tasks advancing once on reminder delivery and again on completion; delivery now keeps the current occurrence active, and completion alone advances the schedule.
- Recurring schedules now advance by local calendar day, week, or year instead of fixed day counts, preserving the intended local time through calendar changes.
- Fixed same-day weekday reminders unnecessarily jumping to the following week when the requested time was still ahead.

## v0.11.2 - 2026-07-12

### Fixed
- Repeated completion presses are now idempotent: an already-completed task is not updated again and does not create another completion undo entry.
- Stale Complete buttons now respond with `Task already completed` and a dedicated Restore task button.
- Restoring a completed task reopens it, clears its completion timestamp, safely schedules its next reminder, and supports undo.
- Slash and natural-language completion requests use the same already-completed response instead of reporting a false new completion.

## v0.11.1 - 2026-07-12

### Fixed
- Fixed explicit reminders such as `remind me to finish all tasks by 9 pm` falling through to an undated ordinary task.
- Added deterministic clock parsing for `by`, `before`, `around`, `no later than`, and bare meridiem phrases such as `9pm`.
- Added more reminder starters including `notify me`, `I need a reminder`, `make sure I remember`, `don't forget`, and `reminder:`.
- Explicit reminder requests with a missing or unrecognized future time now ask for clarification instead of silently saving the wrong item type.
- Deadline wording is removed from the visible task title while remaining stored in the reminder details.

## v0.11.0 - 2026-07-12

### Added
- Added local image and receipt text extraction with Sharp preprocessing, bundled English Tesseract data, a 60-second timeout, safety limits, and no OCR or OpenAI API key requirement.
- Added image action previews for saving extracted text as a note, task, reminder, or expense, including caption-driven natural actions.
- Added durable Threadwise expenses with manual and receipt parsing, confirmation/edit/discard flows, duplicate receipt protection, and stable `EXP-*` IDs.
- Added newest-first expense retrieval with all/day/month/year filtering, 10-row pages, and Prev/Next buttons.
- Added broad natural expense capture and retrieval phrases such as `spent`, `paid`, `bought`, `record an expense`, and `what did I spend this month`.
- Added standalone `.xlsx` expense exports that require no Microsoft account.
- Added Microsoft OAuth and optional OneDrive Excel synchronization, automatic timestamped workbook creation, existing workbook selection, exact column validation, token refresh, and encrypted per-user tokens.
- Added focused `/help images`, `/help expenses`, and `/help excel` guidance plus `/expense`, `/expenses`, and `/excel` commands.
- Added database migrations and tests for image routing, expense parsing/filtering, Excel configuration, and real workbook generation.

### Changed
- Made the Threadwise database the expense source of truth; Excel synchronization is an optional mirror and a failed sync does not discard a confirmed expense.
- Made the main `/help` response compact and topic-based so the growing natural-language guide stays readable in Telegram.
- Updated the app description, Render blueprint, environment example, release status, and setup documentation for OCR, expenses, and Excel.

### Security
- Pinned ExcelJS's transitive UUID dependency to a non-vulnerable release; `npm audit` reports no known vulnerabilities.
- Microsoft access and refresh tokens are encrypted at rest with AES-256-GCM.

## v0.10.0 - 2026-07-12

### Added
- Added Google Calendar OAuth with encrypted per-user tokens, connection status/disconnect commands, and idempotent task event creation/update in the user's primary calendar.
- Added automatic fallback from Calendar API sync to the existing no-login template link and `.ics` export.
- Expanded deterministic natural-language coverage across the full command surface, including status/version, Gmail, calendar, search, lists, task actions, pins, archives, restore, edits, settings, ideas, and note analysis.
- Added natural capture phrases such as `write this down`, `remember that`, `I need to`, and `I have an idea for`, keeping common captures useful without an OpenAI token.
- Added polite and indirect reminder phrasing such as `could you remind me`, `don't let me forget`, `nudge me`, and `send me a reminder`.
- Added reminder parsing for word-based durations, half-hours, day-after-tomorrow, noon/midnight, month-first dates, and ordinal dates.
- Added first-class group task assignees with stored Telegram usernames/ids where available, visible `Assigned To` metadata, and `/assign`/`/unassign` plus natural assignment commands.
- Added daily and weekly recurring reminders from natural phrases like `remind me to have dinner at 7pm every day`; recurring tasks advance to the next occurrence after delivery.
- Added first-pass group chat support: group data is scoped to the chat, slash commands work in groups, natural-language messages require a bot mention or reply, and reminders are delivered back into the group.
- Added a natural-language `/help` capability guide and moved the compact slash-command list to `/commands`.
- Added deterministic help-question routing for phrases like `how do I set reminders?`, `help me with notes`, and `how do I view the command list?`.
- Added friendlier natural settings phrases such as `remind me again every 3 hours`, `warn me 10 mins before due tasks`, and `allow up to 200 reminders per day`.
- Added `/googlecal` plus natural phrases like `give me the google calendar link for TASK-1` to retrieve calendar links only when needed.
- Added natural-language list/detail/settings handling for parent-friendly phrases like `show me the notes`, `show me the tasks`, `change timezone to Myanmar`, `set reminder interval to 3 hours`, and `quiet hours off`.
- Added best-effort timezone defaults from Telegram language codes for new users where Telegram exposes a clear language signal.
- Added inline undo and cancel buttons to more task, capture, and edit flows.
- Added note archiving from note list/detail buttons, `/archive note 1`, `/remove NOTE-1`, and natural phrases like `delete note 1`, with undo support.
- Added deterministic-first capture helpers for clear reminders, tasks, notes, and ideas so common Telegram messages do not need OpenAI.
- Added weighted deterministic intent scoring with structured classification reasons in logs.
- Added bounded in-memory AI synthesis caching keyed by content hash.
- Added architecture documentation for deterministic-path time complexity, concurrent request behavior, and likely scaling bottlenecks.
- Added Gmail deterministic importance gating so ordinary unread mail does not spend AI quota.
- Added protected admin reminder run and status endpoints for cron or uptime fallback checks.
- Added `/important` as a friendlier task alias for `/pin`.
- Added `/version` with app version, deploy/start time, AI/Gmail status, and reminder delivery diagnostics.
- Added a tiny `/start` onboarding checklist for timezone, first task, and first note setup.
- Added in-memory reminder diagnostics for last run, due tasks found, reminders sent, quiet-hour deferrals, daily-cap skips, and delivery failures.

### Fixed
- Fixed addressed group messages with bot-mention punctuation so group mode can pass the same natural-language commands into the private-mode parser.
- Fixed group reminder wording like `@threadwise_1_bot remind us to...` and `@threadwise_1_bot remind @user to...` being routed as generic captures instead of scheduled reminders.
- Fixed group-chat bot mentions such as `@threadwise_1_bot remind @user to...` not reliably reaching natural-language reminder handling.
- Raised the default daily reminder safety limit from 5 to 200 so normal reminder-bot usage is not capped too aggressively.
- Improved task, note, idea, pin, review, archive, and reminder message formatting so content appears before IDs/dates and long Google Calendar URLs stay out of normal task cards.
- Fixed saved/archived/detail timestamps using the server timezone instead of the user's configured Threadwise timezone.
- Fixed `after 5 mins` reminder phrasing so it is treated like `in 5 mins`.
- Fixed `/note 1` so numeric note references open note details instead of saving a note titled `1`.
- Fixed reminder target cleanup for phrases like `remind me about the meeting after 5 mins` and `set a reminder for school at 9 am`.
- Renamed task action buttons from `Done` to `Complete task`/`Complete N` to reduce confusion with finishing the save flow.
- Fixed natural minute abbreviations such as `in 60 mins` not being treated as scheduled reminders.
- Fixed additional reminder phrasings such as `remind me about`, `please remind me to`, and `set a reminder for`.
- Fixed AI-backed captures going silent when OpenAI classification, structuring, or embedding calls fail; Threadwise now falls back to deterministic local heuristics.
- Fixed natural reminder text like `remind me to go out in 15 mins` and compact `/remind do this at 4 pm` parsing.
- Fixed OpenAI fallback rotation so rate-limited chat models cool down instead of being retried first on every request.
- Fixed duplicate Telegram update claims so expected duplicates no longer emit Prisma unique-constraint errors.

### Removed
- Removed the unused `OPENAI_EMBEDDING_MODEL` setting; embeddings are intentionally local and deterministic, so capture and search never spend embedding API quota.
- Removed the discontinued reflection feature from active AI classification, provider contracts, public ID generation, and service code.

## v0.9.0 - 2026-07-06

### Added
- Added paginated search results with Prev/Next buttons.
- Added `/search done <query>` and natural-language done-task search.
- Added `/reschedule` and natural-language task rescheduling.
- Added configurable due nudges with `/settings due-nudge <minutes>`.
- Added field editing for task details, note bodies, and idea concepts.
- Added timezone validation, aliases, and onboarding examples for non-Singapore users.
- Added optional Gmail read-only OAuth integration with unread scans, summaries, and follow-up tasks for important messages.
- Added paginated `/help` with Prev/Next buttons.
- Started tracking app release versions in package metadata and this changelog.

### Changed
- Dated reminders now start at `dueAt - dueNudgeMinutes` and repeat on that cadence until the task is done, snoozed, canceled, or rescheduled.
- Default search now shows open tasks only; completed tasks require an explicit done search.
- Hidden inferred tags from freshly saved note/idea cards and recent note/idea lists.
- `/start` now shows first-run onboarding with timezone setup, command examples, and natural-language usage.
- Timezone changes now recheck open tasks and update their display timezone without moving existing due instants.
- Removed the misleading digest setting from public settings help.
- Starred tasks now display as important and receive louder reminder messages with ❗ indicators.
- Paginated `/help` now lists commands alphabetically.

### Removed
- Removed the relationship/reflect command surface from help, commands, natural-language handling, and capture buttons.
- Removed legacy reflections from active search, review, archive, restore, and pin views.

### Fixed
- Fixed completed tasks appearing in normal search results.
- Fixed inline star/unstar buttons for notes and ideas.

## 2026-07-07

### Added
- Added inline star/edit controls for tasks, notes, and ideas.
- Added `/ideas` and idea detail views.
- Added private AI status endpoint and model fallback handling.
- Added note merge previews with retry, confirmation, archive metadata, and undo support.
- Added archived item browsing and restore commands.

### Changed
- Improved fallback note merge quality when OpenAI is unavailable.
- Improved task, note, and idea pinning workflows.

### Fixed
- Fixed reminder interval rescheduling.
- Fixed duplicate Telegram update handling.
- Fixed accidental `bot` tag inference from words like `both`.
