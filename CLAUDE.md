# CLAUDE.md — Threadwise (backend + bot)

Entry point for any AI or human contributor. Written to be model-agnostic: it works
for Claude Code, Codex, or any other assistant. If you read one file first, read this,
then follow the pointers below.

## Latest implementation checkpoint

- **2026-08-31 (Codex, Phase 1–3 regression audit validated):** Re-audited the deployed
  Study-draft/UI, browser-session/CSP, and maintainability-extraction phases. No backend route, Study
  scope, DTO field, or Beacon registration was lost. The paired dashboard corrects false-success logout
  on rejected revocation and overlapping Study/confirmation scroll locks, while destructive confirmation
  now isolates the obscured page. Complete backend/dashboard/security/browser/build/dependency gates are
  green; paired release and live revision evidence are pending.

- **2026-08-31 (Codex, deployed Phase 3):** Performed the first behavior-preserving
  large-module extraction behind characterization tests. The general dashboard router delegates all
  Study endpoints to `src/dashboard/studyRoutes.ts` after shared auth/replay/rate/workspace checks;
  Beacon delegates grammY registration to `src/community/registration.ts` while moderation decisions
  remain injected domain handlers. Route inventory remains 112 and all nine Beacon registration entry
  points are preserved. The paired dashboard separates Deep Work/module analysis and the shared Study
  dialog from its shell. Backend PR `#24` is live at `29d439cc4b15`; dashboard PR `#9` is live through
  Ready production deployment `dpl_FppQmpqC8ZyPr6bMbJmyJjmVwhju` at merge `f6f8326e559e`. No schema,
  API path, copy, provider, secret, or product behavior changed.

- **2026-08-31 (Codex, deployed Phase 2):** Added an additive owner-scoped
  `DashboardBrowserSession` registry and signed-service-token create/check/revoke routes. The paired
  dashboard now registers either Telegram login, rejects legacy/non-active/cross-owner sessions on each
  personalized request, and revokes the exact record on logout. CSP enforcement is the dashboard
  default with nonce-bound scripts/style elements and a separately scoped dynamic-style-attribute lane.
  Local backend gates pass at 988 tests/6 skips and 158 security checks; paired dashboard gates pass at
  184 tests, 85 security checks, and Playwright 15/5 intentional skips. Backend PR `#21` is live on
  Render at `5b2b962324ba`; dashboard PR `#6` is live through Ready Vercel production deployment
  `dpl_Bhk9yjShbMNnYu4gxYkbCgojHoDp` at code merge `c4eade6b85de`. Phase 3 large-module extraction remains.

- **2026-08-31 (Codex, deployed Phase 1):** Closed the bounded Study draft-DTO, rendered-selector,
  unnamed-image-action, large-note benchmark, and authenticated Study editor lifecycle findings without
  entering CSP enforcement, session revocation, or large-module refactoring. Study draft responses now
  exclude internal ownership/storage metadata. A synthetic local service verifies real EdDSA service
  tokens and workspace scoping while Playwright proves recovery, conflicts, import guidance, filing focus,
  canonical save, and Library visibility. The real editor measured 875/886/941 ms at approximately
  10k/50k/100k characters. Backend PR `#19` deployed first at `1d47597f30bd`; dashboard PR `#4`
  followed at `14f285ebfcba`, with both GitHub gates, Vercel production, Render health, and 12 hosted
  browser checks passing. See `PROJECT_CONTEXT.md` and the 31 August post-release audit addendum.

- **2026-08-31 (Codex, deployed):** Completed the paired rich-note friction and Study
  organization pass. Dashboard typing now uses bounded Markdown synchronization and contenteditable-aware
  shortcuts; numbered/bulleted markers, aligned active filing dialogs, visible import errors, mobile
  search names, and best-effort page-hide persistence are covered. Study modules gain additive nullable
  pins; timetable creation omits invalid null custom types, keeps Destination optional, aligns the
  leave-time row, and receives field-specific validation copy. See `PROJECT_CONTEXT.md` and the audit
  addendum for resolved versus still-open findings. Backend `4689c8dd5608` is healthy after the
  additive migration; dashboard `5e831a918a4f` completed Vercel, passed GitHub CI run `33376998070`,
  and passed 12 hosted browser checks with 2 intentional mobile skips.

