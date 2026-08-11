# Threadwise

Threadwise turns Telegram messages into things people can find, remember, and finish.

Its product hierarchy is **Capture, Coordinate, Recall**: save useful messages, move individual or shared work forward, and retrieve context without digging through chat.

Current backend release: **v0.32.0**

Documentation verified against the backend and dashboard repositories: **2026-08-10**

This repository contains the Telegram bot, domain services, PostgreSQL schema, integrations, and authenticated API. The Next.js dashboard is maintained in the separate `Henry336/threadwise-dashboard` repository.

Current deployment: https://threadwise-90du.onrender.com

Portfolio case study: [CASE_STUDY.md](CASE_STUDY.md)

Product voice and copy conventions: [docs/VOICE_AND_TONE.md](docs/VOICE_AND_TONE.md)

Product decisions, observed friction, and implementation rationale: [docs/PRODUCT_JOURNAL.md](docs/PRODUCT_JOURNAL.md)

Beacon, the separately branded community-moderation bot that can share this Render process: [docs/BEACON.md](docs/BEACON.md)

Study Mode treats the selected module as navigation context, never as implicit permission to file
new content. Text or media without one unambiguous, explicit module is held as a pending capture
until the owner chooses a current module. Canvas synchronization likewise refreshes source metadata
without undoing local archives; newly discovered courses wait for explicit activation.

## Read The Repository

If you are learning Threadwise from its own code, use this order:

1. Read this README for behavior, setup, and boundaries.
2. Read [CASE_STUDY.md](CASE_STUDY.md) for the product problem, decisions, and outcomes.
3. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for request flow, data scoping, reminders, scheduling, and dashboard authentication.
4. Read [prisma/schema.prisma](prisma/schema.prisma) to see the durable state.
5. Start at `src/main.ts`, then `src/server.ts` and `src/bot/index.ts`.
6. Follow a feature from its bot handler into `src/services/`; domain rules belong in services.
7. Read adjacent `*.test.ts` files as executable examples.
8. Use [CHANGELOG.md](CHANGELOG.md) for release history and [docs/PRODUCT_JOURNAL.md](docs/PRODUCT_JOURNAL.md) for the reason behind changes.

```text
Telegram or dashboard request
        ↓
authentication, access, and group-addressing checks
        ↓
deterministic command/natural-language routing
        ↓
domain service
        ↓
Prisma + PostgreSQL
        ↓
small Telegram edit/reply or authenticated dashboard response
```

## What It Does

- Captures ideas with `/idea <text>`.
- Develops an individual idea through the official local Gemini CLI with owner-only Telegram buttons for Develop, Challenge, Next steps, and Task plan. Gemini runs read-only on the laptop worker; suggested tasks are not saved automatically.
- Captures notes with `/note <text>` and structures simple notes locally; longer or explicitly synthetic cleanup can still use AI.
- Transcribes Telegram voice messages into normal Notes with an exact preserved raw transcript, conservative light cleanup or verbatim mode, restart-safe processing, paginated raw-text viewing, and Open/Edit/Undo/Keep verbatim controls. Supported audio files can be enabled separately.
- Starts a private Note session from Notes or `/note_session`: every following message is stored immediately as one exact paragraph, Threadwise stays silent, and Save note combines them into one durable note. Inactive sessions auto-save after about 30 minutes; `/save_note` and `/cancel_note` are fallbacks for a hidden keyboard.
- Retrieves saved notes with `/note 1`, `/note NOTE-1`, or natural text like `show note 1`; `/notes` displays three readable previews per mobile page, while `/notes <query>` searches notes.
- Paginates long note details inside one edited Telegram card instead of truncating the saved body or posting another message for every page.
- Lists saved ideas three readable previews per page with `/ideas` and opens one with `/ideas <1 or IDEA-1>`.
- Merges related notes with `/merge notes 1 2 3`, showing a preview first and allowing retries before confirmation.
- Reviews the current inbox with `/review`, including task pressure, recent notes, and ideas.
- Captures tasks with `/add <task>`.
- Accepts photos and image documents, then offers clean buttons to keep the original, add an editable caption, extract text locally, or save and extract in one step. Extracted text can become a note, task, or reminder; no OCR or OpenAI API key is required.
- Searches saved images by caption, locally extracted OCR text, or filename with `/images <query>`, `/search images <query>`, and natural requests such as `find images captioned passport`.
- Opens saved images with edit-caption and confirmed-delete controls. Deletion removes Threadwise's reusable file reference and search metadata, not the original Telegram message.
- Schedules reminders for specific times with `/remind <when> | <task>`.
- Schedules calendar-aware daily, weekly-on-a-weekday, monthly, and yearly reminders with natural phrases such as "remind me to sleep at 12am daily", "remind me to take out the trash every Friday at 7pm", "remind me to pay rent on the 1st of every month at 9am", and "remind me of Mum's birthday on 26 July every year".
- Sends the first due reminder at the scheduled time, even during quiet hours; later repeat nudges use the current repeat setting and respect quiet hours and the daily safety limit.
- Detects broad natural reminder language such as "could you remind me to call Mum day after tomorrow at noon?", "remind me to go to the bank at 1.30pm", "don't let me forget to submit the form tomorrow afternoon", "nudge me to check the oven in half an hour", and compound timing such as "in about 1 hour 15 mins" without requiring OpenAI. Dotted and spoken clocks, day parts, numeric day-first dates, weekday shorthand, EOD, next week, and next month are handled locally.
- Sends personal recurring Telegram reminders every 3 hours by default. Undated group tasks default to one compact follow-up every 6 hours; after three unanswered rounds they slow to daily until someone interacts with the task. Group admins can change the shared interval from group settings.
- Sends early warnings before dated tasks are due, then repeats them until completion.
- Lists open tasks three readable previews per mobile page with `Choose an item`, `View all`, and Prev/Next controls. Numbered item buttons appear only after the user chooses them; stable task IDs remain available for durable references.
- Keeps ordinary task cards focused on Done, Snooze, and an exact dashboard action. Secondary editing, starring, calendar, cancellation, and assignment management remain available in the dashboard; Telegram list/detail navigation continues to edit the current card in place.
- Supports bulk task completion and bulk task/note/idea removal with an itemized preview, requester-only Confirm/Cancel buttons, a 25-item limit, and no changes before confirmation.
- Labels completion buttons as `Complete task` or `Complete 1` so they are not confused with finishing the save flow.
- Opens exact task, note, idea, image, and TODO-review records in the correct personal or group dashboard workspace instead of sending users to a generic landing view.
- Archives notes from note list/detail buttons, `/archive note 1`, or natural text such as `delete note 1`.
- Shows inline undo and cancel buttons for save, completion, cancellation, snooze, pin, and edit flows where supported; callback-driven text flows reuse the current message instead of filling the chat with successive status cards.
- Supports editing task details, note bodies, and idea concepts with undo.
- Supports rescheduling dated tasks with `/reschedule`.
- Supports `/undo` for recent reversible changes, including saved captures, task completion/cancel/snooze, renames, and pins.
- Supports undo for note archiving so accidental removals can be restored immediately.
- Supports undo for confirmed note merges, restoring the original notes and archiving the generated merged note.
- Marks important tasks and pins notes or ideas with `/pin`, `/star`, and `/pins`.
- Starts a short edit flow from item edit buttons; the next normal message becomes the new title.
- Browses archived notes, ideas, and tasks with paged `/archived <type>` views and restores items with `/restore`.
- Uses clean Telegram HTML formatting with content first, then IDs/dates/settings metadata below.
- Ignores duplicate Telegram webhook updates so retries do not send the same response twice.
- Handles normal messages with deterministic command routing and first-pass classification for tasks, reminders, notes, ideas, lists, edits, search, Calendar, settings, and status. Clear requests work without an OpenAI token; an unclear message immediately offers Task, Note, Idea, and Ignore buttons instead of waiting for AI or remaining silent.
- Searches ideas, notes, and tasks with local lexical and deterministic semantic scoring via `/search`.
- Filters semantic search with `/search tasks <query>`, `/search notes <query>`, and `/search ideas <query>`.
- Searches completed tasks explicitly with `/search done <query>`; normal search only includes open tasks.
- Analyzes notekeeping style with `/note-analysis`, including what works, what does not, and suggested experiments.
- Scores ideas with `/score`, including buildability, usefulness, novelty, portfolio value, monetization, difficulty, risk, competition notes, and dos/donts.
- Generates copy-paste implementation prompts for Codex or Claude Code with `/brief`.
- Connects Google Calendar from Telegram or the dashboard, optionally backfills and automatically synchronizes dated tasks, and keeps one durable event updated after task edits.
- Shows release, AI, and reminder delivery status with `/version`.
- Exposes protected admin reminder endpoints for cron or uptime fallback runs.
- Supports configurable reminder repeat timing, early warnings, quiet hours, timezone, and a high daily safety limit through slash commands or natural language.
- Makes a best-effort timezone guess for new users from Telegram language code when available, then accepts plain-language corrections such as `change timezone to Myanmar`.
- Supports group chats as shared workspaces with chat-scoped tasks, notes, ideas, images, settings, and reminders. The group keeps one public Threadwise anchor; pressing it opens a receiver-bound ephemeral menu visible only to that member, so simultaneous navigation does not collide. Shared work cards remain public. Addressed natural-language messages use the same full deterministic router as private chats. Telegram group privacy must be disabled through BotFather for ordinary `@mention sentence` updates to reach the bot; replies and slash commands work with privacy enabled.
- Provides an owner-only private Study Mode in one separately configured two-member group. It combines deterministic natural-language capture, module-scoped work/notes/questions/images/files, silent note sessions, searchable local OCR, read-only Canvas sync, explainable attention ranking, weekly previews/reviews, complete campus route plans with live NextBus arrivals and walking legs, traffic-light mastery, sessions, mistake reattempts, timed practice, restrained reminders, and a dedicated live Study dashboard without requiring AI.
- Imports a pasted group checklist when it begins with `TODO:` or `ACTION ITEMS:`. Threadwise parses bullets, numbered lines, and plain checked/unchecked rows; preserves done markers, dates, Telegram assignees, and team-owner labels; and leaves uncertain ownership for review instead of guessing. The sender or a group owner/admin can correct rows in the dashboard before committing them; imported rows immediately use the normal shared task and assignment flows.
- Uses strict group activation boundaries: a plain use of the word “Threadwise” or a mention of another bot never triggers capture. Exact bot mentions, replies, slash commands, and the two explicit task-list headings remain intentional entry points.
- Lets a verified group owner/admin create an optional dedicated Threadwise forum topic from group settings. This is an organizational aid, not a requirement; existing groups keep working in their current chat.
- Shows one persistent `Menu` button and one direct `Dashboard` button beneath the Telegram reply box in private chats. Menu re-anchors a fresh compact control card at the bottom; groups keep message-attached inline navigation so the shared composer stays uncluttered.
- Opens the live personal or group web workspace with `/dashboard` or natural requests such as `open the dashboard`, and explains the exact privacy boundary with `/privacy`. A group dashboard is selected through an opaque workspace id, then authorized against the signed-in person's recorded and current Telegram membership.
- Supports several assignees on one group task, including `remind Dad and @alex to check the bot at 10pm`, `assign task 2 to @alex and @sam`, and `remove @alex from task 2`.
- Applies group assignments immediately. Members may claim unassigned work; assignees can complete or snooze it; the task creator or a verified current Telegram group administrator can assign or reassign it. Accept, decline, block, and handoff inputs are retained only as graceful legacy explanations and do not mutate task state.
- Uses progressive disclosure in Telegram: an ordinary card presents one immediate decision with at most three actions across two rows, then moves secondary management into an exact dashboard deep link. Group home always keeps a direct dashboard action, while TODO review links open the precise batch rather than a generic landing page.
- Gives each group a distinct responsive dashboard with Overview, shared Work, People, Progress, Activity, and Resources views. Assignee workload and attention are visible without ranking people.
- Lets a group agree on a meeting time with `/findtime`, `/schedule`, or natural requests such as `find a time for rehearsal next week for 90 minutes`. Members mark availability in a touch-friendly Mini App, one Telegram card updates with response progress and best overlaps, and a verified owner/admin finalizes the time.
- Mentions every Telegram assignee in the group reminder and can also send opt-in private deadline nudges. Each assignee must first open Threadwise privately and send `/settings dm on`; Telegram does not let bots initiate a private chat with someone who has never opened the bot.

