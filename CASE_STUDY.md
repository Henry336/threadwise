# Threadwise Case Study

## Summary

Threadwise is a private Telegram productivity bot built to reduce the everyday friction of remembering tasks, scheduling reminders, saving notes, and turning ideas into implementation-ready prompts without opening another productivity app.

The product started from a personal need: capture life admin and useful thoughts through a lightweight Telegram chat interface, then make retrieval and follow-up simple enough that the system feels like an assistant rather than another dashboard to maintain.

## Problem

General task apps often require the user to switch context, choose the right field, understand the app's taxonomy, and remember how to find the item later. That friction is especially visible for reminders and lightweight notes:

- A reminder phrased naturally, such as "remind me to check laundry after 20 mins", should become a scheduled reminder without the user learning a strict command format.
- Notes should be quick to save, quick to inspect, and easy to archive when they are no longer useful.
- Settings such as timezone and quiet hours should be configurable in plain language, not only through technical command syntax.
- The bot should remain useful when AI API limits are reached.

## Product Goals

- Make Telegram the primary interface, so capture happens where the user already is.
- Support natural language for common requests, while keeping slash commands for power users.
- Keep deterministic behavior for reminders, settings, search routing, undo, archiving, and other operational flows.
- Reserve AI for synthesis-heavy work such as note analysis, idea scoring, note merges, and richer summaries.
- Make mistakes reversible through undo, archive, and restore flows.
- Keep the architecture small enough for one person to understand, debug, and extend.

## What I Built

- Natural-language task and reminder capture with support for phrases such as `in 20 mins`, `after 5 mins`, `tomorrow at 9am`, and `set a reminder for school at 9 am`.
- Notes, ideas, and tasks with stable public IDs plus active list numbers for faster Telegram use.
- Note archiving and restoration, including inline archive buttons and undo support.
- Field-aware editing for task details, note bodies, idea concepts, and titles.
- Undoable task completion, cancellation, snoozing, pinning, renaming, note archiving, note merging, and saved captures.
- Deterministic settings and routing for phrases such as `show me the notes`, `show me the tasks`, and `change timezone to Myanmar`.
- Reminder diagnostics and protected admin endpoints for checking delivery behavior.
- Gmail read-only OAuth scanning with deterministic triage before AI summarization.
- Local image and receipt OCR with confirmation-first note, task, reminder, and expense flows.
- Durable expense tracking with natural manual input, receipt parsing, date-filtered pagination, standalone Excel export, and optional OneDrive workbook synchronization.
- Local deterministic embeddings and semantic-style search for personal-scale notes, ideas, and tasks.
- Documentation covering setup, deployment, architecture, performance model, validation, and current behavior.

## Architecture

Threadwise is a TypeScript backend service using:

- grammY for Telegram bot handling
- Fastify for webhooks and private admin endpoints
- PostgreSQL for durable storage
- Prisma for schema and migrations
- Vitest for unit tests
- Render for deployment
- OpenAI-compatible provider integration for selected synthesis tasks

The main architectural choice is a deterministic-first pipeline:

1. Telegram updates enter command, callback, or natural-language handlers.
2. Command-like natural language is parsed locally for common actions.
3. Clear task, reminder, note, and idea captures are structured locally when possible.
4. Domain services persist data through Prisma and record undo metadata where appropriate.
5. AI is called only when the task needs synthesis or when deterministic classification is not confident enough.

This keeps common workflows fast, predictable, and less exposed to API rate limits.

## Reliability And Reversibility

Threadwise treats most user-facing changes as reversible:

- Newly saved captures can be undone by archiving the created item.
- Archived notes can be restored.
- Note merge confirmation can be undone by restoring source notes and archiving the generated note.
- Field edits and renames record previous values before applying changes.
- Task completion, cancellation, snoozing, rescheduling, and pinning are undoable.

The system favors soft archive over hard deletion so public IDs remain durable and recovery stays possible.

## User Testing And Iteration

The product was iterated through direct use and family testing. That exposed several usability issues:

- Slash-command-only settings were confusing for less technical users.
- Timezone setup needed plain-language aliases such as `Myanmar`, `Yangon`, `Malaysia`, and `Singapore`.
- `Done` was ambiguous as a task button label, so completion buttons now say `Complete task` or `Complete 1`.
- `/note 1` should open note details rather than save a note titled `1`.
- Note lists needed an obvious archive/remove path.

These observations led to natural-language settings, friendlier onboarding copy, clearer action labels, and inline archive/undo controls.

## AI-Assisted Development Disclosure

This project was built with AI coding assistance. I drove the product direction, use cases, constraints, testing feedback, deployment decisions, and prioritization. AI assistance was used as an implementation partner for code changes, debugging, refactoring, documentation, and validation passes.

The project is still mine in the product sense: it reflects my own daily-life friction, my design constraints, my testing loop, and my decisions about what behavior should be deterministic versus AI-assisted.

## Validation

The main validation routine for non-trivial changes is:

```bash
npm run typecheck
npm test
npm run build
git diff --check
```

The current test suite covers deterministic parsing, date handling, formatting, search, Gmail triage, reminder behavior, Telegram update de-duplication, and version diagnostics.

## Current Limitations

- Reminder reliability depends on the deployed service staying awake; a sleeping host pauses the reminder loop.
- Search is designed for personal-scale data and currently scores recent rows app-side.
- There are no quantified usage or retention metrics yet.
- The bot is optimized for Telegram first, not for a full web dashboard.

## What I Learned

- Product polish often comes from removing tiny points of ambiguity, not adding large new features.
- Deterministic behavior is essential for trust in reminders, settings, undo, and archive flows.
- AI is most useful when reserved for synthesis, not for every routine command.
- Real user testing quickly reveals confusing copy and hidden assumptions.
- A personal tool can be portfolio-worthy when it demonstrates clear product judgment, reliability concerns, and thoughtful architecture.
