# Threadwise Case Study

Updated: 2026-08-12

Current backend release: v0.32.0

### Recent Study reliability decision

Study Mode now treats a selected module as navigation context, not as an implicit write
destination. Ambiguous text and media remain durable pending captures until the owner chooses a
current module. Canvas source refreshes are also separate from local visibility, so archived
courses and assignments stay hidden until the owner explicitly restores them. These boundaries
prevent both silent misfiling and the repeated resurrection of unwanted semester data.

## Summary

**Threadwise turns Telegram messages into things people can find, remember, and finish.**

It is a Telegram-first capture and coordination system organized around three product pillars:

- **Capture** — tasks, reminders, notes, ideas, and searchable images.
- **Coordinate** — immediate assignments, unassigned claiming, progress, group reminders, and shared availability.
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
- Focused Telegram cards for the immediate action—normally completion, snooze, or exact dashboard continuation—with secondary management available on the web instead of a simultaneous button wall.
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
- Immediate multi-assignee tasks, race-safe claiming of unassigned work, assignee completion/snoozing, and creator or freshly verified group-admin reassignment. Older accept, decline, block, and handoff inputs remain graceful compatibility explanations but no longer mutate task state.
- Progressive Telegram disclosure: ordinary cards show one decision with no more than three actions and two rows; lists reveal numbered controls only after the member chooses to act; exact dashboard links open the intended task or TODO review.
- Fresh Telegram role checks for owner/admin-only mutations.
- Receiver-bound ephemeral group menus, so one member's navigation does not overwrite another member's interface.
- One public anchor or work card for shared state, edited in place to prevent chat clutter.
- A distinct group dashboard with Overview, Work, People, Progress, Activity, Resources, and Find a time.
- **Find a time** polls with proposed ranges, duration, participant time zones, a touch-friendly availability grid, overlap ranking, response progress, verified organizer controls, finalization, reminders to non-respondents, and optional per-member Calendar export.

### Private Study Mode

- A sealed academic workspace available only to one configured Telegram owner in one configured two-member group, with exact actor/chat/binding checks and proactive delivery that fails closed.
- Natural-language and button-led capture for module work, notes, questions, links, screenshots, files, mastery, sessions, Canvas sync, attention, weekly planning, and travel—without making an AI service part of the critical path.
- Read-only application behavior around Canvas: automatic 30-minute assignment sync, stable deduplication, local title/date overrides, automatic closure after a real submission, and explicit review when Canvas stops returning an assignment.
- An explainable attention engine that combines deadline proximity, overdue age, explicit priority, module/item mastery, backlog age, planned effort, week position, and Canvas uncertainty.
- Module-scoped recall with local screenshot OCR, reply capture, searchable resources, complete long-note pagination, and silent durable note sessions that auto-save after inactivity.
- Restart-safe Saturday reviews, Sunday previews, restrained deadline/mistake/mastery reminders, saved or temporary travel origins, and public Improved NextBus journey estimates.
- A sealed, responsive Study dashboard with its own Overview, Timetable, Work, Deep Work, Module Shelf, Library, live Search, Review, and Settings architecture. Timetable combines recurring module blocks, planned study work, deadlines, and optional class-travel configuration. It manages the same PostgreSQL records as Telegram, including OCR-backed resources and read-only Canvas state, while direct routes and API calls fail closed outside the exact owner and group.
- A persistent Deep Work companion that leaves Timetable, Work, and Library available during a session. Structured-but-flexible records capture exact timestamps, focus structure, multiple techniques, a custom topic, linked resources, and outcomes; completed records remain editable and softly archivable. AI interpretation is deliberately deferred so the first release improves evidence capture without pretending to assess understanding.

### Beacon community moderation

- A separately branded Telegram bot identity that reuses the always-on Render process without confusing Threadwise's Capture, Coordinate, Recall promise.
- Exact testing/production chat allowlists, an immutable owner, configurable moderator grants, English/Burmese rules, Unicode/Zawgyi normalization, database-backed word/phrase/domain triggers, reports, offence scores, automatic controls, audit history, and forum-topic context.
- A Telegram-only progressive control plane: ordinary members see Rules and How to report; owner and moderators receive distinct private homes; policy, trigger values, scoring, safety, and moderator management remain behind the appropriate role boundary.
- Compact report review that begins with Dismiss, Take action, and Offence history, then exposes only the reviewing moderator's permitted actions. Destructive decisions use actor-, community-, target-, source-, topic-, and expiry-bound confirmations.
- Owner-only trigger enumeration and mutation, with private moderator submissions entering a non-enforcing approval queue instead of revealing the policy library.

### Synchronized dashboard