- **2026-08-31 (Codex, deployed):** Fixed rich-editor checklist alignment at the Tiptap
  label/content boundary and extended the checked Study writing experience to Personal mode without
  changing Group. Personal keeps canonical `Note` records but gains full-screen WYSIWYG Markdown,
  local strict Mermaid/UML, title-only filing, `.md` portability, and encrypted owner-scoped
  `PersonalNoteDraft` recovery with seven-day expiry and optimistic conflicts. Backend `25f80939b8e2`
  released first with its additive migration and healthy Render gate; dashboard `7bf90df1a75a` then
  completed its Vercel deployment and the hosted desktop/mobile Personal flow passed.

- **2026-08-31 (Codex, dashboard deployed):** The Study rich editor now distinguishes
  local Markdown emissions from genuine external replacements so autosave renders do not reset the
  active selection. Tab/Shift+Tab supports portable list and Mermaid/code indentation, and a searchable
  Mermaid/UML guide provides browser-validated class, sequence, state, and general diagram examples.
  The backend/data model is unchanged and UML remains inside the existing strict local Mermaid trust
  boundary. Dashboard runtime `e9e21b192f15` passed GitHub CI and completed its Vercel production
  deployment; the canonical dashboard returns HTTP 200.

- **2026-08-31 (Codex, deployed and audited):** Released the Study-first full-screen rich-note slice:
  encrypted cross-device drafts, inline Markdown/Mermaid editing, title/module filing into canonical
  Study resources, and compatibility-safe visible tag retirement. Backend runtime `0adbf0be688f`
  and dashboard runtime `b81f57fc3594` are live. The post-release audit and new-developer map are
  `docs/POST_RELEASE_CODE_UI_SECURITY_AUDIT_2026-08-31.md` and
  `docs/DEVELOPER_ONBOARDING.md`. No critical vulnerability or confirmed release regression was
  found; residual CSP, session-revocation, editor accessibility/recovery/large-note benchmarking,
  behavioral-test, native-selector, and large-module findings are documented. The duplicate
  per-keystroke serialization/selection-replacement finding has since been remediated above.

- **2026-08-28 (Codex):** Made Today task capture self-explanatory in Telegram. `/today` now pairs
  `＋ Add tasks` with `Open Today`; the add action opens a force-reply composer that accepts one task or
  newline-separated batches and returns the existing atomic review card. Commas split conservatively
  only before another clear action; noun/object lists remain one task. `/today` and `/todo`
  are discoverable in Personal, Group, and Study command menus, and Help calls the area `Today & tasks`.
  The latest complete suite passes with 964 tests and 6 intentional skips; focused formatter/command/
  interaction/parser tests, typecheck, production build, tracked-secret scan, and diff checks are green.

- **2026-08-28 (Codex, deployed):** Completed the expanded Phase 1–3 executable acceptance
  gate. Backend now passes 961 tests with 6 intentional skips; dashboard passes 139 tests and the
  release-artifact browser suite passes 7 with 1 intentional mobile skip. The suite covers timezone/
  DST, restart/replay, batch atomicity, authorization, private-chat eligibility, Canvas deadline
  preservation, exact links, accessibility, and responsiveness. It also drove two fixes: private-chat
  identity repair and exact Canvas Study planning without duplication. Backend `0ab4c9cffced` is live
  on Render deployment `dep-da8et9mk1f9s73bss8i0` after additive pre-deploy migrations; public health
  reports the exact commit. Dashboard `eac5844` is successful on Vercel with hosted validate/browser
  checks green. The owner gate matches the existing production owner identity; its value is not stored.

- **2026-08-28 (Codex, guarded):** Reconciled the Phase 1–3 Today-planning documentation and added
  `docs/PHASE1_3_TODAY_MORNING_UPDATE.md`. Canonical docs now distinguish implemented/tested guarded
  behavior from production and record the expanded executable acceptance matrix as a pre-merge gate.
  No runtime, migration, configuration, merge, or deployment changed in this documentation pass.

- **2026-08-21 (Codex, deployed):** Added a bounded personal Overview quote library to
  `UserSettings` and the authenticated dashboard settings contract. Quote entries normalize
  whitespace, reject duplicates, allow 280 text/120 optional-author characters, cap at 40, and can
  only be updated from a personal workspace. Render deployment `dep-da43kkbbc2fs7395ht60` is live
  at runtime commit `3860db813a34` after its required migration step; paired dashboard runtime
  `fc2cf64` completed its Vercel production deployment.
