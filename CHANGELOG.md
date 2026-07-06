# Changelog

## Unreleased

### Added
- Added protected admin reminder run and status endpoints for cron or uptime fallback checks.
- Added `/important` as a friendlier task alias for `/pin`.
- Added `/version` with app version, deploy/start time, AI/Gmail status, and reminder delivery diagnostics.
- Added a tiny `/start` onboarding checklist for timezone, first task, and first note setup.
- Added in-memory reminder diagnostics for last run, due tasks found, reminders sent, quiet-hour deferrals, daily-cap skips, and delivery failures.

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
