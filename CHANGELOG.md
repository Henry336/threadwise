# Changelog

## v0.24.0 - 2026-07-22

### Product focus
- Established **Capture, Coordinate, Recall** as Threadwise's product hierarchy and adopted: “Threadwise turns Telegram messages into things people can find, remember, and finish.”
- Removed Expenses and Excel from active menus, help, settings, image actions, status, and dashboard navigation while preserving their implementation and stored data for later evaluation.
- Kept Google Calendar available as a secondary task integration rather than a headline product category.

### Quiet capture
- Replaced routine task, note, and idea result cards with compact acknowledgements that remove themselves after about 3.5 seconds.
- Kept parsed dates, time zones, recurrence, and assignees visible when confirming tasks so users can still catch an incorrect interpretation.
- Limited self-cleaning behavior to successful capture acknowledgements; errors, warnings, item details, menus, and actionable controls remain visible.

### Identity
- Introduced the faceless threaded-path product mark and Ari, the related Threadwise mascot, as a two-part identity system.
- Reserved Ari for onboarding, empty states, and friendly recovery moments; normal product chrome uses the quieter corporate mark.
- Added scalable light/dark/full mascot artwork and a Telegram-ready 512×512 avatar asset in the dashboard repository.

### Quality and records
- Added timer and callback regression coverage for self-cleaning acknowledgements plus focused-copy, hidden-feature, and interpretation-preservation assertions.
- Recorded the observed capture friction, scope decisions, brand rationale, safeguards, and follow-up in the product journal.
- Verified the release with all 520 backend tests in a single worker, TypeScript typechecking, and a clean production build.

## v0.23.0 - 2026-07-22

### Integration lifecycle
- Replaced command-sequence onboarding with concise button-first Calendar and Excel panels in Telegram and direct provider management in the personal dashboard.
- Added contextual Calendar actions to dated task cards, including connect-and-sync intent preservation through OAuth, durable update/remove/open actions, recurrence-aware events, eligible-task backfill, and optional automatic synchronization.
- Made linked task edits patch the same Google event and made task cancellation ask whether to remove the linked event.
- Made first-time Excel connection create a recommended OneDrive workbook and import existing expenses, with open, retry sync, workbook setup, disconnect, and optional automatic synchronization for new expenses.
- Added deterministic natural-language actions for common Calendar and Excel goals without requiring command memorization.

### Product scope
- Retired Gmail from commands, menus, routing, callbacks, scheduled work, status, environment configuration, and active provider code.
- Kept legacy Gmail schema objects inert for a later separately reviewed retention migration instead of coupling product retirement to destructive data removal.
- Kept Calendar and Excel personal-only; group workspaces continue to expose only shared collaboration data.

### Reliability and records
- Kept Threadwise as the source of truth: external provider failures cannot discard a task or expense that was already saved.
- Expanded authenticated dashboard snapshots and routes with provider identity, sync coverage, auto-sync settings, task-level Calendar actions, and Excel workbook lifecycle controls.
- Added `docs/PRODUCT_JOURNAL.md`, reconstructed the major product phases from repository evidence, recorded the integration friction and rationale contemporaneously, and established a maintenance template for future decisions.

### Quality
- Added migration coverage for Calendar/Excel auto-sync preferences and OAuth return intent.
- Added regression coverage for dashboard integration state, selected-task OAuth authorization, disconnect settings, and live revision behavior.

## v0.22.1 - 2026-07-22

### Reminder navigation
- Added a `View full` button to scheduled reminder cards. It expands the current Telegram message in place and returns to the compact reminder with one tap.
- Reused the preserved capture text when older reminders do not have a separate description, so expanded reminders still show their full context.

### Quality
- Added regression coverage for the reminder-only expand action and the preserved-text fallback.

## v0.22.0 - 2026-07-22

### Group workspace boundaries
- Revalidated Telegram owner and administrator status at the moment a privileged dashboard action is attempted, so a recently demoted manager immediately loses access instead of inheriting a cached role.
- Restricted assigning or reassigning other people to Telegram group owners and administrators while preserving each member's ability to accept, decline, block, unblock, remove, or hand off their own assignment.
- Kept Expenses and personal integrations out of group dashboard snapshots, search, capture, and mutation routes; they remain private-workspace features.