- **2026-08-18 (Codex, deployed):** Completed the authorized guarded-stack release. Backend PR #17
  merged as `0699835d8ffe2132e8ce29dd03496d8fada71538`; Render `/health` reports HTTP 200 at
  `0699835d8ffe`. Gate 3A used a fresh encrypted logical backup, an exact 95-table/21,563-row
  isolated restore comparison, all 60 migrations, and owner-attested independent content-key
  recovery. Production now reports the privacy, mutation-replay, and shared-rate-limit tables.
  Dashboard PR #2 merged as `b00a3d15660a5714852a7a4096387f6995127845`; Vercel completed the
  deployment and `/dashboard?demo=1` returned HTTP 200. No destructive privacy backfill or retention
  ran. Rotate the historical Canvas access token next; preserve the ignored Gate 3A backup and
  passphrase-source file until the rollback-retention decision is explicit.
- **2026-08-17 (Codex):** Researched Coursemology assignment/deadline integration on guarded branch
  `codex/study-image-sidebar-coursemology`; canonical evidence and the safety gate are in
  `docs/COURSEMOLOGY_INTEGRATION_RESEARCH.md`. The authenticated lesson-plan JSON contains the
  required timing data, but no documented public third-party OAuth/API/calendar contract was found.
  Do not collect browser tokens/cookies or build a connector until the NUS/Coursemology operator
  confirms a supported read-only contract. No provider, credential, schema, database, production,
  merge, or deployment state changed.
- **2026-08-17 (Codex):** Completed the post-Phase-7 local audit on guarded branch
  `codex/post-phase7-work-filter-audit`; canonical evidence is
  `docs/POST_PHASE7_CODEBASE_AUDIT.md`. The guarded cycle is materially safer with no confirmed
  cycle-caused regression, but production has not inherited most Phase 3–7 changes. Gate 3A,
  Phase 6 F-01–F-03, CSP enforcement evidence, and hosted synthetic staging remain open. No audit
  finding was remediated, merged, deployed, or used to mutate production in this pass.
- **2026-08-17 (Codex):** Completed Phase 7 public Study architecture on the guarded
  `codex/phase7-public-study-architecture` branch. Backend architecture commit `77739bd` defines
  tenant membership/capabilities, founder compatibility, OAuth-only encrypted Canvas custody,
  isolated bot identity, fair jobs/quotas, audit/export/deletion, threat controls, and a staged
  cohort. Matching dashboard boundary commit `16687b3` preserves the BFF and sealed founder path.
  Phase 7 made documentation only: no schema, runtime, credential, bot, database, invitation,
  merge, deployment, or production change.
- **2026-08-17 (Codex):** Completed Phase 5 browser hardening on guarded cross-repository branches:
  staged nonce CSP, scoped/expiring browser drafts, consent-gated remote Markdown images, bounded
  Mermaid rendering, dashboard CI/security scans/browser tests, and a bounded Markdown media split.
  CSP remains report-only until preview evidence is clean; no deployment or production mutation was
  performed. Backend validation passed 884 tests with 6 intentional skips and clean dependency audits.
- **2026-08-17 (Codex):** Implemented the approved Phase 3 privacy remediation behind Gate 3A:
  extended server-side encryption to retained AI/Canvas/suggestion payloads, replaced cumulative
  blind indexes with complete-record sets, added guarded resumable backfill and retention tooling,
  and documented activation/rollback. Production apply/deletion remains blocked until backup,
  isolated restore, and encryption-key recovery are proven.

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

- **Study Mode** — owner-only sealed domain in one bound 2-member group. Fails closed on
  actor/chat/binding/member-count. Split across `src/bot/study*.ts` and
  `src/services/study*.ts`. Has its own live dashboard.
- **Beacon** — separately branded community-moderation bot that shares this Render process
  (second Telegram identity, gated by `BEACON_BOT_TOKEN`). It has no dashboard: ordinary members,
  owner, and moderators receive progressively disclosed Telegram homes, while every hidden or
  destructive callback is re-authorized server-side. See `docs/BEACON.md`.
- **Codex worker** — a laptop-side worker (`src/codexWorker.ts`, `src/codexTaskSync.ts`,
  `scripts/*-codex-worker.ps1`) runs local Codex/Gemini read-only for `/idea` develop and
  private code tasks. Setup: `docs/PRIVATE_CODEX_IMPLEMENTATION_NOTES.md`,
  `docs/TELEGRAM_REMOTE_OPERATOR.md`, `docs/OWNER_FILE_COURIER.md`.