## Commands

```text
/start
/menu
/dashboard
/privacy
/help
/commands
/idea build a Telegram bot that...
/note Remember that deployment reliability depends on avoiding sleeping workers
/note 1
/note NOTE-1
/notes
/notes deployment reliability
/note_session
/save_note
/cancel_note
/note-analysis
/ideas
/ideas 1
/merge notes 1 2 3
/archive note 1
/archive notes 1 2 3
/archive ideas 1-3
/remove NOTE-1
/archived notes
/archived ideas
/archived tasks
/restore NOTE-1
/review
/add pay invoice tomorrow at 9am
/remind tomorrow at 9am | submit the form
/tasks
/task 1
/done TASK-1
/done 1
/done 1 2 3
/snooze TASK-1 1h
/snooze 1 1h
/reschedule 1 tomorrow at 10am
/assign 1 @henry_derek and @alex
/unassign 1
/unassign 1 @alex
/mytasks
/undo
/rename 1 Follow up with Sam
/rename NOTE-1 Deployment notes
/rename idea 1 Better idea title
/edit note 2 body Cleaner note body
/edit task 1 details More useful task details
/edit idea 1 concept Sharper idea concept
/pin 1
/important 1
/pin note 2
/star IDEA-1
/unpin NOTE-1
/pins
/cancel 1
/cancel 1 2 3
/delete TASK-1
/delete notes 1 2 3
/delete ideas IDEA-1 IDEA-2
/search reminder bot ideas
/search done curriculum paper
/search tasks invoice
/search notes deployment reliability
/score IDEA-1
/brief IDEA-1
/calendar
/googlecal TASK-1
/googlecal 1
/images
/images passport
/image 1
/image IMG-1
/image caption IMG-1 July electricity bill
/image delete IMG-1
/version
/groupcheck
/findtime project rehearsal next week for 1 hour
/schedule
/settings
/settings interval 180
/settings timezone Asia/Singapore
/settings timezone Asia/Yangon
/settings timezone Myanmar
/settings timezone Malaysia
/settings timezone America/New_York
/settings currency MMK
/settings ocr English and Burmese
/settings dm on
/settings mode compact
/settings quiet 22:00 08:00
/settings quiet off
/settings max 200
/settings due-nudge 3
```

`/start` installs the two persistent private-chat shortcuts and opens the compact button menu without a separate onboarding wall of text. `/help` shows a full capability guide with topic buttons, natural examples, and slash equivalents. Focused questions such as `how do I set reminders?`, `help me with notes`, and `how do I change my settings?` return the relevant help section. `/commands` shows the compact slash-command reference for users who prefer exact commands. Telegram's native slash menu is registered by chat, language, and role: Personal, Group, Study, Beacon owner/moderator, English, and Burmese surfaces show only their relevant commands. The immutable Beacon owner alone sees `/purge`.

