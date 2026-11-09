# CLAUDE.md — Threadwise (backend + bot)

Entry point for any AI or human contributor. Written to be model-agnostic: it works
for Claude Code, Codex, or any other assistant. If you read one file first, read this,
then follow the pointers below.

## Current state

- Backend v0.35.7 is live: merge `81a6f5becc75` through Render deployment
  `dep-dakb8rk9v7es73dfm58g` (Study Calendar weekday fix).
- Dashboard v0.10.2 is live at `5ecfe5f` on Vercel.
- The current plan of work is [`docs/REVIEW_2026-11-01.md`](docs/REVIEW_2026-11-01.md), section 10.
- The Daily Tech Brief (a side project) was prepared on 2026-10-14 but is not scheduled.
- Full history: [`CHANGELOG.md`](CHANGELOG.md) for releases,
  [`docs/archive/WORKING_LOG_2026.md`](docs/archive/WORKING_LOG_2026.md) for the working log and
  past implementation checkpoints, and `PROJECT_CONTEXT.md` for detailed release evidence.

> **Ground every answer in the live repository and current deployment, not in this file
> or any summary.** Re-run checks; re-read the code. Version numbers and counts here are
> snapshots and drift.

## What Threadwise is

Threadwise turns Telegram messages into things people can find, remember, and finish.
Product hierarchy: **Capture, Coordinate, Recall**. It is a Telegram productivity
assistant that stays fully useful **without** a paid AI API — deterministic rules and
local heuristics handle the response-critical path; AI is an optional adapter.

- Runtime: Node.js + TypeScript (ES2022, CommonJS), Fastify server, grammY Telegram bot.
- Data: PostgreSQL via Prisma (schema in `prisma/schema.prisma`, migrations in `prisma/migrations/`).
- Optional AI: OpenAI provider with deterministic/heuristic fallback (`src/ai/`).
- The web dashboard is a **separate repo**: `Henry336/threadwise-dashboard`
  (local path `D:\CodexProjects\threadwise-dashboard`, its own `CLAUDE.md`).

## Repos & deployment

| | Backend (this repo) | Dashboard |
|---|---|---|
| GitHub | `Henry336/threadwise` | `Henry336/threadwise-dashboard` |
| Branch | `main` | `main` |
| Host | Render (`render.yaml`) | Vercel |
| Live | https://threadwise-90du.onrender.com | https://threadwise-dashboard.vercel.app |
| Health | `/health` reports release + commit | — |

## Commands

```bash
npm run dev          # tsx watch src/main.ts (local dev)
npm test             # vitest run (all *.test.ts)
npm run typecheck    # tsc --noEmit
npm run build        # tsc -> dist/
npm start            # node dist/main.js (prod entry)
npm run db:generate  # prisma generate
npm run db:migrate   # scripts/migrate-deploy.mjs (deploy migrations)
npm run db:dev       # prisma migrate dev (local schema change)
```

Release loop when the user asks to publish: **typecheck → test → build → intentional
commit → push `main` → confirm Render `/health` shows the new version + commit prefix.**
Tests live next to code as `*.test.ts` and double as executable examples.

## How to read the codebase

1. This file, then `README.md` (behavior, setup, boundaries).
2. `docs/ARCHITECTURE.md` — request flow, data scoping, reminders, group routing, Study, auth.
3. `prisma/schema.prisma` — the durable state.
4. `src/main.ts` → `src/server.ts` → `src/bot/index.ts`.
5. Follow a feature from its `src/bot/` handler into `src/services/`; read the adjacent test.
6. `CHANGELOG.md` for what changed; `docs/PRODUCT_JOURNAL.md` for *why*.
7. `docs/README.md` indexes every doc by kind; finished reports are in `docs/archive/`.

## Architecture rules (do not break these)

- Keep task and reminder behavior **deterministic**. Store all durable state in PostgreSQL.
- Treat AI as an adapter (`src/ai/`, `AiProvider` interface), never the center. Deterministic
  handlers take the obvious cases before any AI call; the response path never blocks on AI.
- Parse command-like natural language locally (`naturalCommands.ts`) before AI classification
  (`deterministic.ts`); low-confidence private messages become a `PendingCapture` with
  Task/Note/Idea/Ignore buttons instead of waiting on AI.
- Keep Telegram handlers thin; domain rules live in `src/services/`.
- Personal data is scoped to a human owner; shared data to one verified group workspace.
  `ensureUser` uses the human Telegram id in private chats and a synthetic `chat:<id>` owner
  for groups (see `src/services/users.ts`).