- Short-lived EdDSA-signed dashboard API requests; the browser receives neither database credentials nor provider tokens.
- Personal and opaque group workspace selection.
- CRUD for tasks, notes, ideas, and images; live search; settings; privacy export and account deletion.
- Group membership revalidation and permission-aware collaboration controls.
- Server-sent events for near-live synchronization between Telegram-backed data and the dashboard.
- Separate personal and group information architectures instead of presenting the group dashboard as a larger personal dashboard.
- A third, owner-only Study information architecture that appears only for the configured academic group and remains absent from every other workspace.

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
- **The personal and group dashboards felt too similar.** Group navigation now emphasizes people, assignment load, progress, activity, resources, and scheduling; personal-only experiments remain absent.
- **External integrations weakened the product story.** Gmail was retired, Expenses/Excel were frozen, and Calendar became a secondary mirror.
- **The original database region added 1–2.5 seconds to many requests.** The data was migrated from Seoul to Singapore and exact row counts were verified before cutover.
- **Academic work was scattered across generic tasks, Canvas, module notes, screenshots, and travel planning.** A private Study domain now keeps these records module-scoped while reusing Threadwise’s capture/recall strengths.
- **An early Study proposal assumed AI would decide what mattered.** Attention and natural-language routing were made deterministic so the same state produces a fast, explainable result without an API key.
- **Copying Canvas manually caused drift, but automatic two-way control was unsafe.** Threadwise now reads assignment/submission state only, preserves local overrides, and never submits coursework.
- **Note-taking acknowledgements interrupted the act of writing.** Study note sessions persist every message silently as a paragraph, then save explicitly or after 30 minutes of inactivity.
- **Telegram reply content could not be filed into a module in one action.** Reply capture now accepts phrases such as `save this to CS2100` for text, links, photos, and documents.
- **Task and TODO cards became overstimulating.** Threadwise now follows `One message, one decision`: three immediate actions at most, numbered choices only on demand, exact dashboard continuation, immediate assignment, and no acceptance/blocking/handoff ceremony.
- **Beacon had no dashboard, yet its Telegram controls had become a flat wall.** Its control plane now uses role-adaptive private homes, focused Policy/More submenus, compact initial report actions, owner-only trigger visibility, permission-filtered actions, and server-side rejection of hidden, stale, or crafted controls.

These decisions are recorded with their rationale in [`docs/PRODUCT_JOURNAL.md`](docs/PRODUCT_JOURNAL.md).

## AI-Assisted Development Disclosure

Threadwise was built with AI coding assistance. I directed the product strategy, requirements, prioritization, tester feedback, privacy boundaries, deployment decisions, and acceptance criteria. AI tools helped with implementation, debugging, documentation, and systematic verification.

The important ownership is not merely authorship of individual lines. The system reflects my decisions about what friction to solve, what to remove, what must be deterministic, how group permissions should work, and which compromises are acceptable.

## Validation

As of v0.32.0 on 2026-08-10:

```text
97 test files passed
786 tests passed; 6 intentionally skipped
Prisma validation and client generation passed
TypeScript typecheck passed
Isolated production TypeScript emit passed
```

The suite covers natural-language parsing, dates and time zones, reminder behavior, quiet acknowledgements, Note sessions, long-note pagination, OCR, archives and bulk actions, group routing and permissions, progressive Telegram button budgets, immediate assignment and claiming, exact dashboard links, ephemeral delivery, group scheduling, dashboard authentication and CRUD, database pooling, Telegram update de-duplication, and Beacon policy/UI authorization including stale and crafted callbacks.

## Current Limitations

- Telegram bots cannot initiate a private message to someone who has never opened the bot.
- Mention-based group natural language requires BotFather privacy mode to be disabled; replies and slash commands work with privacy enabled.
- Live group membership checks are most dependable when the bot is a group administrator.
- Search currently loads a bounded recent window and scores it in application memory; it is designed for personal and small-group scale.
- OCR is strongest on clear printed English/Burmese text and weaker on handwriting, blur, unusual layouts, and unsupported languages.
- Dashboard synchronization is near-live through server-sent events, not an offline-first collaborative document protocol.
- There are not yet enough quantified acquisition, activation, retention, or conversion metrics to claim product-market fit.
- Stored content is not end-to-end encrypted from the service operator.
- Beacon is intentionally Telegram-only. Its progressive private control plane avoids a second dashboard, but still depends on Telegram allowing the bot to DM an operator who has started it privately.

## What I Learned

- Product maturity can mean removing or demoting features, not accumulating them.
- Deterministic behavior is essential for trust in reminders, permissions, undo, and routing.
- AI creates the most value in synthesis; it is often the wrong dependency for ordinary interaction.
- Telegram requires different interaction patterns for private and shared contexts.
- Mobile readability is an information-architecture problem, not simply a font-size problem.
- A dashboard should extend a chat-native workflow, not force users to maintain a second source of truth.
- Progressive disclosure is a safety property as well as a visual choice: inaccessible or destructive actions should be hidden until relevant and rejected again at execution time.
- Exact privacy language matters as much as access-control code.
- Direct user friction is more useful than generic feature inspiration when deciding what to build next.