Older `/accept`, `/decline`, `/block`, `/unblock`, and `/handoff` inputs are compatibility-only. Threadwise explains the current assignment model without changing state: assignment is immediate, an active member may claim unassigned work, and only the task creator or a freshly verified Telegram owner/admin may reassign existing work.

Normal Telegram messages are also supported. Threadwise checks deterministic command-like intent before any AI work. It understands broad variations including "what's on my plate?", "open my reminders", "keep this in mind: ...", "brainwave: ...", "put this on my list", "give me a heads-up at 1.30pm", "I finished task 2", "put off task 2", "task 2 is due Friday", "I don't need task 2 anymore", "where is the note about passports?", and the existing concise forms. Reminder dates also support numeric and word-based relative durations, dotted and spoken clocks, parts of day, day-after-tomorrow, noon/midnight, weekday shorthand, numeric day-first and named-month dates, EOD, next week, next month, and ordinals. If a message is not recognized confidently, Threadwise responds immediately with Task, Note, Idea, and Ignore choices; the selected action is actor-scoped in groups.

In group chats, `/start`, `/menu`, `/help`, `/commands`, `/privacy`, and `/settings` use short group-specific panels instead of the private-chat onboarding wall. Natural-language requests should mention the exact bot username or reply to one of its messages, for example `@ThreadwiseBot remind @alex and @sam to bring snacks at 5pm`. A deliberate pasted list may instead begin with `TODO:` or `ACTION ITEMS:`. The saved task belongs to the group chat, stores every assignee, and sends reminders back to that group with clickable Telegram mentions. Plain names such as `Dad` are retained for display, but only a Telegram `@username` or Telegram text mention can be matched to a private account. Run `/groupcheck` inside the group to see the deployed version, exact bot username, group ID, allowlist state, and Telegram privacy mode. With BotFather privacy enabled, Telegram may not deliver unmentioned heading blocks to the bot; exact mentions and replies remain reliable.

`/dashboard` inside a group opens that group's separate shared web workspace. The bot should be a group administrator before members use this link: Telegram only guarantees live `getChatMember` checks for other users when the bot is an administrator. If that verification is unavailable, Threadwise fails closed rather than exposing shared content. Group settings, assignment/reassignment, and availability-poll management require a currently verified owner or administrator, except that any active member may claim an unassigned task and each member controls only their own availability. Assignees may complete or snooze their work; accepting, declining, blocking, and handing off are no longer active assignment states. Expenses, the frozen Excel surface, personal export, and account deletion remain personal-only. A finalized group meeting may be copied to each member's own connected Google Calendar without exposing that connection to the group.

The shared dashboard is deliberately practical rather than managerial theatre: **Overview** surfaces overdue, assigned, unassigned, open, completed, and active availability state; **Work** includes confirmed meetings; **People** shows assignment load without ranking people; **Progress** derives the current work picture; **Activity** records meaningful movement; **Resources** collects shared notes, ideas, and visual references; and **Find a time** provides the full availability grid. Historical blocked or awaiting-reply records remain readable, but new assignments do not require those transitions. Web changes use the same database rows queried by the bot and update the compact Telegram card without adding chat clutter.

Private assignee nudges are deliberately opt-in. Each person opens the bot privately once and sends `/settings dm on` (or starts the bot through its `start=dm` link). When a shared assigned task becomes due, Threadwise still posts the normal group reminder and separately DMs every opted-in assignee it can match. Someone who has not started the bot, has disabled DMs, or was entered only as a plain name is skipped without blocking anyone else's reminder. Send `/settings dm off` privately to stop the extra nudges.

Telegram's privacy-enabled bots do not receive ordinary messages merely because the text contains their `@username`; they receive bot commands and replies instead. To enable Threadwise's natural addressed messages, open BotFather, run `/setprivacy`, select the Threadwise bot, and choose `Disable`. Threadwise has its own centralized address gate: unaddressed group text, photos, image documents, and captions are discarded before capture, OCR, editing, or natural-language handling. Slash commands, replies to Threadwise, and messages that mention Threadwise are allowed. If an existing group does not reflect the BotFather change immediately, remove and re-add the bot once.

The same natural-language coverage applies after the bot mention is removed, including notes, tasks, settings, search, and recurring reminders. For example: `@ThreadwiseBot remind us to take out the trash every Friday at 7pm`. Threadwise uses Telegram's mention entities as well as the bot username, so punctuation such as `(@ThreadwiseBot)` or `Hi,@ThreadwiseBot:` is handled correctly. Unaddressed ordinary group conversation remains ignored.

For tasks, `/pin`, `/star`, and `/important` mark the task as important. Important task reminders use a clear "Important task" heading so they stand out from normal task reminders.

For high-confidence tasks, notes, and ideas, Threadwise may save immediately and include `/undo` in the reply.

`TASK-1`, `TASK-2`, and similar public IDs are stable database references and are not reused. `/tasks` also shows active list numbers, so a single open task can be handled as `/done 1` even if its stable ID is `TASK-999`.

Bulk examples include `complete tasks 1, 2 and 3`, `delete notes 1-3`, `remove ideas IDEA-2 and IDEA-4`, `/done 1 2 3`, and `/delete notes 1 2 3`. Threadwise resolves current list numbers before showing the preview. Only the Telegram user who requested the action can press Confirm or Cancel. Bulk “delete” remains recoverable by archiving tasks, notes, and ideas; use `/archived <type>` and `/restore <ID>` to bring one back. Notes and ideas do not have a completed state; completion applies to tasks.

Undoing a newly saved capture archives it out of active lists and search instead of hard-deleting the row. That keeps public IDs durable and avoids future items silently reusing an old ID. Archived items keep an archive reason where available; notes merged into another note also keep the merged-into note reference.

## Reminder Behavior

Reminders are database-driven. Each open task has a `nextReminderAt`, and the reminder loop polls due tasks instead of relying on in-memory timers.

- The first reminder for a scheduled task fires at its explicit due time, even during quiet hours.
- Daily, weekday-weekly, monthly, and yearly recurring reminders keep nudging the current occurrence until it is completed. Completion advances the same task row to the next calendar occurrence, preserving local wall-clock time across timezone and daylight-saving changes.
- When a repeat nudge is successfully sent, Threadwise tries to delete its previous reminder message for that same task. Telegram may refuse deletion of an unavailable or too-old message; that never blocks the new reminder.
- Repeat nudges use the current "remind me again every..." value. Changing it also updates open tasks so old task snapshots do not stay stuck on the previous cadence.
- `/settings timezone <zone>` or natural text such as `change timezone to Myanmar` changes how new dates are parsed, how dates are displayed, how quiet hours are evaluated, and when daily safety limits reset. Existing due instants are not moved, but open tasks are rechecked and shown in the current timezone.
- Telegram does not expose a user's exact device timezone to bots on `/start`. Threadwise makes a best-effort default from Telegram language code when it is clear, then lets users correct it naturally.
- Timezones are validated against real IANA names such as `Asia/Singapore`, `Asia/Yangon`, `Asia/Kuala_Lumpur`, `America/New_York`, `Europe/London`, and `Australia/Sydney`. Common aliases such as `Myanmar`, `Yangon`, `Malaysia`, `Kuala Lumpur`, and `Asia/Myanmar` map to the right IANA timezone.
- Short repeat timings automatically raise an obviously-too-low daily safety limit so `/settings interval 15` can actually keep nudging for more than a few reminders. You can still override the limit with `/settings max <n>`.
- `/settings quiet off` disables quiet hours and rechecks open tasks so reminders deferred by quiet hours can become eligible again.
- `/settings max <n>` sets a daily reminder safety limit. The default is 200 so normal reminder-bot usage is not artificially capped, while accidental loops still have a guardrail.
- `/task 1` shows reminder details, including the next reminder time, repeat timing, daily safety limit, and quiet hours.
- `/version` shows the last reminder loop run, due tasks found, reminders sent, quiet-hour deferrals, daily-cap skips, and delivery failures.

