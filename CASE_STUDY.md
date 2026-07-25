# Threadwise Case Study

Updated: 2026-07-26

Current backend release: v0.26.0

## Summary

**Threadwise turns Telegram messages into things people can find, remember, and finish.**

It is a Telegram-first capture and coordination system organized around three product pillars:

- **Capture** — tasks, reminders, notes, ideas, and searchable images.
- **Coordinate** — assignees, handoffs, blockers, progress, group reminders, and shared availability.
- **Recall** — search, resurfacing, archives, and synchronized personal or group dashboards.

Threadwise began as a personal reminder and note bot. Direct use and tester feedback exposed a broader problem: useful work already starts in chat, but people must copy it into another application, reconstruct context later, and repeatedly ask what was decided. Threadwise reduces that translation work without trying to become a general project-management or calendar suite.

## The Problem

Conventional productivity applications add friction at the moment of capture:

- The user must leave the conversation where the thought or commitment appeared.
- A form asks the user to choose fields and taxonomy before the idea is fully formed.
- Long bot confirmations make the conversation move twice as quickly as the user's own writing.
- Shared chat interfaces collide when several people press the same inline controls.
- Lists become unreadable on mobile when every item includes all metadata and actions.
- Images are difficult to retrieve later because Telegram search cannot reliably search their visual content.
- Group scheduling becomes a stream of availability messages or a link to an unrelated tool.
- AI-dependent routing can feel slow or fail when the request is actually simple and deterministic.

The product constraint is therefore not “put every productivity feature in Telegram.” It is: **turn chat-native fragments into durable, actionable, retrievable state with as little interruption as possible.**

## Product Strategy

Threadwise uses **Capture, Coordinate, Recall** as a hierarchy rather than presenting every capability equally.

### Core

- Tasks and reminders
- Notes, including quiet multi-message Note sessions
- Searchable saved images with local OCR
- Search and resurfacing
- Shared group work, assignees, and progress
- Group availability through **Find a time**

### Core-adjacent

- Ideas and Idea Brief analysis
- Google Calendar as an optional mirror
- Personal and group web dashboards
- Future Threadwise Intelligence

### Intentionally de-emphasized

- Expenses and Microsoft Excel remain implemented and their data is preserved, but they are frozen and hidden from active product surfaces.
- Gmail was removed from the active runtime. Legacy schema tables remain inert pending a separately reviewed retention decision.

This scope correction came from observing that a long feature list weakened Threadwise's identity. Calendar now supports the work rather than defining the product, while unrelated integrations no longer compete for attention.

## What I Built

### Telegram capture

- Deterministic-first natural-language routing for common task, reminder, note, idea, settings, search, and navigation requests.
- Date parsing for relative and absolute language, dotted clocks such as `1.30pm`, day parts, recurring daily/weekly/monthly/yearly schedules, time zones, and early due nudges.
- Quiet capture acknowledgements that remove themselves after a few seconds while preserving important interpretations such as due dates, recurrence, time zones, and assignees.
- Immediate Task, Note, Idea, or Ignore choices when a private message is ambiguous, instead of waiting on AI or remaining silent.
- Stable public IDs, readable mobile list numbers, pagination, archives, restore, pin/star, bulk actions, and undo.
- Long-note pagination that edits one Telegram message rather than truncating the note or flooding the chat.
- A durable private Note session: each message becomes an exact paragraph, no acknowledgement interrupts writing, and the draft can be saved, cancelled, or auto-saved after inactivity.

### Tasks and reminders

- Database-driven reminder delivery, so restarts do not erase timers.
- Configurable repeat cadence, due-time nudge interval, quiet hours, time zone, delivery style, and daily safety cap.
- Recurring tasks advance the same task row to the next occurrence.
- Replacement reminder delivery sends the new reminder before attempting to remove the previous one.
- Buttons for full details, completion, snooze, star, editing, cancellation, and restoration.
- Best-effort Google Calendar synchronization that keeps Threadwise as the source of truth and updates one durable provider event after edits.

