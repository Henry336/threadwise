# Threadwise

Threadwise is a private Telegram life inbox for capturing ideas, managing tasks with recurring reminders, reflecting on relationship situations, searching across saved thoughts, and scoring product ideas.

It is built as a portfolio-ready backend service: typed TypeScript, PostgreSQL persistence, Prisma schema management, Telegram webhooks for Render, and clear service boundaries for future contributors.

## What It Does

- Captures ideas with `/idea <text>`.
- Captures tasks with `/add <task>`.
- Sends recurring Telegram reminders every 3 hours by default until a task is completed.
- Lets users complete or snooze tasks with commands or inline buttons.
- Handles normal messages with natural-language classification and asks before saving them.
- Stores relationship reflections with balanced, non-clinical guidance through `/relationship` or `/reflect`.
- Searches ideas, tasks, and reflections semantically with `/search`.
- Scores ideas with `/score`, including buildability, usefulness, novelty, portfolio value, monetization, difficulty, risk, competition notes, and dos/donts.
- Creates calendar-ready tasks with Google Calendar links and `.ics` exports.
- Supports configurable reminder interval, quiet hours, timezone, reminder cap, and digest mode.

## Commands

```text
/help
/idea build a Telegram bot that...
/add pay invoice tomorrow at 9am
/tasks
/done TASK-1
/snooze TASK-1 1h
/relationship here is what happened...
/reflect here is what happened...
/search reminder bot ideas
/score IDEA-1
/calendar TASK-1
/settings
/settings interval 180
/settings timezone Asia/Singapore
/settings quiet 22:00 08:00
/settings max 5
/settings digest on
```

Normal Telegram messages are also supported. Threadwise classifies them as a possible task, idea, reflection, or noise, then asks for confirmation before saving.

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
- Tasks
- Relationship reflections
- Pending natural-language captures
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
```

`DATABASE_URL` is wired from the Render database in `render.yaml`.

`WEBHOOK_URL` should be the public Render service URL, for example:

```text
https://threadwise.onrender.com
```

Render should run:

```bash
npm run db:migrate && npm start
```

Use an always-on Render plan if you want reminders to be reliable. If the service sleeps, the database keeps tasks safe, but reminders will only be sent after the process wakes back up.

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

