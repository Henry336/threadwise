# Threadwise developer onboarding

Updated: 2026-09-04 SGT

This is the shortest reliable path from a fresh clone to a safe change. Threadwise spans two repos:

- Backend/bot: `Henry336/threadwise` — Telegram bots, Fastify API, domain services, Prisma schema,
  background loops, provider integrations, and content encryption.
- Dashboard: `Henry336/threadwise-dashboard` — Next.js/React UI and same-origin BFF. Its local
  onboarding guide is `docs/DEVELOPER_ONBOARDING.md` in that repo.

## Read in this order

1. `CLAUDE.md` for current operating rules and latest checkpoints.
2. `README.md` for product behavior, setup, commands, and deployment shape.
3. This file for the code map and safe-change workflow.
4. `docs/ARCHITECTURE.md` for detailed domain flows.
5. `docs/CONTENT_ENCRYPTION.md` and `docs/PHASE3_PRIVACY_RUNBOOK.md` before touching protected data.
6. `docs/POST_RELEASE_CODE_UI_SECURITY_AUDIT_2026-08-31.md` for current risks and priorities.
7. Feature specs/runbooks only when working in that feature.

`PROJECT_CONTEXT.md` is a chronological decision/checkpoint record, not a substitute for current code.
Older audit and rollout documents are historical snapshots unless their header says they are active.

## Runtime map

| Area | Primary files | Responsibility |
| --- | --- | --- |
| Startup | `src/main.ts` | Builds bots/providers, starts loops/server, registers webhooks, shuts down cleanly |
| HTTP ingress | `src/server.ts` | Fastify routes, webhook authentication, shared ingress limits, health/admin/provider callbacks |
| Telegram routing | `src/bot/index.ts`, `commands.ts`, `callbacks.ts`, `naturalLanguage.ts` | Thin update routing and interaction surfaces |
| Domain services | `src/services/*` | Canonical task/note/reminder/group/Study/provider behavior |
| Dashboard API | `src/dashboard/route.ts`, `auth.ts`, `browserSessions.ts`, `data.ts`, `study.ts` | JWT verification, revocable browser sessions, workspace authorization, schemas, BFF-facing DTOs |
| Database | `prisma/schema.prisma`, `prisma/migrations/*`, `src/db/prisma.ts` | Relational source of truth and Prisma encryption extension |
| Security | `src/security/*` | Content encryption, replay consumption, rate limits, protected payloads |
| AI adapters | `src/ai/*`, selected workers/services | Optional bounded providers; deterministic paths must remain useful without them |
| Community bot | `src/community/*` | Beacon moderation domain; separate product surface sharing the process |

## Three request flows

### Telegram

`Telegram → authenticated webhook → grammY routing → domain service → Prisma → formatted reply`

Commands that explicitly name an operation are handled deterministically first. Ordinary prose is
classified only to suggest a reversible capture type; it is not saved until the sender confirms or
changes that type. AI is optional and must not become a dependency for capture review, reminders,
search, Study scheduling, or dashboard access. Receiver-bound continuations must verify the exact actor,
chat, and replied-to prompt before consuming durable state.

### Dashboard

`Browser → signed HttpOnly cookie + active server session → Vercel same-origin BFF → 60-second EdDSA JWT → Fastify dashboard route → authorized service`

Never accept a browser-supplied canonical user id. Resolve the Telegram subject server-side, treat an
opaque workspace id as a candidate only, and repeat personal/group/Study authorization inside each
route/service boundary. Mutations consume a JTI and apply shared principal/operation rate limits.

### Rich notes

`Study editor → encrypted StudyNoteDraft → final title/module filing → canonical StudyResource`

`Personal editor → encrypted PersonalNoteDraft → final title filing → canonical Note`

Drafts expire, are not searchable, and cannot silently overwrite a newer note revision. Telegram,
Library, search, backlinks, sessions, revisions, and analysis all continue to use `StudyResource`.
Personal Notes and Telegram continue to use `Note`; the rich writer is not a parallel collection.
The dashboard's UML support is Mermaid-native and local; do not add PlantUML or a remote renderer
without a new privacy/security decision. Locally emitted Markdown must not be routed back through
Tiptap `setContent`, and diagram templates must pass the installed browser parser contract. Do not
create a second canonical note store or enable raw HTML/plugin execution. Group note drafts remain
outside this flow until their collaboration ownership is explicitly designed.

Study module pins are nullable `StudyModule.pinnedAt` presentation state. Pinned active modules sort
first, followed by the existing display-order/code rules; pinning must not imply Canvas selection,
activation, mastery, or archival. Dashboard timetable create payloads omit empty optional strings;
route validation must translate schema failures into field-specific user guidance rather than expose
raw Zod messages.

## Data and privacy invariants

- PostgreSQL is canonical; Telegram cards and browser state are projections.
- Every personal record is owner-scoped; every shared record is workspace-scoped and role checked.
- Content encryption is application-level AES-256-GCM, not end-to-end encryption. The backend can
  decrypt because product behavior requires it; keys never enter Telegram, Vercel, or the browser.
- Never log secrets, tokens, raw provider payloads, user message bodies, or production content.
- Provider tokens stay server-side and are encrypted at rest. Canvas requests remain read-only,
  same-origin to the configured API boundary, redirect-refusing, timeout/retry bounded.
