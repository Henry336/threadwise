# Changelog

## v0.19.0 - 2026-07-17

### Added
- Replaced the crowded Telegram reply keyboard with one persistent `Menu` control and one direct `Dashboard` Web App control.
- Added compact, edit-in-place modes for tasks, notes, ideas, images, expenses, search, settings, help, and privacy, with five-item pagination and parent-aware navigation.
- Added a fresh bottom-anchored control card whenever the persistent Menu button is pressed, while retiring the previous menu card's buttons when Telegram permits it.
- Added `/dashboard`, `/privacy`, natural dashboard/privacy requests, production dashboard deep links, and plain-language privacy disclosures during onboarding.
- Added a subject-scoped dashboard API for collection pagination, CRUD actions, settings, search, idea-to-task conversion, Excel synchronization, integration disconnects, data export, and confirmed account deletion.
- Added an authenticated Telegram image proxy with bounded downloads, timeouts, safe raster MIME types, and defensive browser headers.

### Changed
- Tasks are now presented as the underlying object and reminders as their optional schedule, removing the previous task/reminder duplication from primary navigation.
- Typed edits return a fresh, complete item card with contextual actions. Button-driven edits keep updating the current card in place.
- Task IDs and reminder-delivery counts are hidden from normal cards and lists; durable IDs remain available to advanced slash-command workflows.
- Public IDs advance from the highest existing suffix so deleting an image or expense cannot cause an older identifier to be reused.

### Security
- Dashboard mutations derive the canonical user only from a short-lived signed Telegram subject; browser requests never supply a database user ID or receive database, bot, file, or OAuth credentials.
- Privacy exports omit provider tokens, Telegram file identifiers, embeddings, and raw provider credentials. Permanent deletion requires an exact confirmation phrase.

## v0.18.0 - 2026-07-17

### Added
- Expanded deterministic natural-language coverage for conversational list, reminder, task, note, idea, search, completion, snooze, reschedule, cancellation, importance, undo, and settings requests.
- Added dotted clocks such as `1.30pm` and `13.30`, spoken clocks such as `quarter past one`, parts of day, numeric day-first dates, weekday shorthand, `EOD`, `next week`, and `next month` without requiring an AI token.
- Added persistent Main menu and back routes across nested inline task, note, idea, image, expense, search, archive, settings, and help cards.

### Changed
- Telegram inline-button actions now update the current message card in place whenever Telegram permits it, instead of adding a new bot message for each step.

### Fixed
- Fixed dotted times such as `1.30pm` being reduced to `1:00 AM`; the exact minute and meridiem are now preserved.

## v0.17.1 - 2026-07-14

### Changed
- Completed the full Threadwise personality pass across tasks, notes, ideas, reminders, images, expenses, search, settings, archives, integrations, confirmations, empty states, errors, and undo flows.
- Added consistent semantic emoji to headings and buttons while keeping normal sentences and group reminders restrained.
- Reworked routine copy to lead with the outcome, use warmer plain language, and always explain the safest next step after an error or reversible change.
- Added a durable voice-and-tone guide for future features so new wording stays recognizably Threadwise.

## v0.17.0 - 2026-07-14

### Added
- Added a persistent private-chat menu beneath Telegram's reply box, with `/menu` to restore it and a `Hide menu` control. Group navigation remains inline and mention/reply-gated.
- Added editable image captions, caption prompts, duplicate-caption updates, and undo for caption changes.
- Added saved-image search across captions, local OCR text, and filenames through `/images <query>`, `/search images <query>`, and broad natural-language requests.
- Added `Save + extract`, which preserves the original image and saves searchable OCR text without an API key even when no note, task, reminder, or expense is created.
- Added confirmed image deletion and edit/delete controls beneath reopened images.

### Changed
- Refreshed primary menus, image flows, onboarding, and help with restrained semantic emoji and warmer wording while keeping button text explicit.
- Expanded image natural language for phrases such as `save this as Mum's passport scan`, `keep this image with caption July electricity bill`, `caption image 2 as July bill`, and `find images captioned passport`.
- Expanded image help with recurring reminder examples, caption/search/delete examples, and API-key-free OCR behavior.

## v0.16.0 - 2026-07-14

### Added
- Added optional original-image storage through Telegram file references. Uncaptioned images now offer Save image, Extract text, Read as receipt, and Discard buttons; saved images can be browsed 10 per page with `/images` and reopened with `/image IMG-1`.
- Added calendar-aware monthly recurring reminders, including natural phrasing such as `remind me to pay rent on the 1st of every month at 9am`.
- Added compact inline navigation menus to `/start` and `/help` for tasks, reminders, notes, ideas, images, expenses, integrations, settings, search, and cleanup.

