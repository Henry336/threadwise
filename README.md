# Threadwise

Threadwise is a private Telegram life inbox for capturing ideas, notes, tasks, searchable personal knowledge, and product implementation briefs.

It is built as a portfolio-ready backend service: typed TypeScript, PostgreSQL persistence, Prisma schema management, Telegram webhooks for Render, and clear service boundaries for future contributors.

Current deployment: https://threadwise-90du.onrender.com

Portfolio case study: [CASE_STUDY.md](CASE_STUDY.md)

## What It Does

- Captures ideas with `/idea <text>`.
- Captures notes with `/note <text>` and structures simple notes locally; longer or explicitly synthetic cleanup can still use AI.
- Retrieves saved notes with `/note 1`, `/note NOTE-1`, or natural text like `show note 1`; searches notes with `/notes <query>`.
- Lists and opens saved ideas with `/ideas` and `/ideas <1 or IDEA-1>`.
- Merges related notes with `/merge notes 1 2 3`, showing a preview first and allowing retries before confirmation.
- Reviews the current inbox with `/review`, including task pressure, recent notes, and ideas.
- Captures tasks with `/add <task>`.
- Reads clear English, Burmese, or mixed English/Burmese images and receipts locally with Tesseract OCR, then offers buttons to save the result as a note, task, reminder, or expense. No OCR or OpenAI API key is required.
- Stores confirmed expenses in Threadwise, supports manual text and receipt photos, and lists 10 newest-first rows per page with day, month, and year filters.
- Gives each user a regional expense-currency default, accepts an explicit currency per expense, detects common currency codes/symbols/words on receipts, and lets saved expenses be corrected later.
- Exports expenses as a standalone `.xlsx` file, or optionally creates and synchronizes a private workbook in the user's OneDrive through Microsoft OAuth.
- Schedules reminders for specific times with `/remind <when> | <task>`.
- Schedules calendar-aware daily, weekly-on-a-weekday, and yearly reminders with natural phrases such as "remind me to sleep at 12am daily", "remind me to take out the trash every Friday at 7pm", and "remind me of Mum's birthday on 26 July every year".
- Sends the first due reminder at the scheduled time, even during quiet hours; later repeat nudges use the current repeat setting and respect quiet hours and the daily safety limit.
- Detects broad natural reminder language such as "could you remind me to call Mum day after tomorrow at noon?", "remind me to finish all tasks by 9 pm", "don't let me forget to submit the form at 5pm", and "nudge me to check the oven in half an hour" without requiring OpenAI.
- Sends recurring Telegram reminders every 3 hours by default until a task is completed.
- Sends early warnings before dated tasks are due, then repeats them until completion.
- Lists open tasks with active list numbers, while keeping stable task IDs for durable references.
- Lets users view, complete, snooze, pin, rename, or cancel tasks with active list numbers, stable IDs, or inline buttons on `/tasks`. Pressing Complete again reports that the task is already completed and offers a safe Restore button.
- Labels completion buttons as `Complete task` or `Complete 1` so they are not confused with finishing the save flow.
- Shows inline star/edit buttons for tasks, notes, and ideas in list and detail views.
- Archives notes from note list/detail buttons, `/archive note 1`, or natural text such as `delete note 1`.
- Shows inline undo and cancel buttons for save, completion, cancellation, snooze, pin, and edit flows where supported.
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
- Handles normal messages with deterministic command routing and first-pass classification for tasks, reminders, notes, ideas, lists, edits, search, cleanup, Gmail, calendar, settings, and status. Clear requests work without an OpenAI token; ambiguous captures can still use AI or ask before saving.
- Searches ideas, notes, and tasks with local lexical and deterministic semantic scoring via `/search`.
- Filters semantic search with `/search tasks <query>`, `/search notes <query>`, and `/search ideas <query>`.
- Searches completed tasks explicitly with `/search done <query>`; normal search only includes open tasks.
- Analyzes notekeeping style with `/note-analysis`, including what works, what does not, and suggested experiments.
- Scores ideas with `/score`, including buildability, usefulness, novelty, portfolio value, monetization, difficulty, risk, competition notes, and dos/donts.
- Generates copy-paste implementation prompts for Codex or Claude Code with `/brief`.
- Connects Google Calendar with OAuth and uses `/calendar <task>` to create or update one durable event in the primary calendar. Without a connection, the same command falls back to a template link and `.ics` export; `/googlecal` always provides the no-login template link.
- Connects Gmail with read-only OAuth, scans unread mail, triages ordinary messages deterministically, sends summaries, and creates follow-up tasks for important messages.
- Shows release, AI, Gmail, and reminder delivery status with `/version`.
- Exposes protected admin reminder endpoints for cron or uptime fallback runs.
- Supports configurable reminder repeat timing, early warnings, quiet hours, timezone, and a high daily safety limit through slash commands or natural language.
- Makes a best-effort timezone guess for new users from Telegram language code when available, then accepts plain-language corrections such as `change timezone to Myanmar`.
- Supports group chats with shared chat-scoped tasks, notes, ideas, settings, expenses, and reminders. In groups, slash commands work directly, while addressed natural-language messages use the same full deterministic router as private chats. Mention-only greetings receive an acknowledgement, and unclear addressed requests receive a helpful response instead of silence.
- Supports first-class group task assignees from `@username` mentions, plus `assign task 2 to @username` and `unassign task 2`.

