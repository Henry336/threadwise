# Threadwise

Threadwise turns Telegram messages into things people can find, remember, and finish.

Its product hierarchy is **Capture, Coordinate, Recall**: save useful messages, move individual or shared work forward, and retrieve context without digging through chat.

It is built as a portfolio-ready backend service: typed TypeScript, PostgreSQL persistence, Prisma schema management, Telegram webhooks for Render, and clear service boundaries for future contributors.

Current deployment: https://threadwise-90du.onrender.com

Portfolio case study: [CASE_STUDY.md](CASE_STUDY.md)

Product voice and copy conventions: [docs/VOICE_AND_TONE.md](docs/VOICE_AND_TONE.md)

Product decisions, observed friction, and implementation rationale: [docs/PRODUCT_JOURNAL.md](docs/PRODUCT_JOURNAL.md)

## What It Does

- Captures ideas with `/idea <text>`.
- Captures notes with `/note <text>` and structures simple notes locally; longer or explicitly synthetic cleanup can still use AI.
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
- Sends recurring Telegram reminders every 3 hours by default until a task is completed.
- Sends early warnings before dated tasks are due, then repeats them until completion.
- Lists open tasks three readable previews per mobile page with Prev/Next controls and global active list numbers, while keeping stable task IDs for durable references.
- Lets users view, complete, snooze, pin, rename, or cancel tasks with active list numbers, stable IDs, or inline buttons on `/tasks`. Inline actions update the current Telegram card in place when possible, and nested cards provide a Main menu or back route. Pressing Complete again reports that the task is already completed and offers a safe Restore button.
- Supports bulk task completion and bulk task/note/idea removal with an itemized preview, requester-only Confirm/Cancel buttons, a 25-item limit, and no changes before confirmation.
- Labels completion buttons as `Complete task` or `Complete 1` so they are not confused with finishing the save flow.
- Shows inline star/edit buttons for tasks, notes, and ideas in list and detail views.
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
- Shows one persistent `Menu` button and one direct `Dashboard` button beneath the Telegram reply box in private chats. Menu re-anchors a fresh compact control card at the bottom; groups keep message-attached inline navigation so the shared composer stays uncluttered.
- Opens the live personal or group web workspace with `/dashboard` or natural requests such as `open the dashboard`, and explains the exact privacy boundary with `/privacy`. A group dashboard is selected through an opaque workspace id, then authorized against the signed-in person's recorded and current Telegram membership.
- Supports several assignees on one group task, including `remind Dad and @alex to check the bot at 10pm`, `assign task 2 to @alex and @sam`, and `remove @alex from task 2`.
- Lets assignees accept, decline, block, unblock, or hand work to another group member through compact buttons, slash commands, or natural phrases such as `I'll take task 2`, `I'm blocked on task 2 because I need access`, and `hand off task 2 to @alex`.
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
/accept TASK-1
/decline TASK-1 already committed elsewhere
/block TASK-1 waiting for access
/unblock TASK-1
/handoff TASK-1 @alex
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

`/start` installs the two persistent private-chat shortcuts and opens the compact button menu without a separate onboarding wall of text. `/help` shows a full capability guide with topic buttons, natural examples, and slash equivalents. Focused questions such as `how do I set reminders?`, `help me with notes`, and `how do I change my settings?` return the relevant help section. `/commands` shows the compact slash-command reference for users who prefer exact commands.

Normal Telegram messages are also supported. Threadwise checks deterministic command-like intent before any AI work. It understands broad variations including "what's on my plate?", "open my reminders", "keep this in mind: ...", "brainwave: ...", "put this on my list", "give me a heads-up at 1.30pm", "I finished task 2", "put off task 2", "task 2 is due Friday", "I don't need task 2 anymore", "where is the note about passports?", and the existing concise forms. Reminder dates also support numeric and word-based relative durations, dotted and spoken clocks, parts of day, day-after-tomorrow, noon/midnight, weekday shorthand, numeric day-first and named-month dates, EOD, next week, next month, and ordinals. If a message is not recognized confidently, Threadwise responds immediately with Task, Note, Idea, and Ignore choices; the selected action is actor-scoped in groups.