If the process sleeps or an uptime monitor needs a direct fallback, set `ADMIN_STATUS_TOKEN` and call either:

```text
GET /admin/reminders/run
POST /admin/reminders/run
GET /admin/reminders/status
```

Send the token as `Authorization: Bearer <ADMIN_STATUS_TOKEN>` or `x-threadwise-admin-token`. The run endpoint performs one due-reminder pass and returns delivery diagnostics.

Calendar links and synced Google event IDs are stored on each dated task row. That means `TASK-1` maps to one durable Google Calendar event across restarts and deployments. Renaming, rescheduling, changing recurrence, or asking to sync it again patches the same event instead of creating a duplicate.

Open `/calendar`, the Integrations menu, a dated task's `Calendar` button, or the dashboard's Connections tab. Connecting from a task preserves that task through OAuth and synchronizes it immediately on return. The Calendar panel can synchronize eligible dated tasks, enable automatic synchronization, open the calendar, or disconnect. Plain requests such as `put task 1 on my calendar`, `automatically sync my dated tasks`, and `remove task 1 from my calendar` follow the same lifecycle. Canceling a linked task asks whether its Calendar event should also be removed.

Enable the Google Calendar API in the same Google Cloud project and add `https://threadwise-90du.onrender.com/calendar/oauth/callback` as an authorized redirect URI. `GOOGLE_CALENDAR_REDIRECT_URI` can override that URL; otherwise Threadwise derives it from `WEBHOOK_URL`.

`/brief IDEA-1` does not run a coding agent by itself. It creates a structured implementation prompt that can be copied into Codex, Claude Code, or another coding agent after you choose the target repository.

## Image Text Extraction

Send Threadwise a photo or an image document without a caption and it first offers `Save image`, `Save with caption`, `Extract text`, `Save + extract`, and `Discard`. Saving keeps a reusable Telegram file reference rather than copying the image bytes into PostgreSQL. Browse saved images 10 per page with `/images`, say `show my saved images`, or reopen one with `/image IMG-1`.

Choosing extraction reads printed English, Burmese, or mixed text locally and shows a preview with buttons for `Save note`, `Create task`, `Set reminder`, `Show full text`, and `Discard`. A caption can perform an action immediately:

```text
extract the text
keep this image
save this as a note
turn this into a task
remind me about this tomorrow at 9
```

OCR uses bundled English and Burmese Tesseract language data and Sharp image cleanup on the Render server. It does not send the image to OpenAI or another OCR API and needs no API key. Choose a saved default with `read images in Burmese`, `read images in English and Burmese`, or `/settings ocr ...`; an individual image caption can override it. Images are rotated, resized, converted to grayscale, normalized, and sharpened before recognition. The safety limits are 10 MB and 20 megapixels, and recognition times out after 60 seconds. The first image after a deployment or language change may be slower while the OCR worker starts.

For the best result, use a bright, straight, tightly cropped photo with sharp printed text. Screenshots and clear documents work best. Handwriting, curved or blurred photos, unusual fonts, multiple languages, and complex tables may need manual correction.

## Tech Stack

- Node.js + TypeScript
- grammY for Telegram updates, commands, callbacks, reply keyboards, and Mini App links
- Fastify for webhooks, OAuth callbacks, health/admin endpoints, and the dashboard API
- PostgreSQL/Supabase for durable storage
- Prisma for schema and migrations
- Zod for environment validation
- OpenAI-compatible adapter for synthesis tasks, plus local deterministic classification and embeddings
- Tesseract.js with bundled English/Burmese data and Sharp preprocessing for local OCR
- EdDSA JWT verification for short-lived dashboard requests
- Server-sent events for dashboard synchronization
- Private admin endpoints for checking AI status and triggering reminder fallback runs
- Vitest for unit tests
- Render for the backend; Vercel hosts the separate dashboard

## Architecture

```text
src/
  ai/                 AI provider interface, OpenAI implementation, local heuristic fallback
  bot/                Telegram routing, callbacks, cards, Note sessions, ephemeral UI
  config/             Environment parsing
  dashboard/          Authenticated API, workspaces, CRUD, scheduling, realtime events
  db/                 Prisma client and connection-pool normalization
  services/           Domain logic and provider integrations
  utils/              Dates, time zones, OCR languages, HTML, text, and vectors
  codexWorker.ts       Local Codex SDK worker and project discovery
  main.ts             Application entrypoint
  server.ts           Fastify routes, Telegram webhook, OAuth callbacks
prisma/
  schema.prisma       PostgreSQL data model
  migrations/         Ordered production migrations
docs/
  ARCHITECTURE.md     Detailed technical design
  PRODUCT_JOURNAL.md  Friction, decisions, implementation, evidence
```

The important design choice is deterministic-first execution. Common command-like text, settings changes, list/detail requests, classification, task extraction, reminder parsing, simple note structuring, and embeddings are local and quota-proof. AI is reserved for higher-value synthesis such as complex note/idea structuring, note merges, note analysis, and idea scoring. Repeated synthesis calls are cached in memory by content hash so accidental retries do not spend extra quota.

Private users own their own scope. A Telegram group uses a synthetic `chat:<id>` owner for shared data plus human membership/role records for permissions. Dashboard requests always begin with a short-lived signed human identity and only enter a group scope after the opaque workspace and live membership are verified.

## Data Model

Threadwise stores:

- Users, personal settings, group workspaces, memberships, and group activity
- Tasks, multiple assignees, reminders, recurrence, and delivery history
- Notes, durable Note sessions/segments, ideas, and reflections
- Availability polls, per-member responses, and optional Calendar events
- Stored image references, captions, OCR text, and pending image choices
- Pending captures, edits, merges, bulk actions, and paginated searches
- Calendar connections and encrypted OAuth tokens
- Audit logs and processed Telegram update IDs
- Private Codex project registry, active-project state, jobs, thread ids, and report-message routing
- Frozen Expense/Excel records and inert legacy Gmail records retained for data safety

Most removals are soft archives. Search vectors are stored as JSON and scored app-side for personal/small-group scale. See the schema itself for field-level truth.

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Copy environment variables:

```powershell
Copy-Item .env.example .env
```

3. Fill in:

```text
TELEGRAM_BOT_TOKEN=
DATABASE_URL=
OPENAI_API_KEY=
```

`OPENAI_API_KEY` is optional for local smoke testing. Without it, Threadwise uses deterministic local behavior plus heuristic fallbacks for synthesis features such as scoring and note analysis.

`DASHBOARD_URL`, Google OAuth values, `ADMIN_STATUS_TOKEN`, and allowlist settings are optional unless you are testing those features. Never copy production secrets into documentation or commit `.env`.

### API cost behavior

The normal command path does not need OpenAI. Command intent, reminder dates, first-pass classification, settings, edits, lists, archives, calendar exports, embeddings, and search all run locally. Unclear input receives immediate capture buttons rather than an AI call on the response-critical path. If an OpenAI key is configured, chat calls are reserved for synthesis-heavy work such as richer task/note/idea structuring, note merging/analysis, and idea scoring. Remove `OPENAI_API_KEY` to run the bot in local/heuristic mode; every core command remains available.

4. Generate Prisma client:

```bash
npm run db:generate
```

5. Run migrations:

```bash
npm run db:dev
```

6. Start in local long-polling mode:

```bash
npm run dev
```

Leave `WEBHOOK_URL` empty for local development.

Run `npm run smoke:ocr` to verify that both bundled English and Burmese OCR data load and recognize a generated mixed-language receipt without an API key.