## Commands

```text
/start
/help
/commands
/idea build a Telegram bot that...
/note Remember that deployment reliability depends on avoiding sleeping workers
/note 1
/note NOTE-1
/notes
/notes deployment reliability
/note-analysis
/ideas
/ideas 1
/merge notes 1 2 3
/archive note 1
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
/snooze TASK-1 1h
/snooze 1 1h
/reschedule 1 tomorrow at 10am
/assign 1 @henry_derek
/unassign 1
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
/delete TASK-1
/search reminder bot ideas
/search done curriculum paper
/search tasks invoice
/search notes deployment reliability
/score IDEA-1
/brief IDEA-1
/calendar TASK-1
/calendar 1
/calendar connect
/calendar status
/calendar disconnect
/googlecal TASK-1
/googlecal 1
/gmail
/gmail connect
/gmail scan
/gmail disconnect
/expense spent $18.40 on lunch at Toast Box today using Visa
/expense edit EXP-2 currency MMK
/expenses
/expenses today
/expenses this month
/expenses 2026
/excel
/excel export
/excel connect
/excel create
/excel sync
/excel use https://onedrive.live.com/...
/excel disconnect
/version
/groupcheck
/settings
/settings interval 180
/settings timezone Asia/Singapore
/settings timezone Asia/Yangon
/settings timezone Myanmar
/settings timezone Malaysia
/settings timezone America/New_York
/settings currency MMK
/settings ocr English and Burmese
/settings mode compact
/settings quiet 22:00 08:00
/settings quiet off
/settings max 200
/settings due-nudge 3
```

`/start` introduces Threadwise as a natural-language bot first. `/help` shows a full capability guide with natural examples and slash equivalents. Focused questions such as `how do I set reminders?`, `help me with notes`, and `how do I change my settings?` return the relevant help section. `/commands` shows the compact slash-command reference for users who prefer exact commands.

Normal Telegram messages are also supported. Threadwise checks deterministic command-like intent before any AI classification. It understands broad variations including "what notes do I have?", "write this down: ...", "remember that ...", "I need to submit the report by Friday", "could you remind me ...?", "don't let me forget ...", "mark task 1 as done", "remove important from task 2", "bring back NOTE-2", "check my unread email", "add task 1 to my calendar", "what version are you running?", and the existing concise forms. Reminder dates also support numeric and word-based relative durations, day-after-tomorrow, noon/midnight, weekday dates, month-first dates, and ordinals. If a message is not a recognized command-like request, Threadwise classifies it as a possible task, scheduled reminder, idea, note, or noise, then either saves a clear capture with an undo hint or asks for confirmation.

In group chats, natural-language requests should mention the bot or reply to it, for example `@ThreadwiseBot remind @henry_derek to bring snacks at 5pm`. The saved task belongs to the group chat, stores `@henry_derek` as the assignee, and sends reminders back to that group. If Telegram provides a numeric user id through a text mention, Threadwise stores that too; otherwise it stores the public username. Run `/groupcheck` inside the group to see the deployed version, exact bot username, group ID, sender ID, and allowlist state.

The same natural-language coverage applies after the bot mention is removed, including notes, tasks, settings, search, expenses, and recurring reminders. For example: `@ThreadwiseBot remind us to take out the trash every Friday at 7pm`. Threadwise uses Telegram's mention entities as well as the bot username, so punctuation such as `(@ThreadwiseBot)` or `Hi,@ThreadwiseBot:` is handled correctly. Unaddressed ordinary group conversation remains ignored.

For tasks, `/pin`, `/star`, and `/important` mark the task as important. Important task reminders use a clear "Important task" heading so they stand out from normal task reminders.