- **Frozen surface** — Expenses/Excel/Microsoft is retained but hidden; keep those env vars
  blank unless deliberately testing.

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
- `.codex/PROJECT_CONTEXT.md` (local, git-excluded) also points here; treat this file as authoritative.
- **Whoever does work updates the Working log below** so the other assistant picks up cleanly.
  Keep entries short: date, who, what changed, current state. Newest first.

## Working log

- **2026-08-31 (Codex, Phase 1–3 regression audit validated):** Found and fixed two paired-dashboard
  regressions: non-2xx session revocation can no longer clear the cookie as if logout succeeded, and
  overlapping Study/global dialogs now share reference-counted scroll restoration plus inert background
  isolation. Backend 990/6 and 158 security checks, dashboard 187/86 and browser 17/5, builds, scans,
  audits, route inventory 112, and Beacon registrations 11 are green. Release is pending.

- **2026-08-31 (Codex, deployed Phase 3):** Added the backend Study-route and
  Beacon-registration seams plus the paired dashboard Study-shell/Deep-Work/dialog seams. Added
  maintainability characterization budgets and updated audit/onboarding/changelog/context records.
  Backend `29d439c` is healthy on Render; paired dashboard `f6f8326` is Ready on Vercel production.

- **2026-08-31 (Codex, deployed):** Implemented bounded rich-note synchronization, fixed the
  global-shortcut focus theft, restored list markers, isolated/aligned filing focus, added module pinning,
  and corrected optional timetable payload/error/layout behavior. Updated continuity, onboarding, design,
  and audit documentation. Backend `4689c8d` released first with its additive migration; dashboard
  `5e831a9` then completed CI/Vercel and passed the hosted browser gate.

- **2026-08-31 (Codex, dashboard deployed):** Implemented the dashboard-only Study typing-focus fix, stable body callback,
  accessible diagram guide, Mermaid-native UML templates, and Tab indentation. Updated paired project
  context and audit status; runtime `e9e21b1` is live and no backend runtime, migration, secret, or
  provider changed.

- **2026-08-31 (Codex):** Completed a post-release static, dependency, test, and live responsive
  audit across both repos. Added current findings plus onboarding maps; reconciled Gate 3A and Phase 6
  status; refreshed README/architecture/changelog/handoff/context. Runtime behavior was deliberately
  unchanged. Full serialized backend, dashboard unit/browser/type/lint/build, secret, and dependency
  gates pass. Findings await owner prioritization.

- **2026-08-31 (Codex):** Implemented and released the approved Study-first full-screen rich note
  slice without 21st.dev: encrypted cross-device `StudyNoteDraft` autosave with optimistic conflicts
  and expiry; one Overview entry point; inline rich Markdown/Mermaid editing; final title/module filing
  into the canonical Study resource; and compatibility-safe retirement of visible/generated tags
  across all modes. See `PROJECT_CONTEXT.md` for the exact release record.

- **2026-08-28 (Codex):** Implemented Phase 3 Today delivery and private Note refinements on guarded
  branch `codex/phase3-today-delivery-notes`. Owner-gated morning/evening loops now send bounded,
  idempotent, quiet-hours-aware private digests spanning Personal, assigned Group, and Study work;
  empty digests skip silently. Carryover uses a two-step audited decision, expired drafts replace
  their original card, and private Note sessions use one persistent paragraph counter with one-hour
  auto-save. Added one additive status-message migration and corrected server forwarding of the Today
  owner gate. Prisma/typecheck/build, 940 tests (6 skipped), and secret scan pass. No migration,
  merge, deployment, or production enablement occurred.

- **2026-08-28 (Codex):** Implemented Phase 2 Today interactions on guarded branch
  `codex/phase2-today-interactions`, stacked on the pushed Phase 1 foundation. Telegram now supports
  owner-gated cross-mode batch review, Add more, focused edits, atomic save, `/today`, and audited
  carryover re-planning without AI or implicit reminders. Paired dashboard work supplies the shared
  Personal/Group/Study Today planner and exact draft editor. Backend typecheck/build, 934 tests with
  6 skips, focused regressions, and secret scan pass. No migration, merge, deployment, scheduler, or
  production enablement was performed; scheduled briefs and Note refinements remain Phase 3.