## Render Deployment

This repo includes `render.yaml` for a Render web service. PostgreSQL can be hosted separately; set the service's `DATABASE_URL` to the external provider's SSL-enabled connection string.

Set these Render environment variables:

```text
TELEGRAM_BOT_TOKEN
DATABASE_URL
DATABASE_CONNECTION_LIMIT
DATABASE_POOL_TIMEOUT_SECONDS
SUPABASE_RUNTIME_POOL_MODE
OPENAI_API_KEY
OPENAI_MODEL
OPENAI_MODEL_FALLBACKS
ADMIN_STATUS_TOKEN
WEBHOOK_URL
WEBHOOK_SECRET_PATH
BOT_ALLOWED_TELEGRAM_IDS
STUDY_OWNER_TELEGRAM_ID
STUDY_ALLOWED_CHAT_ID
CODEX_OWNER_TELEGRAM_ID
CODEX_TELEGRAM_CHAT_ID
CODEX_WORKER_TOKEN
CODEX_JOB_LEASE_SECONDS
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_CALENDAR_REDIRECT_URI
GOOGLE_TOKEN_ENCRYPTION_KEY
DASHBOARD_URL
```

The Microsoft variables remain in `render.yaml` only to preserve the frozen Excel implementation. They are not required for the active product. Gmail has no active runtime configuration.

`DATABASE_URL` is a Render secret. Threadwise only requires PostgreSQL. The production database was migrated from Supabase Seoul to Singapore in July 2026; [docs/SUPABASE_REGION_MIGRATION.md](docs/SUPABASE_REGION_MIGRATION.md) is retained as the completed, reusable runbook. For an IPv4 Render service, use the appropriate Supavisor pooler connection rather than assuming the direct hostname is reachable.

`WEBHOOK_URL` should be the public Render service URL, for example:

```text
https://threadwise-90du.onrender.com
```

Render should run:

```bash
npm start
```

`render.yaml` runs `npm run db:migrate` as a pre-deploy command and `npm start` as the start command. Use an always-on Render plan if you want reminders to be reliable. If the service sleeps, the database keeps tasks safe, but reminders will only be sent after the process wakes back up.

## Privacy And Access

Threadwise stores private-chat data per Telegram user. A different Telegram user who messages the same bot gets their own ideas, notes, tasks, and settings. They do not see another user's saved data through normal bot commands.

In group chats, Threadwise stores data by chat id instead. Everyone who can use the bot in that group sees the same group tasks, notes, ideas, settings, and reminders. The database represents that shared owner as a synthetic user id such as `chat:-1001234567890`, so the existing service layer can keep enforcing scoped lookups without duplicating every table.

This is application-level isolation, not end-to-end encryption. Content is stored in PostgreSQL in a form the service can process, so the deployment/database operator can technically access it. OAuth refresh tokens are encrypted separately. Do not claim that Threadwise is operator-unreadable unless a future client-side or user-held-key design actually provides that property.

If the deployment should be private to only one person or a small team, set:

```text
BOT_ALLOWED_TELEGRAM_IDS=123456789,987654321
```

You can also allow a whole group by adding its chat id, either as `-1001234567890` or `chat:-1001234567890`. If a group is allowlisted, any member of that group can use the shared group scope. If only individual Telegram ids are allowlisted, group messages from non-allowlisted people are ignored silently so the bot does not clutter the chat.

Leave `BOT_ALLOWED_TELEGRAM_IDS` blank to allow any Telegram user who can find the bot to use their own isolated private scope and any group that adds the bot to use a shared group scope.

## Private Study Mode

Study Mode is a private academic operating system inside the existing Threadwise bot. It uses the same PostgreSQL database and reminder loop, but its records live in dedicated, workspace-scoped study tables and are excluded from ordinary Threadwise search.

The authenticated web dashboard exposes Study Mode only while this exact group workspace is selected. Its dedicated navigation is **Overview, Timetable, Work, Deep Work, Modules, Library, Search, Review, and Settings**. Timetable combines recurring module blocks, planned study work, deadlines, and class-travel configuration; saved travel origins remain under Settings. Personal workspaces and every other group keep their existing interface and cannot discover the Study routes. Direct URLs and API calls return the same opaque not-found response unless the signed Telegram principal, configured owner, configured chat, current Telegram membership, and active database binding all agree.

Telegram and the Study dashboard share the same records rather than synchronizing two copies. Captures and Canvas changes appear through server-sent event reconciliation; dashboard edits are immediately visible when the bot next queries the item. Module selection, mastery, work status, notes, pinned images, mistake records, weekly plans, sessions, Canvas review decisions, origins, and schedule blocks all use the same domain services.

It is disabled unless both exact numeric identifiers are configured on Render:

```text
STUDY_OWNER_TELEGRAM_ID=YOUR_NUMERIC_TELEGRAM_USER_ID
STUDY_ALLOWED_CHAT_ID=YOUR_PRIVATE_GROUP_CHAT_ID
CANVAS_ACCESS_TOKEN=YOUR_CANVAS_ACCESS_TOKEN
CANVAS_BASE_URL=https://canvas.nus.edu.sg/api/v1
STUDY_CANVAS_SYNC_INTERVAL_MINUTES=30
STUDY_TRANSIT_BASE_URL=https://improved-nextbus.vercel.app
```

Only the two Study identifiers are required to activate the private surface. Canvas remains unavailable until its token is configured; Threadwise uses that credential only for read operations. The transit integration uses the public Improved NextBus API and needs no key. Never paste the Canvas token into Telegram or commit it to this repository.

If `BOT_ALLOWED_TELEGRAM_IDS` is in use, its existing rules must also allow the owner in that group. Study Mode then applies its stricter independent gate on every command, callback, guided reply, and proactive delivery:

1. The actor must be the configured owner.
2. The chat must be the configured group or supergroup.
3. The database workspace must be actively bound to that exact chat.
4. Telegram must report that the group contains only the owner and Threadwise.

If another account joins, Study Mode unbinds when Telegram delivers the membership update. Every interactive request and reminder also rechecks the member count and fails closed if privacy cannot be verified. Keep Telegram history hidden from new members as an additional precaution because Telegram, not Threadwise, controls visibility of already-sent group messages.

After the schema migration and environment configuration have been deployed, send `/study` in the exact configured group. Threadwise verifies the sealed group, binds it, and opens button-led onboarding. `/study bind` remains an explicit fallback.

Study Mode is natural-language first. Examples include:

```text
todo: finish tutorial for CS2100 Friday 6pm
CS2100 note: cache misses stall the pipeline
question: why is sign extension needed? for CS2100
open CS2102
start note session
what needs attention?
what is coming up this week?
sync my Canvas assignments
add origin Home at Kent Ridge MRT
when should I leave to COM3 from Home?
```

Reply to an existing Telegram text, link, photo, or document with `save this to CS2100`; add `as a task`, `as a note`, or `as a question` when the type is not obvious. If an ordinary message is ambiguous, Threadwise immediately offers Task, Note, Question, and Resource buttons rather than waiting for AI. Selecting a module creates a visible ten-minute capture context. Switching modules restarts the window, while saving content does not extend it; after expiry, Threadwise asks for a module unless the message or reply already identifies one.

Photos enter a durable pending card instead of being OCR-processed automatically. Save the original image, add or edit its caption, optionally extract searchable text, choose another module, or cancel. Repeated or stale callbacks cannot create duplicate resources.

A Study note session stores every message immediately as one durable paragraph and otherwise remains silent. Save note joins the exact paragraphs with blank lines. After roughly 30 minutes of inactivity, a non-empty session auto-saves and an empty session closes. Long notes are paginated at safe paragraph, sentence, or Unicode boundaries for Telegram; the stored body is not truncated.