For high-confidence tasks, notes, and ideas, Threadwise may save immediately and include `/undo` in the reply.

`TASK-1`, `TASK-2`, and similar public IDs are stable database references and are not reused. `/tasks` also shows active list numbers, so a single open task can be handled as `/done 1` even if its stable ID is `TASK-999`.

Undoing a newly saved capture archives it out of active lists and search instead of hard-deleting the row. That keeps public IDs durable and avoids future items silently reusing an old ID. Archived items keep an archive reason where available; notes merged into another note also keep the merged-into note reference.

## Reminder Behavior

Reminders are database-driven. Each open task has a `nextReminderAt`, and the reminder loop polls due tasks instead of relying on in-memory timers.

- The first reminder for a scheduled task fires at its explicit due time, even during quiet hours.
- Daily, weekday-weekly, and yearly recurring reminders keep nudging the current occurrence until it is completed. Completion advances the same task row to the next calendar occurrence, preserving local wall-clock time across timezone and daylight-saving changes.
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

Calendar links and synced Google event IDs are stored on each dated task row. That means `TASK-1` maps to one durable Google Calendar event across restarts and deployments; asking for `/calendar TASK-1` again updates that event instead of creating a duplicate.

Connect with `/calendar connect`, then use `/calendar 1` or natural text such as `add task 1 to my calendar`. `/calendar status` shows the connected account and `/calendar disconnect` removes Threadwise's stored Calendar tokens while leaving existing events alone. Enable the Google Calendar API in the same Google Cloud project and add `https://threadwise-90du.onrender.com/calendar/oauth/callback` as an authorized redirect URI. `GOOGLE_CALENDAR_REDIRECT_URI` can override that URL; otherwise Threadwise derives it from `WEBHOOK_URL`.

`/brief IDEA-1` does not run a coding agent by itself. It creates a structured implementation prompt that can be copied into Codex, Claude Code, or another coding agent after you choose the target repository.

## Gmail Integration

Gmail is optional and disabled until Google OAuth environment variables are configured.

```text
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://your-render-app.onrender.com/gmail/oauth/callback
GMAIL_TOKEN_ENCRYPTION_KEY=use-a-long-random-secret
```

- `/gmail connect` creates a Google OAuth link with read-only Gmail access.
- `/gmail scan` scans unread mail immediately.
- Connected users are scanned once per local day after `GMAIL_DAILY_SCAN_HOUR`.
- Threadwise sends a Telegram digest of unread messages and creates open follow-up tasks for messages classified as important.
- Gmail messages are not marked read. Threadwise stores encrypted OAuth tokens plus message IDs, sender, subject, snippet, summary, importance reason, and any created task link so the same email does not create duplicate reminders.
- The integration accepts only `https://www.googleapis.com/auth/gmail.readonly`; it cannot send, delete, archive, or mark emails read.

## Image Text Extraction

Send Threadwise a photo or an image document. It will extract printed English, Burmese, or mixed text locally and show a preview with buttons for `Save note`, `Create task`, `Set reminder`, `Save expense`, `Show full text`, and `Discard`. A caption can perform the action immediately:

```text
extract the text
save this as a note
turn this into a task
remind me about this tomorrow at 9
save this receipt as an expense
read this in Burmese and save as an expense
```

OCR uses bundled English and Burmese Tesseract language data and Sharp image cleanup on the Render server. It does not send the image to OpenAI or another OCR API and needs no API key. Choose a saved default with `read images in Burmese`, `read images in English and Burmese`, or `/settings ocr ...`; an individual image caption can override it. Images are rotated, resized, converted to grayscale, normalized, and sharpened before recognition. The safety limits are 10 MB and 20 megapixels, and recognition times out after 60 seconds. The first image after a deployment or language change may be slower while the OCR worker starts.

For the best result, use a bright, straight, tightly cropped photo with sharp printed text. Screenshots and clear receipts work best. Handwriting, curved or blurred receipts, unusual fonts, multiple languages, and complex tables may need manual correction. Threadwise always shows a confirmation preview before saving a parsed receipt.

## Expenses

Threadwise's database is the source of truth. Excel is an optional mirror, so a Microsoft outage or a spreadsheet edit cannot make a newly confirmed expense disappear.

Manual examples include:

```text
spent $18.40 on lunch at Toast Box today using Visa
record an expense of SGD 25 for groceries
paid 12.50 for parking yesterday
bought printer paper for $9.90
spent 12000 kyat on groceries
```

