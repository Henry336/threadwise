# Changelog

## Unreleased

### Added
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