### Quality
- Added regression coverage for live role demotion and unauthorized assignment creation, and verified the dashboard collaboration boundary against the shared Telegram records.

## v0.21.2 - 2026-07-21

### Fixed
- Prevented Prisma, provider, connection, stack-trace, and configuration details from leaking into Telegram replies; failures now use short recovery guidance appropriate to the error category.
- Added a final bot-wide error boundary so previously unguarded message handlers receive a normal failure reply and callback handlers receive a Telegram alert instead of silently dying.
- Stopped “Give me a reminder…” from being misread as “give task … to …”; task assignment through “give” now requires an actual task number or `TASK-…` reference.
- Preserved useful validation messages such as missing current list numbers while still hiding unexpected implementation failures.

### Quality
- Added regression coverage for the exact reported reminder phrase, task-assignment disambiguation, Prisma errors, database outages, unknown runtime failures, callback alerts, and message fallbacks.
- Verified all 513 tests and the production TypeScript build with one worker at a time.

## v0.21.1 - 2026-07-20

### Fixed
- Restored numbered Telegram note buttons: new list pages use short public note IDs, while note lookup also accepts the row UUIDs embedded in already-sent list messages.
- Added regression coverage for both newly generated and already-delivered note callbacks so opening a note remains backward-compatible across deployments.

## v0.21.0 - 2026-07-19

### Shared group work
- Added acknowledgement states for every task assignee: awaiting reply, accepted, declined, and blocked, including optional blocker or decline context.
- Added task handoffs, assignment activity history, compact `my tasks`, unassigned, and blocked views, plus natural-language equivalents for the same group workflows.
- Added group task buttons for accepting work and reporting a blocker without turning Telegram into a wall of controls.

### Group dashboard API
- Added member workload, attention, weekly movement, handoff, and activity snapshots backed by the same shared task records used by Telegram.
- Added authenticated assign, unassign, accept, decline, block, unblock, and handoff actions with role-aware permissions.
- Mirrored dashboard task and assignment changes back to the Telegram group quietly, while live dashboard events keep open browsers current.

### Quality
- Added a guarded Prisma migration for collaboration state and activity history.
- Verified all 502 bot tests, TypeScript typechecking, and the production build with a single-worker, low-load release pass.

## v0.20.0 - 2026-07-19

### Group workspaces
- Rebuilt `/start`, `/menu`, `/help`, `/commands`, `/privacy`, and settings around compact group-specific copy and controls instead of reusing the private-chat interface.
- Restored topic-specific `/help <topic>` guidance in groups and uses Telegram-compatible URL buttons for shared dashboards, since inline Mini App buttons are private-chat-only.
- Added durable group workspace and membership records while preserving the existing chat-scoped task, note, idea, image, expense, setting, and reminder ownership.
- Added Telegram role refreshes, membership lifecycle updates, admin-only group settings, and explicit separation from personal Gmail, Calendar, and Excel connections.

### Shared dashboard
- Added signed-human-to-shared-workspace authorization with opaque workspace selection and live Telegram membership verification.
- Added shared dashboard CRUD, capture, search, saved images, expenses, Idea Briefs, settings, and live update streams without allowing a group URL to address a private workspace.
- Kept personal integrations and destructive personal account controls unavailable in group scope.

### Quality
- Added regression coverage for compact group menus and help, personal/group owner validation, and live membership-gated dashboard resolution.
- Made group-safe keyboards unconditional: a missing workspace lookup now omits the dashboard URL instead of ever falling back to a private-only Mini App button.

## Unreleased - Database Connection Hardening

### Fixed
- Bounded the long-running Prisma pool to three connections and automatically use Supabase transaction pooling for runtime traffic, preventing a small session pool from being monopolized during Render deploys.
- Separated Prisma migration traffic through optional `DIRECT_URL`, limited migrations to one connection, and rejected accidental transaction-pooler migration URLs with a clear error.
- Added a read-only migration gate that skips the dedicated migration session only when every checked-in migration name is recorded as successfully applied and no migration is unfinished or rolled back.
- Moved database migrations into Render's pre-deploy command so the web process starts only after schema checks complete.