### Notes, ideas, and images

- Notes and ideas with structured titles, bodies/concepts, editing, pins, archives, search, and responsive dashboard cards.
- Note analysis, note merging with preview/retry/undo, idea scoring, and implementation briefs through the AI adapter.
- Photo and image-document capture with editable captions and bundled English/Burmese OCR.
- Search across image captions, filenames, and extracted text without sending the image to an OCR API.
- Confirmed image deletion, favourites, and authenticated image delivery to the dashboard without exposing Telegram file identifiers.

### Group coordination

- A separate chat-scoped workspace for each Telegram group.
- Addressed natural language: group conversation is ignored unless the bot is invoked by command, mention, or reply.
- Multi-assignee tasks with accept, decline, block, unblock, unassign, and handoff flows.
- Fresh Telegram role checks for owner/admin-only mutations.
- Receiver-bound ephemeral group menus, so one member's navigation does not overwrite another member's interface.
- One public anchor or work card for shared state, edited in place to prevent chat clutter.
- A distinct group dashboard with Overview, Work, People, Progress, Activity, Resources, and Find a time.
- **Find a time** polls with proposed ranges, duration, participant time zones, a touch-friendly availability grid, overlap ranking, response progress, verified organizer controls, finalization, reminders to non-respondents, and optional per-member Calendar export.

### Synchronized dashboard

- Short-lived EdDSA-signed dashboard API requests; the browser receives neither database credentials nor provider tokens.
- Personal and opaque group workspace selection.
- CRUD for tasks, notes, ideas, and images; live search; settings; privacy export and account deletion.
- Group membership revalidation and permission-aware collaboration controls.
- Server-sent events for near-live synchronization between Telegram-backed data and the dashboard.
- Separate personal and group information architectures instead of presenting the group dashboard as a larger personal dashboard.

## Architecture

Threadwise is a Node.js/TypeScript backend using:

- **grammY** for Telegram updates, commands, callbacks, reply keyboards, and Mini App links
- **Fastify** for webhooks, OAuth callbacks, health checks, admin diagnostics, and the authenticated dashboard API
- **PostgreSQL/Supabase** for durable state
- **Prisma** for the schema, migrations, and scoped data access
- **Vitest** for unit and integration-style service tests
- **Tesseract.js + Sharp** for local OCR
- **OpenAI-compatible providers** only for synthesis-heavy operations
- **Render** for the always-on backend
- A separate **Vercel** dashboard repository for the web interface

The critical design choice is a deterministic-first request path:

1. Claim the Telegram update to prevent duplicate processing.
2. Apply allowlist and group-addressing rules.
3. Route exact commands and callback data.
4. Parse common natural-language intent locally.
5. Call a domain service that owns validation and persistence.
6. Use AI only when synthesis materially improves the outcome.
7. Return or edit the smallest useful Telegram surface.

This keeps routine interaction latency dominated by PostgreSQL and Telegram rather than an AI round trip.

## Reliability, Privacy, and Reversibility

- Reminders are queried from stored timestamps rather than held in process memory.
- Provider failures never discard a task or meeting already saved in Threadwise.
- User-facing IDs are always resolved inside the current personal or group scope.
- Dashboard tokens are short-lived, signed, and bound to a positive human Telegram identity.
- Group dashboard access uses an opaque workspace ID plus current Telegram membership checks.
- Raw availability cells are private to the member who submitted them; shared views expose only aggregate overlap and response state.
- OAuth refresh tokens are encrypted at rest and never returned through shared views.
- Duplicate Telegram webhook deliveries are claimed once.
- Destructive-looking actions use confirmation, soft archive, or undo where practical.
- Stale scheduling writes use optimistic revisions so an old button cannot overwrite newer responses.