- Destructive-looking operations (e.g. note merge, bulk delete) are **preview-and-confirm**.
  Reversible actions are logged in `AuditLog` with an `undoable:` prefix; `/undo` restores or
  archives rather than hard-deleting, so public IDs are never reused.
- Telegram copy convention: content first, then a compact metadata block (IDs/dates), then
  guidance. Change copy in the formatter helpers (`src/utils/messageFormat.ts`,
  `src/bot/formatters.ts`, per-service card formatters), not inline in handlers.
- Follow `One message, one decision` in Telegram. Ordinary item cards stay within three
  immediate actions and two rows; secondary management should use a focused subflow or an exact
  dashboard deep link. Assignment is immediate, unassigned work may be claimed, and only the
  creator or a freshly verified group admin may reassign existing work.
- Voice: calm, capable, human; lead with the outcome; restrained semantic emoji. See
  `docs/VOICE_AND_TONE.md`.

## Notable subsystems

The product other people use is Personal mode, Group mode and the dashboard. Everything in
this list is either the owner's private tool (Study) or a side project that reuses the same
bot process. None of it is part of the product.

- **Study Mode** — owner-only sealed domain in one bound 2-member group. Fails closed on
  actor/chat/binding/member-count. Split across `src/bot/study*.ts` and
  `src/services/study*.ts`. Has its own live dashboard. See `docs/STUDY_MODE.md`.
- **Beacon** — separately branded community-moderation bot that shares this Render process
  (second Telegram identity, gated by `BEACON_BOT_TOKEN`). It has no dashboard: ordinary members,
  owner, and moderators receive progressively disclosed Telegram homes, while every hidden or
  destructive callback is re-authorized server-side. See `docs/BEACON.md`.
- **Codex worker** — a laptop-side worker (`src/codexWorker.ts`, `src/codexTaskSync.ts`,
  `scripts/*-codex-worker.ps1`) runs local Codex/Gemini read-only for `/idea` develop and
  private code tasks. Setup: `docs/PRIVATE_CODEX_MODE.md`, `docs/PRIVATE_CODEX_IMPLEMENTATION_NOTES.md`,
  `docs/TELEGRAM_REMOTE_OPERATOR.md`, `docs/OWNER_FILE_COURIER.md`.
- **Frozen surface** — Expenses/Excel/Microsoft services and tables are retained, but the
  feature has no Telegram entry points; keep those env vars blank unless deliberately testing.

## Continuity — what survives if you lose this machine or a given AI tool

The **code and all reasoning live in git**, so any AI in any environment can continue from a
clone. Verify both repositories' current branches and working trees before assuming the latest
local change has been pushed. The knowledge is *not* trapped in one assistant's
proprietary memory. Two things are **not** in git and are the real single points of failure:

1. **Secrets** (`.env`, `.env.region-migration`) are gitignored. They exist only on this
   laptop and in the Render/Vercel dashboards. `.env.example` documents every variable's
   shape. **Back up the irreplaceable ones in a password manager** — especially the
   encryption keys, because losing them makes stored user data undecryptable:
   `GOOGLE_TOKEN_ENCRYPTION_KEY`, `MICROSOFT_TOKEN_ENCRYPTION_KEY`, the dashboard
   Ed25519 signing key (`DASHBOARD_API_PRIVATE_KEY` / matching public key), plus
   `TELEGRAM_BOT_TOKEN`, `BEACON_BOT_TOKEN`, `OPENAI_API_KEY`, and OAuth client secrets.
   (Rotating a bot token is possible; rotating an encryption key orphans existing ciphertext.)
2. **`.codex/PROJECT_CONTEXT.md`** is excluded locally via `.git/info/exclude`, so it is not
   on GitHub and can be stale. This `CLAUDE.md` is the canonical, tracked entry file; prefer it.

Everything else (docs, schema, migrations, scripts, render.yaml) is tracked and portable.

## Cross-AI handoff (Claude ↔ Codex)

The owner works between Claude Code and Codex interchangeably depending on remaining usage.
Both assistants share **one canonical context: this `CLAUDE.md`.**

- `AGENTS.md` (tracked, repo root) is a thin pointer so Codex auto-loads this file.
- `.codex/PROJECT_CONTEXT.md` (local, excluded from the repository) also points here; treat this file as authoritative.
- **Whoever does work adds a short entry at the top of the Working log** in
  [`docs/archive/WORKING_LOG_2026.md`](docs/archive/WORKING_LOG_2026.md) so the other assistant
  picks up cleanly. Keep entries short: date, who, what changed, current state. Newest first.
- Update "Current state" above when a release changes the live versions. Keep it to a few lines.