### Changed
- Expanded local natural-language routing with polite wrappers, more verbs and list phrases, informal task/idea/note capture, completion/snooze/reschedule/cancel variants, and common shorthand cleanup.
- Expanded relative-time parsing to support hedged compound durations such as `in about 1 hour 15 mins`, `in roughly 2 hours and 30 minutes`, and `90 minutes from now` without an API token.
- Image help now explains original-image storage, local OCR, receipt extraction, saved-image browsing, and English/Burmese settings.

### Fixed
- New reminder nudges now replace the bot's previous reminder message for the same task when Telegram permits deletion, reducing repeated-message clutter without risking delivery.
- Compound duration parsing now ignores unrelated earlier uses of words such as `in`, so phrasing such as `buy groceries in town in 2 hours` remains schedulable.

## v0.15.1 - 2026-07-12

### Fixed
- Restored 10-row pagination with Prev/Next buttons for active tasks, saved notes, and saved ideas across both slash commands and natural-language list requests.
- Later pages now retain global list numbers, so the displayed number and commands such as `/task 11`, `/note 11`, or `/ideas 11` refer to the same item.
- Removed the old 15-item notes/ideas and 50-item tasks retrieval ceilings so older active items remain reachable through pagination.

## v0.15.0 - 2026-07-12

### Added
- Added several assignees per shared task through both natural language and slash commands, with backward-compatible migration of existing single assignments.
- Added optional private deadline nudges for assignees who have opened Threadwise privately and enabled `/settings dm on`.
- Added selective unassignment such as `remove @alex from task 2` and `/unassign 2 @alex`; omitting the person still clears all assignees.

### Changed
- Group reminders render every Telegram assignee as a clickable mention, while plain names remain available as display-only assignees.
- Assigned-task confirmations explain Telegram's one-time private-chat opt-in requirement.
- Expanded deterministic reminder parsing for phrases such as `remind Dad and @alex to check the bot at 10 pm`.

### Reliability
- Private nudge delivery is isolated from the group reminder: an unavailable or non-opted-in recipient is skipped without failing the shared reminder.
- Reminder diagnostics now report private nudges sent, skipped, and failed.

## v0.14.0 - 2026-07-12

### Added
- Added bulk task completion through natural phrases such as `complete tasks 1, 2 and 3` and slash syntax such as `/done 1 2 3`.
- Added bulk removal for tasks, notes, and ideas, including numeric ranges and stable public IDs.
- Added durable 15-minute bulk-action previews with itemized Confirm/Cancel buttons; only the requesting Telegram user can act on the preview.

### Changed
- Bulk “delete” stays recoverable by archiving tasks, notes, and ideas for `/restore`.
- Added a centralized group-update gate so disabling BotFather privacy does not expose ambient group conversation to capture, OCR, edits, or natural-language routing.

### Security
- Unaddressed group text, photos, image documents, and captions are discarded before feature handlers; slash commands, replies, and actual bot mentions remain allowed.

## v0.13.1 - 2026-07-12

### Fixed
- Corrected the group setup guidance: Telegram privacy-enabled bots receive commands and replies, but Telegram does not deliver ordinary sentences merely containing the bot's `@username`.
- `/groupcheck` now reports Telegram group privacy from the live bot identity and gives the exact BotFather `/setprivacy` instructions when it is enabled.
- Documented that Threadwise continues ignoring unaddressed group conversation after BotFather privacy is disabled.

## v0.13.0 - 2026-07-12

### Added
- Added per-user expense currency preferences with regional defaults, broad ISO-code support, common currency names/symbols, and natural settings such as `set my expense currency to MMK`.
- Added best-effort receipt currency detection with the user's saved currency as a fallback, including kyat/MMK markers and Myanmar digits.
- Added post-save expense corrections through `/expense edit EXP-2 currency USD` and natural phrases such as `change currency of EXP-2 to USD`.
- Added bundled Burmese Tesseract data for local, API-key-free English, Burmese, or mixed OCR, with saved preferences and per-image caption overrides.
- Added `/groupcheck` for deployed version, bot username, group ID, sender ID, and allowlist diagnostics.
- Added release version and Render commit metadata to `/health`.
- Finished the existing compact reminder mode with natural settings such as `use compact reminders` and `/settings mode compact`.

### Changed
- Changing timezone also changes the regional currency default when the user has not explicitly selected a custom currency.
- Telegram webhook registration now explicitly requests message, callback-query, and membership updates.

### Fixed
- Initialized the Telegram bot identity before webhook registration so the first group mention has the exact runtime username available to mention routing.
- Avoided duplicate Excel rows after correcting an expense that was already synchronized; Threadwise preserves the sync marker and explains that the old workbook row needs manual correction.
- Fixed natural `change currency of EXP-2 to MMK` wording so the value is applied to the currency field instead of being treated as an incomplete edit.

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