Canvas is a read-only mirror, not an LMS replacement. Automatic sync runs every `STUDY_CANVAS_SYNC_INTERVAL_MINUTES`; a manual sync is available in onboarding and through `sync Canvas`. Active, overdue, upcoming, and undated unsubmitted assignments are deduplicated. A Canvas submission closes the linked Study item, while local completion never submits. Local title and due-date overrides are preserved, and assignments that disappear are flagged for Keep local or Archive instead of being deleted.

`What needs attention?` uses an explainable local score based on deadline proximity, overdue age, priority, explicit mastery, backlog age, planned effort, week position, and Canvas uncertainty. It does not call an AI service. Weekly review defaults to Saturday at 8:30 PM and the next-week preview to Sunday at 7:00 PM. Urgent deadlines take precedence over housekeeping when the separate Study daily cap is reached.

`/study setup` asks for the semester name, the Monday that begins Week 1, and the IANA timezone. It seeds the current modules, preliminary timetable, and editable weekly study structure. Saved travel origins can be made default, renamed, or removed; a privately shared current location can temporarily override them for four hours and is deleted when it expires or when the owner presses **I'm here**. Threadwise does not continuously track location.

Study routing resolves NUS venues and bus stops through one canonical catalogue shared by Telegram, timetable destinations, reminders, and dashboard autocomplete. It accepts aliases, asks the owner to choose when a name is ambiguous, and plans the complete trip: initial walk, boarding stop, live bus arrivals, service and transfer legs, alighting stop, final walk, total duration, arrival, and leave time. Provider failure produces a clearly labelled conservative fallback rather than invented live data. Natural examples include `Take me to COM3`, `Navigate to VCR Room`, and `How do I get from PGP to COM3?`.

The main commands are:

```text
/study                  master-sheet dashboard
/study help             concise command reference
/study week             current academic week
/study plan             guided weekly planning
/study add              guided study-item creation
/study done STUDY-1     complete an item without changing mastery
/study processed STUDY-1
/study mastery CS2100 amber optional reason
/study start            start a module/item-linked session
/study stop             stop the active session and record a result
/study mistake          guided mistake record
/study mistakes         unresolved and due reattempts
/study review           guided weekly review
/study upcoming         deadlines and open planned work
/study modules          add, edit, or archive modules
/study schedule         inspect or edit schedule blocks
/study export           send six CSV files
/study unbind           explicit inline-confirmed unbinding
```

Slash commands above are compatibility and precision fallbacks; the button interface and natural phrases are the primary interaction. Core behavior is deterministic and does not require `OPENAI_API_KEY`. Mastery changes only when the owner explicitly records it; completing an item never silently declares a topic mastered. Study reminders share the normal database-backed polling loop but use separate daily caps, quiet hours, durable dedupe rows, and conservative rules for reviews, reattempts, red modules, Canvas uncertainty, important deadlines, optional study blocks, and missing timed practice.

`/study export` sends UTF-8 CSV files for the weekly dashboard, items, sessions, module mastery, mistakes, and weekly reviews. In Excel, use **Data → From Text/CSV**, choose UTF-8 if prompted, and load each file as its own worksheet. PostgreSQL remains the source of truth; re-import is not part of the MVP.

## Beacon Community Moderator

Beacon is an optional second Telegram bot identity running in the same Render process. It shares infrastructure with Threadwise but has a separate token, webhook, allowlist, update claims, commands, and `Community*` data. It has no dashboard and does not present itself as Threadwise.

- Ordinary group members see only **Rules** and **How to report**.
- The immutable owner manages Review queue, Members & offences, Policy, and More from Beacon's private chat.
- Moderators receive only the private operational destinations and report actions granted to them; inaccessible controls are hidden and still rejected server-side if invoked through stale or crafted callbacks.
- Initial report cards show bounded evidence and only **Dismiss**, **Take action**, and **Offence history**. Take action reveals only permitted warning, deletion, mute, score, or ban controls.
- Trigger values, trigger search, severity policy, automatic actions, moderator management, and owner audit history remain owner-only. A permitted moderator can submit a proposed trigger only in private; it cannot enforce before owner approval.
- Permanent bans and other destructive operations use short-lived confirmations bound to the actor, community, target, source report/offence, and topic where applicable.

Use [docs/BEACON.md](docs/BEACON.md) for the complete operating model, BotFather setup, permissions, live-test checklist, failure behavior, and future additions.

## Private Codex Mode

Private Codex mode is a two-part integration:

1. The Render service receives the owner's Telegram prompts, persists jobs, and delivers final reports.
2. A local Windows worker uses the official `@openai/codex-sdk` package and the laptop's existing Codex authentication. Render never receives Codex credentials and never needs direct access to local project folders.

The mode is disabled unless all of these Render values are configured:

```text
CODEX_OWNER_TELEGRAM_ID=YOUR_TELEGRAM_USER_ID
CODEX_TELEGRAM_CHAT_ID=YOUR_TWO_MEMBER_GROUP_ID
CODEX_WORKER_TOKEN=A_LONG_RANDOM_SHARED_SECRET
CODEX_JOB_LEASE_SECONDS=3600
```

Private Codex mode does not require `BOT_ALLOWED_TELEGRAM_IDS`. Leave that global setting unchanged unless the entire Threadwise bot—not merely Codex mode—should be restricted. Codex has its own exact owner-and-chat gate.

The handler checks both the exact user id and exact chat id on every prompt and callback. Unauthorized `/codex` attempts are ignored without a response. The command is intentionally absent from the public command/help menus. Before showing any Codex UI or report, Threadwise verifies that the configured owner is still an active member and that the group contains only that owner and the bot. If either check fails, group delivery fails closed and a completed report is sent to the owner's private bot chat instead. Telegram may expose older group history to someone added later, depending on the group's history setting, so keep the group private and hide history from new members if the reports must remain owner-only.

After deploying the migration and Render configuration, create an ignored `.env.codex-worker` file on the Windows computer:

```text
THREADWISE_CODEX_URL=https://threadwise-90du.onrender.com
THREADWISE_CODEX_WORKER_TOKEN=THE_SAME_LONG_RANDOM_SHARED_SECRET
CODEX_WORKER_ID=my-laptop
CODEX_WORKER_POLL_MS=3000
CODEX_WORKER_SYNC_MS=300000
CODEX_WORKER_HEARTBEAT_MS=30000
CODEX_WORKER_NETWORK_ACCESS=false
CODEX_WORKER_MAX_ATTACHMENT_BYTES=26214400
THREADWISE_CODEX_ADDITIONAL_ROOTS=
CODEX_WORKER_CREDENTIAL_ENV_ALLOWLIST=
THREADWISE_DEPLOY_TARGETS=
GEMINI_WORKER_MODEL=auto
```

If the worker is not inheriting the same Codex home as the desktop app, also set:

```text
CODEX_HOME=D:\CodexData\home
```

Start the worker from this repository:

```powershell
npm install
npm run codex:worker
```

The same process handles Ideas Intelligence. On the laptop, install the official
Gemini CLI:

```powershell
npm install -g @google/gemini-cli@latest
```

For a personal account, create an API key in Google AI Studio and persist it only
on the laptop as `GEMINI_API_KEY`. Do not put the key in Render, Telegram, source
control, or this README. Consumer **Sign in with Google** access for Gemini CLI
ended on June 18, 2026; a Gemini Code Assist Standard or Enterprise account may
still use its supported organization authentication instead. The `auto` model
setting uses the best model available to the configured key or account; a concrete
preview model can be selected explicitly only when that credential has access.

Verify the local headless path before starting Threadwise:

```powershell
gemini --version
gemini --model auto --approval-mode plan -e none --output-format json -p "Reply with READY only."
```

Threadwise invokes the official CLI in read-only plan mode and does not copy or
upload Gemini credentials. After local authentication succeeds, the owner can
open any saved idea in Telegram and tap
**Develop**, **Challenge**, **Next steps**, or **Task plan** from the phone.
There is intentionally no general `/gemini` command, and `/codex` remains exclusively
for Codex projects, tasks, threads, prompts, and status. Sharing one local background
process is an implementation detail and does not combine their Telegram interfaces.

To keep the worker active whenever the laptop owner is signed in, persist
`THREADWISE_CODEX_URL`, `THREADWISE_CODEX_WORKER_TOKEN`, and (when used)
`CODEX_HOME` as Windows user environment variables, then run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-codex-worker-startup.ps1 -StartNow
```

The installer prefers a Scheduled Task that restarts the worker after failures
and runs on battery power. If Windows does not permit Scheduled Task
registration, it falls back to the current user's `Run` registry key. Both
methods write the local worker log to `.local/logs/codex-worker.log` in the
project folder and start at user sign-in rather than before sign-in, so the
worker can access the owner's Codex and Gemini session stores. The runner also
restarts a failed worker after 15 seconds, including when the Run-key fallback is used.

After a worker release is merged, update the dedicated laptop checkout without
resetting or discarding local files:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\update-codex-worker.ps1
```

The updater requires a clean dedicated checkout on `main`, fetches and
fast-forwards only, runs `npm ci`, and restarts the startup task. The runner
publishes a local PID file so updates stop its complete PowerShell/Node process
tree before replacing dependencies; this prevents orphaned `tsx` or esbuild
processes from locking `node_modules`. It stops on a dirty checkout, non-GitHub
origin, divergent branch, dependency failure, or non-fast-forward update.

For installations where the running worker token is intentionally unavailable to
the startup environment, `npm run codex:task-sync` starts a separate,
least-privilege catalog sidecar. Set `THREADWISE_CODEX_URL`,
`CODEX_TASK_SYNC_PRIVATE_KEY_PATH`, `CODEX_WORKER_ID`, and optionally
`CODEX_WORKER_SYNC_MS`. Its pinned Ed25519 key is accepted only by
`POST /codex/worker/sync`; it cannot claim or complete jobs, download Telegram
attachments, or access any other worker endpoint. Requests bind the method,
path, worker id, and canonical body and expire after two minutes.

On startup and every five minutes, the worker discovers project folders from Codex `session_meta` records and asks the local Codex app-server for the task names, ids, sources, and timestamps shown by Codex clients. It registers unique, existing Git repositories; excludes Codex-managed worktrees, missing folders, and non-Git directories; and syncs only the task metadata needed for Telegram selection. Codex credentials and session contents are never uploaded.

Inside the configured Telegram group:

```text
/codex projects
/codex tasks threadwise
/codex use threadwise
/codex use task "Add Telegram Codex mode"
Fix the reminder bug
in subscription-radar Review the renewal calculation
in threadwise task "Add Telegram Codex mode": Continue the implementation
new Start a separate Codex task
continue a1b2c3d4 Add regression tests
in threadwise --model gpt-5.6-sol --reasoning high -- Fix CI
/codex status
/codex doctor
in threadwise --access internet -- verify the current API documentation
in threadwise --access browser -- check the deployed UI
in threadwise --access deploy -- implement, publish, merge, and verify the deployment
```

`/codex projects` shows the current laptop project aliases and paths in paginated cards. Tapping a project opens `/codex tasks <alias>`, which lists the same named Codex tasks stored for that folder. Tap a task to make that exact thread active; plain messages resume it. Tap **New task** to clear the selection and make the next prompt start separately. You can also target a task directly with `in <alias> task "<title>": <prompt>` or `/codex use task "<title>"`. Every queue acknowledgement and report identifies the project, Codex task title/id, and separate Threadwise request id. Replying to a report resumes that exact task even after changing report pages; `continue <request-id> <prompt>` resumes it without locating the report.

Use `--model <model-id>` and `--reasoning minimal|low|medium|high|xhigh` anywhere before the prompt to override one task. Omitted controls inherit the resumed thread or local Codex defaults.

Use `--access code|internet|publish|deploy|browser|files|full` for a single
request. Code-only remains the default. Internet, browser, deploy, and extra-file
access create a durable approval card in the exact owner-only Telegram group;
the worker cannot claim the job until **Approve once** is tapped. If a code-only
turn encounters a capability boundary, the job is paused with the same approval
card and resumes from its saved Codex task after approval. `/codex doctor`
reports the persistent Codex home, GitHub authentication, capability switches,
credential broker names, deployment targets, and Git readiness for the selected
project without printing secret values.

On Windows, configured full-drive Codex roots authorize exact paths but are not
passed directly as sandbox directories. Quote the absolute file or folder path in
the approved prompt; Threadwise grants that path for the turn. Rapid prompts use a
durable per-task dependency chain, so prompts sent before a new task has a thread
ID stay queued in order and show their queue position.

Long final responses are stored intact and shown as one Telegram report card with project, folder, Codex task title/id, request id, model, reasoning, and page indicators. Previous/Next buttons edit the same message, so replying from any displayed page still maps to the same Codex thread.

Owner-only trusted publishing is requested naturally from the private Codex group:

```text
Implement this, verify it, publish it, and auto-merge when CI passes.
```

The sandboxed Codex turn edits a disposable Git worktree created from current
`origin/main`; it never works in the owner's possibly dirty desktop checkout.
The trusted laptop worker prepares locked dependencies, snapshots and reviews
the task's new diff, runs the
repository's detected npm/Prisma checks, rejects sensitive files or overlap with
pre-existing changes, creates a new `agent/*` branch, commits only the task
files, pushes without force, and opens a PR against `main`. Auto-merge is
requested only after the local gate and GitHub PR checks pass. A changed
`main`, failed check, conflict, unauthenticated `gh`, unsupported remote,
sensitive diff, or mixed pre-existing file stops publishing and is reported in
Telegram. The worker never pushes directly to `main`.

Commit, push, PR, check, auto-merge, merge, and blocker events are written to
the owner/chat-scoped `CodexPublishAudit` table as they occur. Completion
reports include the branch, commit, PR URL, check outcome, merge commit, or
exact blocker. GitHub CLI must be authenticated for the Windows user running
the worker (`gh auth login`), and the repository must have a PR check; this
repository supplies `.github/workflows/ci.yml`.

Local validation and failing GitHub checks can be returned to the same Codex
task for up to two bounded repair attempts. Each retry is revalidated, committed
to the same `agent/*` PR branch without force-push, and separately audited. A
sensitive repair diff, changed PR head, conflict, exhausted repair limit, or
failing check remains blocked for manual review.

Git-connected deployments use `THREADWISE_DEPLOY_TARGETS`. After an auto-merged
PR, the trusted worker polls the configured HTTPS health endpoint until it
reports the merged commit. Provider credentials are not given to the Codex
subprocess. Commit, push, PR, checks, merge, deployment, and blocker events all
use the host-side audit path.

Photos and image documents are downloaded by the authenticated worker and passed to the SDK as native `local_image` inputs. Other Telegram documents are downloaded to a unique temporary directory, exposed to that Codex turn as an additional readable directory, and named explicitly in the prompt. Telegram media albums are collected into one Codex job in message order: the album caption becomes the prompt and all items are sent to the same turn. Albums support up to 10 items, with the existing 25 MB per-file limit and a 100 MB combined limit. The temporary files are deleted when the turn finishes. The laptop never receives the Telegram bot token; it downloads each attachment through a worker-authenticated Threadwise endpoint that only serves files belonging to its currently claimed job.