In group chats, `/start`, `/menu`, `/help`, `/commands`, `/privacy`, and `/settings` now use short group-specific panels instead of the private-chat onboarding wall. Natural-language requests should mention the bot or reply to it, for example `@ThreadwiseBot remind @alex and @sam to bring snacks at 5pm`. The saved task belongs to the group chat, stores every assignee, and sends reminders back to that group with clickable Telegram mentions. Plain names such as `Dad` are retained for display, but only a Telegram `@username` or Telegram text mention can be matched to a private account. Run `/groupcheck` inside the group to see the deployed version, exact bot username, group ID, allowlist state, and Telegram privacy mode.

`/dashboard` inside a group opens that group's separate shared web workspace. The bot should be a group administrator before members use this link: Telegram only guarantees live `getChatMember` checks for other users when the bot is an administrator. If that verification is unavailable, Threadwise fails closed rather than exposing shared content. Group settings, assigning work to other members, and availability-poll management require a currently verified owner or administrator. Each active member can still respond to their own assignments and availability. Expenses, the frozen Excel surface, personal export, and account deletion remain personal-only. A finalized group meeting may be copied to each member's own connected Google Calendar without exposing that connection to the group.

The shared dashboard is deliberately practical rather than managerial theatre: **Overview** surfaces overdue, unassigned, awaiting-reply, blocked work, and active availability polls; **Work** includes confirmed meetings; **People** shows assignment load without ranking people; **Progress** derives done, next, and blocked items; **Activity** records meaningful movement; **Resources** collects shared notes, ideas, and visual references; and **Find a time** provides the full availability grid. Web changes use the same database rows queried by the bot and update the compact Telegram card without adding chat clutter.

Private assignee nudges are deliberately opt-in. Each person opens the bot privately once and sends `/settings dm on` (or starts the bot through its `start=dm` link). When a shared assigned task becomes due, Threadwise still posts the normal group reminder and separately DMs every opted-in assignee it can match. Someone who has not started the bot, has disabled DMs, or was entered only as a plain name is skipped without blocking anyone else's reminder. Send `/settings dm off` privately to stop the extra nudges.

Telegram's privacy-enabled bots do not receive ordinary messages merely because the text contains their `@username`; they receive bot commands and replies instead. To enable Threadwise's natural addressed messages, open BotFather, run `/setprivacy`, select the Threadwise bot, and choose `Disable`. Threadwise has its own centralized address gate: unaddressed group text, photos, image documents, and captions are discarded before capture, OCR, editing, or natural-language handling. Slash commands, replies to Threadwise, and messages that mention Threadwise are allowed. If an existing group does not reflect the BotFather change immediately, remove and re-add the bot once.

The same natural-language coverage applies after the bot mention is removed, including notes, tasks, settings, search, expenses, and recurring reminders. For example: `@ThreadwiseBot remind us to take out the trash every Friday at 7pm`. Threadwise uses Telegram's mention entities as well as the bot username, so punctuation such as `(@ThreadwiseBot)` or `Hi,@ThreadwiseBot:` is handled correctly. Unaddressed ordinary group conversation remains ignored.

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
- grammY for Telegram bot handling
- Fastify for webhook and health endpoints
- PostgreSQL for durable storage
- Prisma for schema and migrations
- Zod for environment validation
- OpenAI-compatible adapter for synthesis tasks, plus local deterministic classification and embeddings
- Private admin endpoints for checking AI status and triggering reminder fallback runs
- Vitest for unit tests
- Render for deployment

## Architecture

```text
src/
  ai/                 AI provider interface, OpenAI implementation, local heuristic fallback
  bot/                Telegram commands, callbacks, natural command parsing, keyboards, formatting
  config/             Environment parsing
  db/                 Prisma client
  services/           Domain logic for users, tasks, ideas, reminders, search, settings
  utils/              Date parsing, text utilities, vector helpers
  main.ts             Application entrypoint
  server.ts           Fastify health endpoint and webhook route
prisma/
  schema.prisma       PostgreSQL data model
```

The important design choice is that commands and reminders are deterministic. Common command-like text, settings changes, list/detail requests, classification, task extraction, reminder parsing, simple note structuring, and embeddings are local and quota-proof. AI is reserved for higher-value synthesis such as complex note/idea structuring, note merges, note analysis, and idea scoring. Repeated synthesis calls are cached in memory by content hash so accidental retries do not spend extra quota.