- **2026-08-28 (Codex):** Implemented the guarded Phase 1 Today foundation on
  `codex/phase1-today-foundation` at implementation commit `bb2dacd`: additive planned dates
  independent of deadlines, durable
  all-or-nothing task drafts with Add more/expiry/ambiguity handling across Personal, Group, and
  Study, derived daily agendas, disabled-by-default brief preferences, and an idempotent delivery
  ledger. New draft tasks do not create implicit reminders. Owner-only dashboard contracts fail
  closed behind `TODAY_FOUNDATION_OWNER_TELEGRAM_ID`; Telegram/dashboard presentation and actual
  brief delivery remain future phases. Prisma, typecheck, build, 932 tests (6 skipped), 148 security
  tests, secret scan, and diff checks pass. No migration or deployment was run.

- **2026-08-28 (Codex, documentation only):** Recorded the accepted, unimplemented Today-planning
  direction in `PROJECT_CONTEXT.md` and `docs/TODAY_TASKS_AND_NOTE_SESSIONS_PRODUCT_SPEC.md`. The
  specification separates planned days, deadlines, reminders, notes, and timetable blocks; defines
  derived carryover, bounded morning/evening digests, progressive `Save / Add more / Edit` task-draft
  capture, cross-mode privacy, Study deadline preservation, and private exact Note sessions; and
  preserves the complete proposed Telegram acceptance dialogue. No runtime, schema, database,
  dashboard, deployment, or production state changed.

- **2026-08-25 (Codex):** Implemented Phase 1 reliability safeguards on
  `codex/phase1-reliability-foundation`. Canvas sync now retains term identity, rejects clearly
  out-of-semester courses, and quarantines implausible/missing Canvas deadlines instead of
  presenting or reminding on them as overdue. Reminder passes persist reason-coded health;
  schedule blocks expose delivery readiness; and recurring blocks support occurrence,
  this-and-future, and whole-series removal via additive week exceptions. Added the additive
  `20260824120000_phase1_study_reliability` migration and focused regressions. Prisma validation,
  typecheck, build, secret scan, focused tests, and the complete single-worker suite (913 passed,
  6 skipped) pass. Dashboard pairing and final push remain in progress.

- **2026-08-25 (Codex):** Implemented Phase 1 reliability safeguards on
  `codex/phase1-reliability-foundation`. Canvas sync now retains term identity, rejects clearly
  out-of-semester courses, and quarantines implausible/missing Canvas deadlines instead of
  presenting or reminding on them as overdue. Reminder passes persist reason-coded health;
  schedule blocks expose delivery readiness; and recurring blocks support occurrence,
  this-and-future, and whole-series removal via additive week exceptions. Added the additive
  `20260824120000_phase1_study_reliability` migration and focused regressions. Prisma validation,
  typecheck, build, secret scan, focused tests, and the complete single-worker suite (913 passed,
  6 skipped) pass. Dashboard pairing and final push remain in progress.

- **2026-08-21 (Codex):** Personal Overview quote persistence is implementation-complete on
  `codex/personal-overview-quotes`. Added one additive JSONB migration, strict API normalization,
  snapshot/export coverage, and personal-workspace enforcement. Backend passes 909 tests with
  6 skips, typecheck/build/Prisma validation, 140 security checks, secret scan, and zero-finding
  production/full dependency audits. Backend runtime `3860db8` and paired dashboard runtime
  `fc2cf64` are deployed; only this documentation-only release record follows them.

- **2026-08-17 (Codex):** Phase 7 architecture is complete on guarded backend/dashboard branches.
  Backend `77739bd` adds `docs/PUBLIC_STUDY_ARCHITECTURE.md`,
  `docs/PUBLIC_STUDY_THREAT_MODEL.md`, and `docs/PUBLIC_STUDY_ROLLOUT.md`; dashboard `16687b3`
  adds its BFF/browser boundary. The founder workspace remains sealed. Phase 6 F-01–F-03, hosted
  synthetic staging, remote ephemeral PostgreSQL CI, and Gate 3A remain cohort blockers. No public
  bot, OAuth connection, migration, invitation, merge, deploy, production read, or secret change
  occurred. Next safe unit is Stage 7.1 tenant foundations only, pending explicit approval.

- **2026-08-17 (Codex):** Phase 6 synthetic security assurance commit `be7d2ec` is pushed and
  stopped at findings review on `codex/phase6-security-assurance`. Added focused adversarial/secret/dependency gates and an
  ephemeral PostgreSQL migration CI stage; local backend assurance passed 136 checks (2 TODO
  findings), the full suite passed 886 with 6 skips, and all type/build/audit gates passed. The
  redacted `docs/SECURITY_PHASE6_ASSURANCE.md` records a high Canvas pagination bearer-leak risk,
  medium JWT replay gap, and medium route-rate-limit gap. No finding, production state, deployment,
  credential, or database was changed; hosted staging still needs proven isolated infrastructure.
  Dashboard assurance commit `bf9c948` is also pushed. Remote manual CI awaits GitHub CLI
  re-authentication; no PR was opened merely to trigger it.