The worker runs Codex with a workspace-write sandbox and no interactive desktop
approval UI. `CODEX_WORKER_NETWORK_ACCESS=true` makes network access available,
but a task still receives it only after its one-task Telegram approval. The SDK
subprocess receives a sanitized environment: worker/database/Telegram/provider
secrets are removed, Git credential helpers are disabled, and GitHub publishing
remains in the host broker. Optional MCP/plugin credential variable names may be
listed in `CODEX_WORKER_CREDENTIAL_ENV_ALLOWLIST`; Codex receives only those
selected values and its shell environment policy excludes their names from
model-run commands. Prompts and final reports are stored in PostgreSQL as part
of the durable job queue. While Codex is running, lease heartbeats prevent a
long task from being claimed twice. Terminal results retry with bounded
exponential backoff until the server accepts them, and the server independently
retries completed-but-undelivered Telegram reports. A completely empty
project-discovery pass preserves the previous registry instead of erasing it.

## Owner-only laptop file courier

The private `/files` capability is a separate Telegram surface from `/codex` and Ideas Intelligence. It is enabled only for the exact `CODEX_OWNER_TELEGRAM_ID` inside the exact `CODEX_TELEGRAM_CHAT_ID`, and the same two-member Telegram check fails closed if anyone else joins that group. It never appears in public help or command menus.

Configure explicit laptop roots in `.env.codex-worker`; no folder or drive is inferred:

```text
THREADWISE_FILE_ROOTS=C:\Users\Henry\Documents;C:\Users\Henry\OneDrive\Desktop
THREADWISE_FILE_MAX_BYTES=50000000
THREADWISE_FILE_SCAN_LIMIT=50000
```

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

Immediately before sending, the laptop resolves the path beneath an explicit root, rejects directories, Windows device paths, symlinks and junction/reparse escapes, compares file identity/size/time with the selected result, and creates a private local transfer snapshot. The worker streams that snapshot through the web process directly into Telegram; PostgreSQL stores only job, file metadata, state, and audits, and Render never writes a temporary file. The laptop snapshot is deleted after success or failure.

`FILE_COURIER_MAX_BYTES` is the cloud-side cap and `THREADWISE_FILE_MAX_BYTES` is the laptop-side cap; the lower effective limit wins. The standard hosted Telegram Bot API currently accepts documents up to 50 MB (50,000,000 bytes), while a self-hosted Local Bot API server supports larger uploads. Threadwise uses the standard hosted API and therefore caps configuration at 50,000,000 bytes. See the official [Telegram Bot API `sendDocument` documentation](https://core.telegram.org/bots/api#senddocument).

File jobs use renewable leases, recover after worker restarts or expired claims, and write audit events for queueing, claiming, completion, cancellation, upload start, delivery, and failure. A Telegram delivery error becomes a failed job and owner-visible report instead of retaining a server copy.

## Authenticated Dashboard API

`GET /api/v1/dashboard` remains the fast server-to-server snapshot for the separate Threadwise dashboard. `GET /api/v1/dashboard/workspaces` lists the signed-in person's available personal and recorded group workspaces. Other authenticated routes beneath `/api/v1/dashboard/*` add paginated collections, CRUD actions, search, settings, image delivery, integration disconnects, privacy export, and confirmed account deletion. They do not enable browser database access and never return OAuth tokens, embeddings, Telegram file identifiers, or provider credentials.

The first-party dashboard verification key is bundled as public-only trust material. Rotate that reviewed source value and the matching Vercel private secret together. Render does not accept an environment override, so a stale multiline variable cannot silently shadow the deployed key. Keep the private key only in the dashboard service; do not add it to this repository or Render.

The dashboard sends `Authorization: Bearer <token>`. Tokens must use `alg=EdDSA` and `typ=JWT`, and contain all of these claims:

```text
iss=threadwise-dashboard
aud=threadwise-api
sub=<positive personal Telegram user id>
iat=<issued-at Unix timestamp>
exp=<expiry Unix timestamp, no more than 120 seconds after iat>
jti=<unique non-empty request id>
```

The API always derives the human principal from the verified positive `sub` claim. Personal requests resolve directly to that person's internal owner. A group request may additionally send `X-Threadwise-Workspace: <opaque UUID>`; the server resolves that UUID, verifies the human's live Telegram membership through the bot, records that verified access, and only then scopes the request to the group's synthetic `chat:-100123...` owner. This lets any current member use a dashboard link posted in the group without first running a separate bot command. Request bodies never accept `userId` or raw chat ids. Personalized responses send private/no-store caching headers and the API intentionally has no browser CORS policy. Saved-image bytes are fetched server-side from Telegram only after an authenticated, owner-scoped lookup; bot tokens and reusable Telegram file IDs never reach the browser.

One way to create the key pair locally is:

```bash
openssl genpkey -algorithm Ed25519 -out dashboard-private.pem
openssl pkey -in dashboard-private.pem -pubout -out dashboard-public.pem
```

Store `dashboard-private.pem` as the dashboard's private environment secret and update the bundled public-only verification key in `src/dashboard/publicKey.ts` in the same release. Delete the local key files after the deployment secret is configured.

## Private Admin Endpoints

Set `ADMIN_STATUS_TOKEN` to enable:

```text
GET /admin/ai/status
GET /admin/ai/status?check=1
GET /admin/reminders/status
GET /admin/reminders/run
POST /admin/reminders/run
```

Send the token as:

```text
Authorization: Bearer <ADMIN_STATUS_TOKEN>
```

Without the token configured, or with the wrong token, the endpoint returns `404`.

`ADMIN_STATUS_TOKEN` should be a long random secret that you create yourself, not your OpenAI API key or Telegram bot token. For example:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set that generated value in Render, then pass the same value when calling the endpoint.

`/admin/ai/status` reports whether Threadwise is using the OpenAI provider or heuristic fallback, the configured chat model chain, the active chat model, embedding model, last successful chat call, and the last recorded rate-limit event. `?check=1` performs a tiny live OpenAI chat check, so use it intentionally.

`/admin/reminders/status` returns the latest in-memory reminder diagnostics. `/admin/reminders/run` performs one immediate due-reminder pass and returns due tasks found, reminders sent, quiet-hour deferrals, daily-cap skips, and delivery failures.

`OPENAI_MODEL_FALLBACKS` is a comma-separated list tried after the current chat model hits a rate limit or is unavailable. Example:

```text
OPENAI_MODEL=gpt-5.4-mini
OPENAI_MODEL_FALLBACKS=gpt-5.5,gpt-5.4,gpt-5.4-nano
```

The order is yours: put a stronger preferred fallback first, then cheaper/lower models after it.

## Validation

Run:

```bash
npm run typecheck
npm test
npm run build
npm audit
git diff --check
```

Latest complete backend gate, verified on 2026-08-10:

- 99 test files passed
- 803 tests passed; 6 intentional skips
- Prisma schema validation and client generation passed
- TypeScript typecheck passed
- Isolated production TypeScript emit passed

`npm audit` and live deployment health are environment/network checks; run them when preparing a release rather than assuming a historical result remains current.

## Future Improvements

- Quantified activation, retention, scheduling-response, and repeat-use analytics.
- Stronger search infrastructure when datasets exceed the current bounded app-side window.
- Threadwise Intelligence, introduced only where it strengthens Capture, Coordinate, or Recall.
- Monetization and entitlement controls based on validated usage rather than arbitrary feature locks.
- Optional privacy architecture for content that the service operator cannot read; the current product is not end-to-end encrypted.
- Additional local OCR languages beyond English and Burmese.
- Full Burmese UI localization: translated copy, deterministic commands, date phrasing, and native-speaker QA.