Threadwise extracts the transaction date, merchant, category, description, subtotal, tax, discount, total, currency, and payment method when they are present. New users get a best-effort regional currency based on their Threadwise timezone; set it explicitly with `set my expense currency to MMK` or `/settings currency MMK`. An explicit currency in a message or a recognizable receipt marker overrides that default. Burmese receipt amounts using Myanmar digits are normalized before parsing. It shows a draft first. Use the buttons to save it, save and sync it to Excel, edit fields, or discard it. Receipt images also retain the OCR confidence and original extracted text. Re-sending the same Telegram receipt is detected so it is not saved twice accidentally.

Correct a confirmed expense with natural language such as `change currency of EXP-2 to USD`, `update EXP-2 total 18.50`, or `/expense edit EXP-2 currency USD`. Threadwise and future `.xlsx` exports use the correction. If the old row was already synchronized into a linked OneDrive workbook, change or remove that existing workbook row manually; Threadwise deliberately does not append a duplicate correction row.

Browse expenses with `/expenses`, `/expenses today`, `/expenses 12 July 2026`, `/expenses this month`, `/expenses June 2026`, or `/expenses 2026`. Natural requests such as `what did I spend this month?` work too. Results are ordered from most recent to oldest, 10 per page, with Prev and Next buttons. Year filtering is already implemented.

Every expense uses these predefined Excel columns: Expense ID, Transaction Date, Merchant, Category, Description, Subtotal, Tax, Discount, Total, Currency, Payment Method, Source, OCR Confidence, Notes, and Added At.

## Microsoft Excel

Excel is optional. The simplest no-login option is `/excel export`, which sends the user a ready-to-open `.xlsx` file containing all saved expenses.

For ongoing synchronization:

1. Run `/excel connect` and approve Microsoft access.
2. Run `/excel create`. Threadwise creates a timestamped workbook in the user's own OneDrive, adds the predefined table and columns, and includes existing expenses.
3. Confirm new expenses with `Save + sync Excel`, or run `/excel sync` to send up to 200 waiting expenses.
4. Run `/excel` or say `show my Excel status` to see the connected account and workbook.

The user does not need to provide a link when using `/excel create`. Advanced users can select an existing OneDrive or SharePoint `.xlsx` file with `/excel use <sharing link>`, but it must contain an Excel table named `Expenses` with the exact Threadwise columns in the documented order. `/excel disconnect` removes stored Microsoft tokens but does not delete the workbook or any Threadwise expenses.

To enable Microsoft sign-in on Render, create a Microsoft Entra app registration, add a Web redirect URI of `https://threadwise-90du.onrender.com/excel/oauth/callback`, and grant delegated `User.Read` and `Files.ReadWrite` permissions. `offline_access` is requested during sign-in so synchronization can continue after the initial connection. Then set:

```text
MICROSOFT_CLIENT_ID=<Application client ID>
MICROSOFT_CLIENT_SECRET=<client secret value>
MICROSOFT_REDIRECT_URI=https://threadwise-90du.onrender.com/excel/oauth/callback
MICROSOFT_TOKEN_ENCRYPTION_KEY=<long random secret>
```

Generate the encryption key with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Keep it stable: changing it makes existing encrypted Microsoft tokens unreadable, and affected users will need to reconnect. The integration only accesses files the signed-in user can access; it does not require a separate Excel API key.

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

The important design choice is that commands and reminders are deterministic. Common command-like text, settings changes, list/detail requests, classification, task extraction, reminder parsing, simple note structuring, Gmail triage, and embeddings are local and quota-proof. AI is reserved for higher-value synthesis such as complex note/idea structuring, note merges, note analysis, idea scoring, and richer Gmail wording when a message already looks important. Repeated synthesis calls are cached in memory by content hash so accidental retries do not spend extra quota.

## Data Model

Threadwise stores:

- Users and per-user settings
- Ideas
- Notes
- Tasks
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

The normal command path does not need OpenAI. Command intent, reminder dates, tasks, short notes, settings, edits, lists, archives, calendar exports, embeddings, and search all run locally. If an OpenAI key is configured, chat calls are reserved for ambiguous message classification and synthesis-heavy features such as idea structuring, long or explicitly rewritten notes, note merging/analysis, idea scoring, and email summaries. Remove `OPENAI_API_KEY` to run the entire bot in local/heuristic mode; every command remains available.

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

This repo includes `render.yaml` for a Render web service plus PostgreSQL database.

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

`DATABASE_URL` is wired from the Render database in `render.yaml`.

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
