# Threadwise developer onboarding

Updated: 2026-08-31 SGT

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
| Dashboard API | `src/dashboard/route.ts`, `auth.ts`, `data.ts`, `study.ts` | JWT verification, workspace authorization, schemas, BFF-facing DTOs |
| Database | `prisma/schema.prisma`, `prisma/migrations/*`, `src/db/prisma.ts` | Relational source of truth and Prisma encryption extension |
| Security | `src/security/*` | Content encryption, replay consumption, rate limits, protected payloads |
| AI adapters | `src/ai/*`, selected workers/services | Optional bounded providers; deterministic paths must remain useful without them |
| Community bot | `src/community/*` | Beacon moderation domain; separate product surface sharing the process |

## Three request flows

### Telegram

`Telegram → authenticated webhook → grammY routing → domain service → Prisma → formatted reply`

Clear commands and natural-language actions are handled deterministically first. AI is optional and
must not become a dependency for capture, reminders, search, Study scheduling, or dashboard access.

### Dashboard

`Browser → Vercel same-origin BFF → 60-second EdDSA JWT → Fastify dashboard route → authorized service`

Never accept a browser-supplied canonical user id. Resolve the Telegram subject server-side, treat an
opaque workspace id as a candidate only, and repeat personal/group/Study authorization inside each
route/service boundary. Mutations consume a JTI and apply shared principal/operation rate limits.

### Study rich notes

`Editor → encrypted StudyNoteDraft → final title/module filing → canonical StudyResource`

Drafts expire, are not searchable, and cannot silently overwrite a newer note revision. Telegram,
Library, search, backlinks, sessions, revisions, and analysis all continue to use `StudyResource`.
The dashboard's UML support is Mermaid-native and local; do not add PlantUML or a remote renderer
without a new privacy/security decision. Locally emitted Markdown must not be routed back through
Tiptap `setContent`, and diagram templates must pass the installed browser parser contract. Do not
create a second note store or enable raw HTML/plugin execution.

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

For a cross-repo release, also run the dashboard's unit, type, lint, build, browser, secret, and audit
gates. Backend schema/API changes release before dashboard consumers.

## Change ownership and hotspots

Prefer incremental extraction when touching these files:

- `src/community/index.ts`
- `src/bot/studyCapture.ts`
- `src/services/study.ts`
- `src/dashboard/data.ts`
- `src/bot/study.ts`
- `src/dashboard/route.ts`

An extraction should preserve exported seams, carry tests with the moved responsibility, and avoid
mixing behavior changes into the same commit. The current audit contains the measured line counts and
recommended split order.

## Deployment and migrations

- Render hosts the backend. Its pre-deploy step applies additive migrations before the new runtime.
- `/health` exposes the short runtime commit; verify it after release.
- Vercel hosts the dashboard; never put secrets in `NEXT_PUBLIC_*` variables.
- Content-encryption migration/inspection commands are intentionally separate from ordinary deploys.
- CSP remains report-only. Do not set dashboard enforcement until `docs/CSP_ROLLOUT.md` passes.

## Definition of done

A change is done only when its behavior, authorization, failure/rollback path, tests, documentation,
and deployed state (when deployment was requested) agree. A green unit suite is not permission to
mutate production data or broaden an owner gate.