- Destructive privacy backfills, retention deletion, credential rotation, and production data
  inspection require an explicit runbook and authorization.
- Public Study is a future multi-tenant architecture. Do not weaken the sealed founder owner/chat gate.

## Local setup

```powershell
npm install
Copy-Item .env.example .env
npm run db:generate
npm run typecheck
npm test
npm run dev
```

Use a local/test database. Never copy a production database URL, encryption key, bot token, or provider
credential into a tracked file. The complete environment contract is in `.env.example` and
`src/config/env.ts`.

## Safe change workflow

1. Read the nearest service, its tests, and the relevant schema before editing.
2. State the invariant and authorization boundary the change must preserve.
3. Put domain behavior in services; keep Telegram handlers and dashboard route registration thin.
4. Add behavior tests at the lowest useful layer, then one acceptance test across the boundary.
5. For schema changes, generate an additive migration; prove rollback/recovery before destructive work.
6. Run focused tests while iterating, then the appropriate release gate below.
7. Update `README.md`, `docs/ARCHITECTURE.md`, `CHANGELOG.md`, `CLAUDE.md`, and
   `PROJECT_CONTEXT.md` when product, trust, deployment, or contributor truth changes.

## Validation gates

```powershell
npm run typecheck
npm run build
npm test
npm run security:scan-secrets
npm run security:audit
npm run security:audit:all
npm run security:assurance
```

The default parallel suite can time out under heavy local contention in Excel/file-courier setup. A
failing timeout must be reproduced in isolation and in `npx vitest run --maxWorkers=1`; do not dismiss
assertion failures as flakiness.

Study draft routes must return `DashboardStudyNoteDraft`, not raw Prisma rows. The browser contract needs
only draft id, canonical-resource version, module, title/body, revision, update time, and expiry. Keep
owner ids, workspace ids, draft keys, canonical resource ids, and database creation metadata server-side;
`src/dashboard/studyNoteDrafts.test.ts` guards this minimization boundary.

For a cross-repo release, also run the dashboard's unit, type, lint, build, browser, secret, and audit
gates. Backend schema/API changes release before dashboard consumers.

## Change ownership and hotspots

Phase 3 established two backend composition seams:

- `src/dashboard/route.ts` owns shared authentication, replay/rate limiting, workspace resolution,
  common error mapping, and non-Study route composition. `src/dashboard/studyRoutes.ts` owns only the
  Study HTTP surface and receives the already-secured `run` boundary from the parent router.
- `src/community/registration.ts` owns grammY middleware, command, callback, membership, and message
  registration. `src/community/index.ts` retains Beacon moderation conversations and domain behavior,
  injected into registration through `BeaconRegistrationHandlers`.

Characterization tests in `src/maintainabilityBoundaries.test.ts` protect route/event inventory and
keep these responsibilities from silently collapsing back together. Prefer further incremental
extraction when touching the remaining hotspots:

- `src/community/index.ts`
- `src/bot/studyCapture.ts`
- `src/services/study.ts`
- `src/dashboard/data.ts`
- `src/bot/study.ts`
- `src/dashboard/route.ts`

The first pass reduced `community/index.ts` from 2,955 to 2,772 lines and `dashboard/route.ts` from
1,383 to 1,070 lines while preserving all 112 HTTP route paths and all nine Beacon registration entry
points. These files remain large, so the risk is reduced rather than erased. An extraction should
preserve exported seams, carry tests with the moved responsibility, and avoid mixing behavior changes
into the same commit.

## Deployment and migrations

- Render hosts the backend. Its pre-deploy step applies additive migrations before the new runtime.
- For Study Calendar releases, follow `docs/STUDY_TIMETABLE_SYNC_OPERATIONS.md`: deploy its additive
  schema/backend first, verify health, and only then deploy the dashboard consumer. Synchronization is
  opt-in; do not enable it through a migration or silently enable timetable reminders.
- `/health` exposes the short runtime commit; verify it after release.
- Vercel hosts the dashboard; never put secrets in `NEXT_PUBLIC_*` variables.
- Content-encryption migration/inspection commands are intentionally separate from ordinary deploys.
- The dashboard CSP is enforced by default; its documented emergency rollback is explicit report-only.
  Preserve nonce-bound scripts/style elements and the narrowly scoped dynamic-style-attribute lane.

## Definition of done

A change is done only when its behavior, authorization, failure/rollback path, tests, documentation,
and deployed state (when deployment was requested) agree. A green unit suite is not permission to
mutate production data or broaden an owner gate.

## Capture correction invariants

- Keep ordinary capture review actor-bound; Personal/Group review lookup must include user, Telegram
  actor, chat, and unexpired state. Study lookup must include workspace, source actor, and expiry.
- Run explicit active flows before correction parsing. A correction must never consume an expense
  edit, image reminder, item edit, Today Add-more reply, or active note session.
- Keep `parseCaptureCorrection` narrow: it requires `this`/`that` plus explicit change/save language.
- Never enable post-save shared correction until creation provenance contains a durable member actor.
- `captureRoutingAcceptance.test.ts`, `captureReclassification.test.ts`, and
  `undoReclassification.test.ts` are required gates for edits to this path.