- **2026-08-17 (Codex):** Completed security remediation Phase 2 as a single guarded,
  aggregate-only production inspection in a verified read-only PostgreSQL transaction. It found
  190 encrypted versus 926 plaintext protected field values, no malformed envelopes, no anomalies
  across 26 cross-workspace relationships, two unretained failed Study-analysis payloads, and
  confirmed blind-token accumulation. No production state changed. The redacted report and
  restart-safe Phase 3 design are in `docs/SECURITY_PHASE2_PRIVACY_INSPECTION.md`; Phase 3 remains
  unauthorized and is blocked on verified backup/PITR/restore readiness.

- **2026-08-17 (Codex):** Completed security remediation Phase 1. Backend runtime commit `5630f1e`
  authenticates and rotates the primary Telegram webhook with a dedicated Render-held secret,
  Telegram `secret_token`, pre-handler timing-safe validation, opaque rejection, and no route/URL
  logging. Production health reports the exact commit; Telegram registration is healthy; retired,
  missing-secret, and forged-secret probes return 404. TypeScript/build, zero-production-finding
  audit, 19 focused tests, and the sequential full suite (866 passed, 6 skipped) pass. Paired
  dashboard runtime `5bf0ab4` removes all four shipped high dependency findings. Phase 2 was later
  completed read-only; see `PROJECT_CONTEXT.md` and `docs/SECURITY_REMEDIATION_ROADMAP.md`.

- **2026-08-17 (Codex):** Recorded the planning-only security remediation sequence in
  `docs/SECURITY_REMEDIATION_ROADMAP.md` and linked it from `PROJECT_CONTEXT.md`. The roadmap
  preserves seven staged phases, safety/rollback/validation gates, staging-first penetration
  testing, bounded read-only production inspection, per-phase model/effort guidance, and an exact
  handoff checkpoint template. No remediation phase, product code, dependency, production state,
  database operation, credential rotation, deployment, or active test has started.

- **2026-08-17 (Codex, validated locally):** Upgraded canonical Study resources into portable
  Markdown notes with safe GFM/Mermaid rendering, wiki links/backlinks, restart-safe local drafts,
  bounded encrypted revisions, conflict-aware saves, `.md` import/export, and a readable Telegram
  fallback. Raw HTML/plugins/scripts remain unsupported. Prisma format/validate/generate, backend
  typecheck/build, 861 tests plus 6 skips, dashboard TypeScript/ESLint/build, and 91 tests pass.
  A final backend rerun after atomic conflict hardening reached 860 passes plus 6 skips with the known
  unrelated concurrent Excel timeout; that test passed 2/2 independently. Backend commit `13b2431`
  is live on Render with its additive migration and HTTP 200; dashboard commit `14b691b` has a
  successful Vercel deployment and the canonical dashboard returns HTTP 200.

- **2026-08-16 (Codex, deployed):** Audited the production Study-analysis configuration without
  reading secret values. Render currently has `OPENAI_MODEL` but no `OPENAI_API_KEY`, so the existing
  fail-closed OpenAI adapter correctly reports analysis unavailable; this is a deployment-secret
  omission, not an integration defect. The user's conditional Gemini migration is therefore not
  activated. The paired dashboard repair passes 88 tests, TypeScript, ESLint, production build, and
  browser QA at normal and expanded CSS viewports. Dashboard runtime commit `d928ef9` is live on
  Vercel with HTTP 200; backend continuity commit `d8e9a8c` is live on Render with HTTP 200. Details
  are tracked in `PROJECT_CONTEXT.md` and the dashboard `CLAUDE.md`.

- **2026-08-14 (Codex):** Replaced Study module review's native
  Module/Review type selects with the existing Threadwise choice popover and keyboard/focus
  behavior, and fixed the Review Top three card's accidental implicit-row stretch. OpenAI Study
  failures now distinguish invalid credentials, quota/billing exhaustion, temporary rate limits,
  permissions, and outages while persisting/logging only safe status/code/type metadata. A bounded
  local probe returned 401 while the live failure was 429, so the local and deployed credentials
  are not equivalent; no secret was printed. Focused tests/typechecks pass; the full backend suite
  reached 856 pass + 6 skip with one unrelated concurrent Excel timeout that passes independently;
  build and Prisma generation pass. Backend code commit `d0957db` is live on Render with HTTP 200.
  Dashboard validation and deployment are recorded in its own `CLAUDE.md`.

