# Threadwise

Threadwise is a private Telegram life inbox for capturing ideas, notes, tasks, relationship reflections, searchable personal knowledge, and product implementation briefs.

It is built as a portfolio-ready backend service: typed TypeScript, PostgreSQL persistence, Prisma schema management, Telegram webhooks for Render, and clear service boundaries for future contributors.

Current deployment: https://threadwise-90du.onrender.com

## What It Does

- Captures ideas with `/idea <text>`.
- Captures notes with `/note <text>` and rewrites them into a clearer, more recallable format.
- Retrieves saved notes with `/note NOTE-1` or searches notes with `/notes <query>`.
- Reviews the current inbox with `/review`, including task pressure, recent notes, ideas, and reflections.
- Captures tasks with `/add <task>`.
- Schedules reminders for specific times with `/remind <when> | <task>`.
- Sends the first due reminder at the scheduled time, even during quiet hours; later repeat nudges use the current interval setting and respect quiet hours and reminder caps.
- Detects natural reminder messages like "remind me to check the logs tomorrow at 9am" and asks before saving.
- Sends recurring Telegram reminders every 3 hours by default until a task is completed.
- Lists open tasks with active list numbers, while keeping stable task IDs for durable references.
- Lets users view, complete, snooze, or cancel tasks with active list numbers, stable IDs, or inline buttons on `/tasks`.
- Uses clean Telegram HTML formatting for headings, IDs, due dates, summaries, and command examples.
- Ignores duplicate Telegram webhook updates so retries do not send the same response twice.
- Handles normal messages with natural-language classification and asks before saving them.
- Stores relationship reflections with balanced, non-clinical guidance through `/relationship` or `/reflect`.
- Searches ideas, notes, tasks, and reflections semantically with `/search`.
- Analyzes notekeeping style with `/note-analysis`, including what works, what does not, and suggested experiments.
- Scores ideas with `/score`, including buildability, usefulness, novelty, portfolio value, monetization, difficulty, risk, competition notes, and dos/donts.
- Generates copy-paste implementation prompts for Codex or Claude Code with `/brief`.
- Creates calendar-ready tasks with Google Calendar links and `.ics` exports.
- Supports configurable reminder interval, quiet hours, timezone, reminder cap, and digest mode.

## Commands

```text
/help
/idea build a Telegram bot that...
/note Remember that deployment reliability depends on avoiding sleeping workers
/note NOTE-1
/notes
/notes deployment reliability
/note-analysis
/review
/add pay invoice tomorrow at 9am
/remind tomorrow at 9am | submit the form
/tasks
/task 1
/done TASK-1
/done 1
/snooze TASK-1 1h
/snooze 1 1h
/cancel 1
/delete TASK-1
/relationship here is what happened...
/reflect here is what happened...
/search reminder bot ideas
/score IDEA-1
/brief IDEA-1
/calendar TASK-1
/calendar 1
/settings
/settings interval 180
/settings timezone Asia/Singapore
/settings quiet 22:00 08:00
/settings quiet off
/settings max 5
/settings digest on
```

Normal Telegram messages are also supported. Threadwise classifies them as a possible task, scheduled reminder, idea, note, reflection, or noise, then asks for confirmation before saving.

`TASK-1`, `TASK-2`, and similar public IDs are stable database references and are not reused. `/tasks` also shows active list numbers, so a single open task can be handled as `/done 1` even if its stable ID is `TASK-999`.

## Reminder Behavior

Reminders are database-driven. Each open task has a `nextReminderAt`, and the reminder loop polls due tasks instead of relying on in-memory timers.

- The first reminder for a scheduled task fires at its explicit due time, even during quiet hours.
- Repeat nudges use the current `/settings interval` value. Changing the interval also updates open tasks so old task snapshots do not stay stuck on the previous cadence.
- Short intervals automatically raise an obviously-too-low daily cap so `/settings interval 15` can actually keep nudging for more than a few reminders. You can still override the cap with `/settings max <n>`.
- `/settings quiet off` disables quiet hours and rechecks open tasks so reminders deferred by quiet hours can become eligible again.
- `/settings max <n>` limits total reminders per user per day. If you manually lower the cap with a short interval, `/settings` will show how much reminder coverage that allows.
- `/task 1` shows reminder debug details, including the next reminder time, current interval, daily cap, and quiet hours.

`/brief IDEA-1` does not run a coding agent by itself. It creates a structured implementation prompt that can be copied into Codex, Claude Code, or another coding agent after you choose the target repository.

## Tech Stack

- Node.js + TypeScript
- grammY for Telegram bot handling
- Fastify for webhook and health endpoints
- PostgreSQL for durable storage
- Prisma for schema and migrations
- Zod for environment validation
- OpenAI-compatible adapter for classification, embeddings, idea scoring, and reflection advice
- Vitest for unit tests
- Render for deployment

## Architecture

```text
src/
  ai/                 AI provider interface, OpenAI implementation, local heuristic fallback
  bot/                Telegram commands, callbacks, keyboards, formatting
  config/             Environment parsing
  db/                 Prisma client
  services/           Domain logic for users, tasks, ideas, reminders, search, settings
  utils/              Date parsing, text utilities, vector helpers
  main.ts             Application entrypoint
  server.ts           Fastify health endpoint and webhook route
prisma/
  schema.prisma       PostgreSQL data model
```

The important design choice is that commands and reminders are deterministic. AI is used for classification, structuring, embeddings, scoring, and suggestions, but the core task/reminder system is database-driven.

## Data Model

Threadwise stores:

- Users and per-user settings
- Ideas
- Notes
- Tasks
- Relationship reflections
- Pending natural-language captures
- Processed Telegram update IDs for webhook de-duplication
- Reminder delivery history
- Audit logs
- Embeddings/search vectors as JSON for personal-scale semantic search

The schema is designed so future work can add full Google Calendar OAuth, external search-backed market research, a dashboard, and richer semantic search without replacing the core tables.

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

`OPENAI_API_KEY` is optional for local smoke testing. Without it, Threadwise uses a deterministic heuristic fallback for classification, embeddings, scoring, and reflection advice.

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

## Render Deployment

This repo includes `render.yaml` for a Render web service plus PostgreSQL database.

Set these Render environment variables:

```text
TELEGRAM_BOT_TOKEN
OPENAI_API_KEY
WEBHOOK_URL
BOT_ALLOWED_TELEGRAM_IDS
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

Threadwise stores data per Telegram user. A different Telegram user who messages the same bot gets their own ideas, notes, tasks, settings, and reflections. They do not see another user's saved data through normal bot commands.

If the deployment should be private to only one person or a small team, set:

```text
BOT_ALLOWED_TELEGRAM_IDS=123456789,987654321
```

Leave it blank to allow any Telegram user who can find the bot to use their own isolated Threadwise account.

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

- Full Google Calendar OAuth sync.
- External search provider for live market/competition research.
- Web dashboard for reviewing ideas and tasks.
- Weekly digest.
- Recurring task templates.
- Richer idea selection-to-implementation workflow.
- Relationship pattern tracking over time.
- Per-user privacy controls and export/delete flows.