Threadwise is **not end-to-end encrypted**. Ordinary users are isolated by application-level scoping, but the service operator and database administrator can technically access stored plaintext. The product must describe that boundary accurately rather than claiming that the operator cannot read stored content.

## Friction-Led Iteration

The product has been shaped by direct use and feedback from several testers and friends:

- **Strict time syntax missed `1.30pm`.** Date parsing was expanded to dotted and spoken clocks.
- **Every button posted another message.** Callback views now edit the current card when Telegram permits it.
- **A persistent multi-row keyboard was cluttered.** Private chat keeps only Menu and Dashboard shortcuts; group navigation stays attached to the relevant message.
- **Long task/note/idea lists were unreadable on mobile.** Lists now show three concise previews per page and open details in place.
- **Long notes appeared cut off.** Full note bodies are split at paragraph or sentence boundaries and paginated inside one card.
- **The bot “talked back” during note-taking.** Routine acknowledgements became temporary, and Note sessions capture paragraphs silently.
- **Ambiguous text could wait for AI or receive no reply.** The response-critical path now offers immediate capture choices.
- **Several group members shared one mutable inline menu.** Receiver-bound ephemeral delivery gives each person a private interaction surface while shared work remains public.
- **The personal and group dashboards felt too similar.** Group navigation now emphasizes people, handoffs, progress, activity, resources, and scheduling; personal-only experiments remain absent.
- **External integrations weakened the product story.** Gmail was retired, Expenses/Excel were frozen, and Calendar became a secondary mirror.
- **The original database region added 1–2.5 seconds to many requests.** The data was migrated from Seoul to Singapore and exact row counts were verified before cutover.

These decisions are recorded with their rationale in [`docs/PRODUCT_JOURNAL.md`](docs/PRODUCT_JOURNAL.md).

## AI-Assisted Development Disclosure

Threadwise was built with AI coding assistance. I directed the product strategy, requirements, prioritization, tester feedback, privacy boundaries, deployment decisions, and acceptance criteria. AI tools helped with implementation, debugging, documentation, and systematic verification.

The important ownership is not merely authorship of individual lines. The system reflects my decisions about what friction to solve, what to remove, what must be deterministic, how group permissions should work, and which compromises are acceptable.

## Validation

As of v0.26.0 on 2026-07-26:

```text
58 test files passed
547 tests passed
TypeScript typecheck passed
Production build passed
```

The suite covers natural-language parsing, dates and time zones, reminder behavior, quiet acknowledgements, Note sessions, long-note pagination, OCR, archives and bulk actions, group routing and permissions, ephemeral delivery, group scheduling, dashboard authentication and CRUD, database pooling, and Telegram update de-duplication.

## Current Limitations

- Telegram bots cannot initiate a private message to someone who has never opened the bot.
- Mention-based group natural language requires BotFather privacy mode to be disabled; replies and slash commands work with privacy enabled.
- Live group membership checks are most dependable when the bot is a group administrator.
- Search currently loads a bounded recent window and scores it in application memory; it is designed for personal and small-group scale.
- OCR is strongest on clear printed English/Burmese text and weaker on handwriting, blur, unusual layouts, and unsupported languages.
- Dashboard synchronization is near-live through server-sent events, not an offline-first collaborative document protocol.
- There are not yet enough quantified acquisition, activation, retention, or conversion metrics to claim product-market fit.
- Stored content is not end-to-end encrypted from the service operator.

## What I Learned

- Product maturity can mean removing or demoting features, not accumulating them.
- Deterministic behavior is essential for trust in reminders, permissions, undo, and routing.
- AI creates the most value in synthesis; it is often the wrong dependency for ordinary interaction.
- Telegram requires different interaction patterns for private and shared contexts.
- Mobile readability is an information-architecture problem, not simply a font-size problem.
- A dashboard should extend a chat-native workflow, not force users to maintain a second source of truth.
- Exact privacy language matters as much as access-control code.
- Direct user friction is more useful than generic feature inspiration when deciding what to build next.