- **2026-08-14 (Codex):** Implemented the approved correction: durable Study
  analysis now uses the deployed OpenAI configuration with its evidence/validation boundaries intact,
  and general Telegram albums now produce one leased, deduplicated, atomically saved batch with one
  shared caption. Backend commits `85f6812` and `3f0b12a` are live on Render; private, ordinary
  group, and Study albums retain their scoped durable batch paths. Details are in `PROJECT_CONTEXT.md`.

- **2026-08-13 (Codex):** Implemented Phase 5 locally: bounded Study evidence graph v2 with
  session/resource/work/Canvas provenance and timing, Connections/Quiz/Both modes, conservative
  pace reporting, evidence-gated misconception correction, and durable manually reviewed note-edit
  proposals with conflict-safe apply. No image bytes enter AI prompts; Canvas file/PDF bodies remain
  metadata-only. TypeScript, build, focused tests, and the full backend suite (849 passed, 6 skipped)
  pass. Backend commit `7ce3f4f` is live on Render with its additive migration applied and HTTP
  200 health. Provider execution remains fail-closed because `GEMINI_API_KEY` is absent in Render.

- **2026-08-13 (Codex):** Replaced Study module review's laptop-worker dependency with a bounded
  server-side Gemini API runner. Jobs remain opt-in, workspace-scoped, leased, restart-safe, and
  validated before persistence; one pass runs at a time and provider failures stay isolated.
  The secret never leaves the backend. TypeScript, build, 8 focused tests, and the full backend
  suite (848 passed, 6 skipped) pass. Backend commit `41fa0bb` is live on Render with HTTP 200;
  provider execution is fail-closed because the Gemini key is not yet present in Render.

- **2026-08-13 (Codex):** Implemented and locally validated durable task reminders and explicit
  group audiences. Exact times use leased, deduplicated, lifecycle-aware rows; automatic reminders
  now escalate toward deadlines; Everyone, Unassigned, and named-assignee behavior are distinct;
  repeated Telegram completions converge on one persisted control surface. Prisma, TypeScript,
  build, 842 backend tests (6 skipped), and desktop/mobile browser QA pass. Backend commit
  `3db35bf` is live on Render with the migration applied and HTTP 200 health.

- **2026-08-13 (Codex):** Implemented and locally validated the Canvas completeness phase:
  workspace-keyed serialized sync, restart-safe stale-run recovery, less restrictive active-course
  discovery, per-course skip diagnostics, and a bounded metadata-first module/page/file mirror.
  Canvas page text is hashed and bounded; file/PDF bodies are not downloaded during routine sync.
  Full backend tests pass 830 with 6 skips; Prisma, TypeScript, and production build pass.

- **2026-08-13 (Codex):** Implemented and locally validated Phase 1 of the approved roadmap
  in the dashboard: stable timetable dialog focus, body-level bounded sheets, uniform scrim,
  safe destination payloads and plain-language guidance, title-first compact blocks, and
  per-collision-group lane sizing. Dashboard tests pass 73/73; TypeScript, targeted lint,
  production build, detector, and bounded desktop/mobile browser QA pass. Push/deploy is next.

- **2026-08-13 (Codex):** Extended `PROJECT_CONTEXT.md` with future public-Study groundwork;
  no runtime code changed. Preserve the sealed founder instance, prepare a separately branded
  bot identity on the shared service, require per-user Canvas OAuth rather than pasted manual
  tokens, and keep all new AI/sync/reminder state tenant-scoped. Public activation remains
  explicitly deferred.

- **2026-08-13 (Codex):** Created tracked `PROJECT_CONTEXT.md` as the active,
  compaction-safe cross-repository implementation ledger; no product code changed. It records
  the user-confirmed server-side Gemini API direction, evidence-grounded review/quizzes,
  Canvas coverage work, durable multi-reminders, merged Telegram completion controls, and
  the supplied timetable defects. Update it before implementation, after each material
  checkpoint, and before an interrupted stop. Implementation awaits approval.

- **2026-08-13 (Codex):** Added an opt-in, evidence-backed Study module review through the
  existing private Gemini CLI worker. Completed non-archived module sessions gate eligibility;
  results are cached by evidence hash, cite known sessions/resources, remain readable offline,
  and cannot mutate deterministic Study state. Prisma generation, typecheck, focused tests, build,
  and sequential reruns of the full-suite timeout cases pass.