## Data Model

Threadwise stores:

- Users and per-user settings
- Ideas
- Notes
- Tasks
- Saved image references and pending image choices
- Pending natural-language captures
- Pending note merge previews
- Processed Telegram update IDs for webhook de-duplication
- Reminder delivery history
- Audit logs
- Pin and archive timestamps, archive reasons, and note merge links for durable undo and priority/archive views
- Embeddings/search vectors as JSON for personal-scale semantic search

The schema is designed so future work can add external search-backed market research, a dashboard, and richer semantic search without replacing the core tables.

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Copy environment variables:

```bash
cp .env.example .env
```

3. Fill in:

```text
TELEGRAM_BOT_TOKEN=
DATABASE_URL=
OPENAI_API_KEY=
```

`OPENAI_API_KEY` is optional for local smoke testing. Without it, Threadwise uses deterministic local behavior plus heuristic fallbacks for synthesis features such as scoring and note analysis.

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
OPENAI_API_KEY
OPENAI_MODEL
OPENAI_MODEL_FALLBACKS
ADMIN_STATUS_TOKEN
WEBHOOK_URL
BOT_ALLOWED_TELEGRAM_IDS
MICROSOFT_CLIENT_ID
MICROSOFT_CLIENT_SECRET
MICROSOFT_REDIRECT_URI
MICROSOFT_TOKEN_ENCRYPTION_KEY
```

`DATABASE_URL` is a secret configured in the Render dashboard. Threadwise only requires a PostgreSQL-compatible database, so the database does not need to be hosted by Render. For Supabase on an IPv4 Render service, use the Supavisor session-pooler connection string on port `5432`.

For the prepared Seoul-to-Singapore Supabase cutover, see [docs/SUPABASE_REGION_MIGRATION.md](docs/SUPABASE_REGION_MIGRATION.md). The guarded workflow copies only Threadwise's application database, verifies every table exactly, and keeps the old project as the rollback source.

`WEBHOOK_URL` should be the public Render service URL, for example:

```text
https://threadwise-90du.onrender.com
```

Render should run:

```bash
npm run db:migrate && npm start
```

Use an always-on Render plan if you want reminders to be reliable. If the service sleeps, the database keeps tasks safe, but reminders will only be sent after the process wakes back up.

## Privacy And Access

Threadwise stores private-chat data per Telegram user. A different Telegram user who messages the same bot gets their own ideas, notes, tasks, and settings. They do not see another user's saved data through normal bot commands.

In group chats, Threadwise stores data by chat id instead. Everyone who can use the bot in that group sees the same group tasks, notes, ideas, settings, and reminders. The database represents that shared owner as a synthetic user id such as `chat:-1001234567890`, so the existing service layer can keep enforcing scoped lookups without duplicating every table.

If the deployment should be private to only one person or a small team, set:

```text
BOT_ALLOWED_TELEGRAM_IDS=123456789,987654321
```

You can also allow a whole group by adding its chat id, either as `-1001234567890` or `chat:-1001234567890`. If a group is allowlisted, any member of that group can use the shared group scope. If only individual Telegram ids are allowlisted, group messages from non-allowlisted people are ignored silently so the bot does not clutter the chat.

Leave `BOT_ALLOWED_TELEGRAM_IDS` blank to allow any Telegram user who can find the bot to use their own isolated private scope and any group that adds the bot to use a shared group scope.

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
```

Current validation status at initial implementation:

- Typecheck: passing
- Unit tests: passing
- Production build: passing
- npm audit: 0 vulnerabilities

## Future Improvements

- External search provider for live market/competition research.
- Web dashboard for reviewing ideas and tasks.
- Weekly digest.
- Richer idea selection-to-implementation workflow.
- Per-user privacy controls and export/delete flows.
- Receipt review learning: remember a user's merchant/category corrections locally.
- Additional local OCR languages beyond English and Burmese, plus multi-receipt batch import.
- Full Burmese UI localization: translated message catalog, Burmese deterministic commands, Burmese date phrasing, and native-speaker QA.