### Verified
- Retained Threadwise's existing singleton Prisma client and graceful `SIGTERM` disconnect path; Telegram users share the server pool rather than opening one permanent connection each.

## Unreleased - Dashboard Revamp Phase 3

### Changed
- Reworked Telegram task, note, and idea lists into three-item pages with compact summaries, a single numbered button row, and shorter pagination controls for mobile chats.
- Rebuilt opened task, note, and idea cards around a clear type, title, content, and essential context hierarchy; repeated titles, database IDs, captured-source blocks, and verbose settings metadata are no longer shown.
- Consolidated item actions into fewer rows and removed duplicate back buttons while preserving edit, pin, snooze, complete, archive, cancel, and Idea Brief controls.
- Updated post-edit and post-action cards in place with the same clean item layout and a single contextual return path.

### Quality
- Added regression coverage for compact page controls, de-duplicated task details, clean note and idea views, and the revised mobile button layout.

## Unreleased - Dashboard Revamp Phase 2

### Added
- Added saved AI Idea Briefs to the authenticated dashboard, using the bot's configured server-side AI provider to score buildability, usefulness, novelty, portfolio value, monetization, difficulty, and risk.
- Added durable image favourites with a guarded database migration, optimistic revision protection, and favourite-first ordering in both the dashboard gallery and Telegram image queries.
- Added right-click and ellipsis action menus for notes, ideas, and images, including edit, pin or favourite, convert, archive, and confirmed deletion flows.

### Changed
- Dashboard note and idea snapshots now preserve pinned ordering and saved idea analysis across refreshes and Telegram-driven updates.
- Image updates now support caption and favourite changes together without weakening the existing caption undo trail.
- Idea analysis is scoped exclusively from the signed Telegram subject; AI credentials remain server-side and are never exposed to the browser.

### Quality
- Added regression coverage for authenticated Idea Brief generation and persistence, image favourite revision guards, the idea-analysis route, and the expanded dashboard snapshot contract.

## Unreleased - Dashboard Revamp Phase 1

### Added
- Added one universal dashboard capture pipeline that reuses Threadwise's deterministic natural-language parser and AI structuring for tasks, notes, ideas, and expenses, including dotted clocks such as `1.30pm`.
- Added authenticated server-sent dashboard change events backed by lightweight revision fingerprints across tasks, notes, ideas, images, expenses, settings, and integrations.
- Added optimistic revision checks for dashboard task, note, and idea edits so a stale browser tab cannot silently overwrite a newer Telegram or dashboard change.
- Added first-class dashboard task snoozing and exposed snooze and reminder schedule state in dashboard snapshots.

### Changed
- Dashboard task collections now default to newest-first ordering while retaining pin priority.
- The dashboard API now exposes an explicit snapshot refresh route, capture preview route, and live event stream.

### Quality
- Added regression coverage for dotted-time capture, explicit capture modes, expense capture, live revision changes, and stale-edit conflict rejection.

## v0.19.4 - 2026-07-17

### Fixed
- Normalized legacy and new quiet-hour settings to canonical `HH:mm` values so one-digit hours cannot break the authenticated dashboard snapshot.
- Added a guarded database backfill and constraints for existing quiet-hour values.
- Made dashboard API serializers tolerate legacy clock values during rolling deployments.

## v0.19.3 - 2026-07-17

### Added
- Added an AI-powered Idea Brief button to Ideas mode and every saved idea card.
- Added a guarded Supabase Seoul-to-Singapore migration workflow with preflight, exact verification, retry safety, and rollback documentation.

### Changed
- Replaced the long settings manual with compact button-first reminder, region, language, integration, and privacy panels.

## v0.19.2 - 2026-07-17

### Fixed
- Open dashboard and gallery links as identity-bearing inline Telegram Mini Apps instead of unauthenticated simple keyboard Web Apps.
- Rotated the first-party dashboard signing key and prevented a stale multiline Render variable from shadowing the reviewed bundled public key.

## v0.19.1 - 2026-07-17

### Fixed
- Removed the legacy long-form onboarding response from `/start`; private chats now receive only a one-line shortcut confirmation followed by the compact interactive menu.

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