- **2026-08-12 (Codex):** Expanded Study Deep Work into structured, editable session records
  with focus structures, techniques, custom topics, exact timestamps, linked resources, and soft
  archival. The paired dashboard now keeps an active timer available across Study navigation instead
  of trapping the owner on a mostly empty completion screen. AI analysis remains deferred.

- **2026-08-12 (Codex):** Fixed the initial NUSMods timetable importer so it reconciles
  equivalent existing class blocks instead of layering duplicates. Class-like manual/default
  blocks are adopted, intentional study/protected blocks remain, and a migration cleans the
  exact duplicates already produced in production.

- **2026-08-11 (Codex):** Hardened the Study protected-media proxy for historical Telegram
  images with generic MIME metadata. Supported image formats are now identified from bounded bytes
  before delivery, while owner/group authorization, fresh file lookup, `no-store`, and credential
  isolation remain unchanged. The paired dashboard now uses image-first cards, optional captions,
  hidden-but-searchable OCR, and a metadata/action viewer.

- **2026-08-10 (Codex):** Recorded the Study Timetable inspection refinement delivered by the
  dashboard: frozen Day/Deadlines context, distinct today/current-time semantics, read-only block
  details before editing, and width-aware short-block rendering. Backend behavior and data contracts
  were intentionally unchanged.

- **2026-08-10 (Codex):** Added durable ten-minute Study capture context, intentional pending image capture with optional OCR, five-per-page module selection, source provenance, exact-once saving, and fresh/retry-bounded Telegram media delivery. The Study home now exposes six primary actions with secondary controls under More; documentation records the capture, image, and full-day timetable decisions.

- **2026-08-10 (Codex):** Hardened Study reliability across Telegram, Canvas, reminders, and the
  dashboard API. Active module selection is navigation-only; ambiguous captures now wait durably
  for an explicit module. Canvas discovery no longer reactivates archived data, inactive modules
  are excluded across every operational surface, and explicit restore/activate paths remain.
- **2026-08-10 (Codex):** Reconciled backend and dashboard documentation with backend v0.32.0
  and the latest interaction hierarchy. Current docs now describe immediate group assignment,
  unassigned claiming, exact dashboard continuation, Study Timetable/travel, and Beacon's
  Telegram-only role-adaptive control plane. Historical changelog/journal/test snapshots remain
  labelled as historical rather than rewritten.
- **2026-08-10 (Codex):** Implemented Beacon's progressive-disclosure control plane. Public
  members now see only Rules and How to report; owner/moderator private homes, report actions,
  trigger submissions, offence lookup, and destructive confirmations are role-appropriate and
  re-authorized against stale/crafted callbacks. Complete backend gate: 97 files, 786 passed,
  6 intentional skips, Prisma validation/generation, typecheck, and isolated production emit.
- **2026-08-09 (Codex):** Simplified Threadwise group interactions around `One message, one
  decision`, exact dashboard deep links, immediate assignments, race-safe unassigned claiming,
  and creator/admin-only reassignment. Legacy accept/decline/block/handoff inputs now explain the
  current model without mutating state.

- **2026-08-06 (Claude):** Added a "Possible future additions" section to `docs/BEACON.md`:
  a dedicated moderator group (deferred until the community is bigger than volunteer-worthy)
  and a member-queryable rules/scholarship-info flow (bot answers privately, deletes the
  member's question, keeps repeat Q&A out of the group log — deferred until the pinned
  announcement is observed to be insufficient). Neither is scheduled or implemented.
- **2026-08-06 (Claude):** Reviewed both repos for continuity ("could a new AI continue if one
  tool went away?"). Verdict: code + all reasoning are in git and portable; Claude's memory was
  empty (nothing trapped). Created canonical `CLAUDE.md` in both repos + `AGENTS.md` pointers;
  refreshed the stale `.codex/PROJECT_CONTEXT.md` (was v0.17.1, git-excluded). Seeded Claude's
  project memory. **Open item for the owner:** back up the non-rotatable secrets in a password
  manager — `GOOGLE_TOKEN_ENCRYPTION_KEY`, `MICROSOFT_TOKEN_ENCRYPTION_KEY`, and the Ed25519
  `DASHBOARD_API_PRIVATE_KEY` (losing these orphans stored user data). No code/behavior changes.
