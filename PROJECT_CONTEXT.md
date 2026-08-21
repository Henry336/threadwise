# Threadwise active implementation context

This tracked file is the compaction-safe ledger for active cross-repository work. The
backend and dashboard `CLAUDE.md` files remain the canonical general contributor guides;
this file records the current objective, decisions, evidence, and interruption state.

Update this file at the start of an implementation, after each material checkpoint, and
before stopping. Never store secrets, tokens, embedded images, or large tool output here.

## Active checkpoint — personal Overview quote library (2026-08-21 SGT)

- Objective: let a user add and remove personal inspirational quotations from dashboard Settings;
  those quotations join the deterministic daily line beneath the personal Overview greeting.
- Product decision: use the dashboard rather than Telegram for management because quote text,
  optional attribution, preview, duplicate feedback, and removal are clearer in one persistent form.
  The existing built-in rotation remains available, and the owner-provided Jim Rohn and Henry
  Bergson quotations join that built-in set.
- Data boundary: add a bounded JSON quote list to `UserSettings`; accept at most 40 unique entries,
  with 280 characters of text and an optional 120-character author. Normalize whitespace and
  duplicates at the authenticated API boundary. Only a personal workspace may update the list.
- UI boundary: extend the existing General settings form using current Threadwise tokens and
  controls. Preserve keyboard access, responsive layout, explicit Save behavior, and deterministic
  same-day rotation. Do not introduce a second settings system or a bot command in this slice.
- Validation and release: add migration, schema/data/snapshot/route regressions, quote-selection
  tests, settings interaction coverage, typecheck/lint/build, secret scans, and Prisma validation.
  Update both contributor logs after validation, then commit/push and release the paired stack.
- Validation evidence: focused quote/API/UI tests pass; backend typecheck, build, Prisma validation,
  secret scan, 140 security checks, and the complete single-worker suite (909 passed, 6 skipped)
  pass. Dashboard typecheck, lint, production build, secret scan, 52 security checks, all 125 tests,
  and desktop/mobile browser QA pass. Both production and complete dependency audits report zero
  vulnerabilities. One unrelated concurrent Windows file-courier timeout passed independently and
  in the complete single-worker suite.
- Release evidence: backend runtime commit `3860db813a34a23d0000bf32234f160c90a25984`
  is live in Render deployment `dep-da43kkbbc2fs7395ht60`; public `/health` returns HTTP 200
  with commit `3860db813a34`. Render's required pre-deploy migration command completed before the
  deployment became live. Dashboard runtime commit
  `fc2cf64` completed its Vercel production deployment successfully.
- Interruption state: implementation, validation, backend-first release, and dashboard release are
  complete. Only documentation-only release-record commits and final repository checks remain.

## Active checkpoint — full guarded-stack production release completed (2026-08-18 SGT)

- Authorization: the owner explicitly authorized releasing the complete currently guarded backend
  and dashboard stack to production, including merging and deployment after required safety gates.
- Released revisions: backend PR #17 merged as `0699835d8ffe2132e8ce29dd03496d8fada71538`;
  dashboard PR #2 merged as `b00a3d15660a5714852a7a4096387f6995127845`.
- Release boundary: do not ship the known Phase 6 F-01 Canvas bearer-forwarding flaw. Remediate and
  validate F-01 through F-03 before merge. Do not apply the additive Phase 3/4 production migrations
  until Gate 3A proves a current backup/PITR reference, an isolated restore, and independent recovery
  of every production encryption key needed by retained ciphertext. Never print or commit secrets.
- Release sequence: reconcile with `main`; close F-01 through F-03; run full local and remote CI plus
  ephemeral PostgreSQL migration validation; prove Gate 3A; merge both repositories; allow/trigger
  Render and Vercel production releases; verify health, release commits, migrations, and key product
  flows; then update this ledger and both tracked contributor logs.
- Rollback: the additive schema/runtime release is active. Application rollback uses the prior
  known-good Render/Vercel releases; database recovery must follow the Phase 3/4 runbooks and the
  verified Gate 3A backup rather than destructive ad-hoc SQL.
- Current status: release preflight is complete and F-01/F-02/F-03 are active in production. Canvas pagination
  and material URLs are now constrained to the exact configured origin/API path before credentials
  are attached, URL credentials are rejected, and automatic redirects are disabled. The hostile
  URL/redirect regressions and existing Canvas utilities pass. Dashboard mutation JWT identifiers
  are now atomically consumed in a shared PostgreSQL table using hashed token/principal fingerprints;
  safe reads remain retryable, replayed mutations fail before their side effect, and expired rows are
  sampled for indexed cleanup. F-03 now uses shared PostgreSQL fixed-window buckets with hashed
  principals: authenticated dashboard routes have read/write/expensive/stream budgets, Telegram
  webhooks are limited by verified actor only after secret validation, and remaining
  admin/worker/OAuth HTTP ingress has independent IP/route-class budgets. Rate-limit responses are
  bounded `429` replies with `Retry-After`. The live npm advisory gate then identified
  `GHSA-ggr8-5vv4-36mx` in Prisma's transitive `deepmerge-ts` 7.x; a narrow 8.0.0 override is
  compatible with the current Prisma 6.19.3 config surface and now yields zero production and
  complete audit findings. Complete backend tests (907 passed, 6 skipped), Prisma
  validate/generate, typecheck, build, secret scan, and 140 security-assurance tests pass.
  Complete dashboard tests (122), typecheck, lint, production build, secret scan, 52 security
  tests, and Playwright (5 passed, 1 intentional mobile skip) pass. GitHub-hosted release gates
  also pass on both PRs, including the backend's isolated PostgreSQL 17
  migration job and the dashboard's separate validate/browser jobs plus Vercel preview. Dashboard
  CI initially discovered its Playwright spec through Vitest on Linux; `f181ad8` now explicitly
  separates those suites and the rerun is green. Gate 3A passed on 2026-08-18 SGT using a fresh
  encrypted logical production backup and an isolated local PostgreSQL restore. All 95 public
  tables and 21,563 rows matched exactly; the four pending release migrations applied cleanly, and
  the only post-migration count delta was the expected Prisma history change from 56 to 60. The
  encrypted archive is retained under the ignored `backups/` directory by SHA-256 reference; all
  plaintext/decrypted dumps and temporary local databases were removed. The owner confirmed
  independent recovery of the exact production content-encryption key without exposing it.
  Canonical non-secret evidence is in `docs/GATE3A_RECOVERY_EVIDENCE.md`. The backend and dashboard
  PRs were then merged in that order. Render reports HTTP 200 at backend commit `0699835d8ffe`;
  the production database reports 60 completed migrations and the new privacy, replay-protection,
  and shared-rate-limit tables. Vercel completed deployment of dashboard merge `b00a3d15660a`, and
  the canonical demo dashboard returned HTTP 200. Exact next operator action: rotate the historical
  Canvas access token because the pre-release F-01 behavior may previously have exposed it to an
  untrusted pagination/material URL. Do not run destructive privacy backfill or retention work as
  part of that rotation.

## Active checkpoint — theme-aware Study scrollbars (2026-08-18 SGT)

- Status: implementation, validation, and push are complete on the existing
  `codex/study-image-sidebar-coursemology` branches. The scrollbar dashboard commit is `29748a4`
  and the paired continuity checkpoint is `d243ac2`.
  This is a narrow visual refinement; no merge, deployment, production mutation, provider work,
  database operation, or credential change is authorized.
- Objective: replace the browser-default desktop scrollbar presentation in the Study sidebar
  navigation and horizontal timetable with restrained Threadwise-styled tracks/thumbs that remain
  legible in light and dark themes. Preserve native scrolling, keyboard behavior, overflow sizing,
  mobile's hidden drawer scrollbar, and every unrelated overflow surface.
- Validation: focused Study regressions pass 11 tests; the full suite passes 122 tests; typecheck,
  lint, production build, tracked-secret scan, design JSON parsing, and Playwright pass (5 passed,
  one intentional mobile skip). The required Impeccable detector found only two unrelated,
  pre-existing side-border warnings at stylesheet lines 575 and 822; this scoped change did not
  alter them.
- Exact next action: wait for owner live review. Do not merge or deploy without a new explicit
  instruction.

## Active checkpoint — Study image inspection, desktop sidebar, and Coursemology research (2026-08-17 SGT)

- Status: implementation, local validation, and push are complete on matching
  `codex/study-image-sidebar-coursemology` branches, stacked from the pushed post-Phase-7 guarded
  heads (backend `eb8406b`, dashboard `f604a21`). No merge, deployment, production mutation,
  credential collection, provider connection, database operation, or public Study activation is
  authorized in this checkpoint. Dashboard implementation commit is `7a768a7`; backend research
  and continuity commit is `557fbae`.
- Objective: let Study users click a saved Library image into a full-viewport, natural-resolution
  scrollable inspection mode; add an explicit persisted desktop/laptop sidebar toggle while
  retaining the existing mobile drawer; and determine whether Coursemology can safely provide
  assignment/deadline data without browser-token or cookie scraping.
- Decisions: image viewing defaults to fit-to-window and toggles between fit and original-pixel
  inspection from either the image or a labelled header action. `Escape` exits original-size mode
  before closing the viewer. The desktop sidebar choice is local UI preference only and never
  changes mobile drawer behavior. Coursemology remains research-only pending a supported read-only
  OAuth/export contract from the instance operator; do not collect credentials.
- Durable research: `docs/COURSEMOLOGY_INTEGRATION_RESEARCH.md` records evidence, safe integration
  options, a provider-neutral connector shape, and the operator-confirmation gate.
- Validation: dashboard focused regressions pass 10 tests; the full suite passes 121 tests;
  typecheck, lint, production build, tracked-secret scan, production/full dependency audits, and
  Playwright pass (5 passed, one intentional mobile skip). The generic browser suite does not seed a
  private Study Library image, so the exact signed-in image interaction remains an owner live-check
  after branch deployment; source regressions cover its state and natural-resolution CSS contract.
- Exact next action: wait for owner live review of the pushed dashboard branch. Do not merge, deploy,
  or begin a Coursemology connector without a new explicit instruction.

## Completed checkpoint — post-Phase-7 Work selector fix and final audit (2026-08-17 SGT)

- Status: implementation and audit are complete on matching
  `codex/post-phase7-work-filter-audit` branches from Phase 7 heads (backend `06b9146`, dashboard
  `45864dc`). The Study **Work** module filter now uses the accessible `StudyChoicePicker`, retains
  persisted `all`/module semantics, and has a focused regression guard. No merge, deployment,
  production mutation, credential change, database operation, or public Study activation occurred.
- Audit result: the guarded seven-phase codebase is materially safer and more testable with no
  confirmed cycle-caused regression. Production has not inherited most Phase 3–7 changes. Phase 6
  F-01 (Canvas cross-origin bearer forwarding), F-02 (dashboard JWT replay), and F-03 (no shared
  principal/route rate limit) remain unresolved; Phase 3/4 production activation remains blocked at
  Gate 3A; CSP enforcement and hosted synthetic staging remain incomplete. Canonical detail is in
  `docs/POST_PHASE7_CODEBASE_AUDIT.md`.
- Audit safety: read local repositories and redacted reports only; do not inspect private production
  rows or secrets, run active production penetration tests, rotate credentials, provision staging,
  or silently remediate audit findings. The explicitly requested Work selector is the only approved
  product-code correction in this checkpoint.
- Validation: dashboard 119 tests, focused selector 8 tests, security assurance 52 tests, Playwright
  5 passed/1 intentional skip, typecheck/lint/build, tracked-secret scan, and both dependency audits
  pass. Backend deterministic rerun passes 886 tests with 6 skips/2 explicit TODOs; focused security
  assurance passes 136 tests with 2 TODOs; typecheck/build/Prisma/secret/dependency gates pass. One
  first-run concurrent Excel failure passed independently and in the one-worker full rerun.
- Exact next action: commit and push both guarded branches, then wait for owner review. Do not merge,
  deploy, activate migrations/CSP/public Study, rotate credentials, or remediate F-01–F-03 without a
  new explicit instruction.

## Completed checkpoint — Phase 7 public Study architecture (2026-08-17 SGT)

- Status: the user explicitly authorized Phase 7 and the architecture package is complete on
  `codex/phase7-public-study-architecture`, stacked from the pushed Phase 6 assurance
  checkpoints (backend `c5b0726`, dashboard `638b10d`). Canonical backend architecture commit is
  `77739bd`; the dashboard boundary commit is `16687b3`. No production, database, schema,
  credential, bot, provider, invitation, merge, or deployment state changed.
- Objective: produce an implementation-ready public Study architecture covering tenant-scoped
  identity, ownership, membership and authorization; encrypted per-tenant Canvas credentials;
  an isolated Study bot identity; tenant-scoped jobs, quotas, leases, rate limits, abuse controls,
  audit, export and deletion; a privacy/threat model; and a staged cohort rollout.
- Invariants: preserve the sealed founder Study workspace and its fail-closed owner/chat gate;
  do not relax singleton checks as a shortcut, expose or rotate any secret, create the public bot,
  migrate data, deploy, merge, or claim general-availability readiness. Server-side AI and Canvas
  processing require deliberate plaintext-in-memory trust boundaries and must not be mislabeled as
  end-to-end encryption.
- Dependency gates: Phase 6 findings F-01 (Canvas cross-origin bearer forwarding), F-02 (dashboard
  JWT replay), and F-03 (principal/route rate limiting) remain unresolved and must be remediated
  before a public cohort. Hosted synthetic staging also remains blocked on an isolated database and
  synthetic credential set. Phase 3/4 production activation still inherits Gate 3A.
- Deliverables: `docs/PUBLIC_STUDY_ARCHITECTURE.md`,
  `docs/PUBLIC_STUDY_THREAT_MODEL.md`, `docs/PUBLIC_STUDY_ROLLOUT.md`, and dashboard
  `docs/PUBLIC_STUDY_DASHBOARD_BOUNDARY.md`, plus linked architecture/roadmap and both contributor
  logs. This is a design phase; its proposed schema/API examples are not migrations or runtime
  implementation.
- Validation: decisions were traced to the current Prisma schema, singleton Study services,
  bot registration, Canvas/reminder/analysis jobs, backend authorization, and dashboard BFF.
  Requirement coverage, code-fence parity, local links, prohibited embedded payloads/secret
  material, `git diff --check`, exact branch/status, and the final committed file sets were checked.
  No runtime test/build was warranted because Phase 7 changed documentation only.
- Rollback: revert or delete only the Phase 7 documentation commits/branches. The Phase 6 branches
  remain the immutable baselines; no runtime rollback or data restore should be necessary.
- Recommended setup: GPT-5.6 Sol with high reasoning for tenant, authorization, credential and threat
  boundaries. xhigh/Ultra are not required because the phase is bounded and produces reviewable
  architecture rather than an irreversible migration.
- Exact next action: wait for explicit approval. The first bounded implementation unit is Stage 7.1
  tenant foundations only: additive workspace lifecycle/membership/capability/audit foundations
  behind disabled flags plus founder authorization shadow tests. Do not combine it with Canvas
  OAuth, a public bot, invitations, production migration/backfill, founder cutover, merge, or
  deployment. Phase 6 F-01–F-03 remediation remains a separate approval boundary and is required
  before any cohort.

## Active checkpoint — Phase 6 synthetic security assurance (2026-08-17 SGT)

- Status: the user explicitly authorized Phase 6. Work is isolated on stacked branches
  `codex/phase6-security-assurance` from backend Phase 5 commit `a440c0b` and dashboard
  Phase 5 commit `9d47b57`; production and the Phase 3 activation gate remain untouched.
- Objective: exercise the recorded threat matrix with synthetic identities, chats,
  workspaces, provider responses, credentials, and bounded hostile inputs; make the
  checks reproducible in CI; publish a redacted evidence report; and present any
  security findings before changing the affected security behavior.
- Safety boundary: do not read or mutate private production data, reuse production
  credentials in staging, invoke real providers with abusive payloads, run destructive
  account deletion or forged bot mutations in production, deploy or merge to `main`,
  or perform Phase 7 public-Study architecture work. Safe production header/config
  verification still requires separate explicit approval.
- Environment checkpoint: this laptop has Node/npx but no Docker, Render CLI, or
  installed Render connector. No dedicated synthetic hosted database or staging secret
  set is present in the repositories. Phase 6 therefore starts with a deterministic
  in-process synthetic assurance harness and CI gates. A hosted deployment may proceed
  only if a genuinely isolated non-production database and credentials can be proven;
  it must never fall back to production configuration.
- Required coverage: Telegram webhook authenticity/replay/malformed behavior;
  authentication, authorization, membership, and IDOR boundaries; dashboard JWT,
  workspace, proxy, origin/CSRF, and payload limits; Markdown/Mermaid XSS and resource
  limits; SSRF surfaces; rate/lease/duplicate/concurrency/recovery behavior; and secret,
  dependency, and static analysis gates.
- Validation and reporting: run focused hostile-input tests, full backend/dashboard test
  gates, TypeScript/build/lint/browser checks where applicable, dependency and secret
  scans, and a diff/secret review. Record passing evidence, limitations, residual risks,
  and any blocked hosted-staging work in a dedicated Phase 6 report.
- Rollback: revert or discard only the two Phase 6 branches. The Phase 5 branches remain
  the immutable baselines; no database migration, hosted configuration mutation, or
  production deployment is part of this phase.
- Findings checkpoint: local synthetic assurance and the new CI gates pass. Phase 6 is
  stopped before remediation with three review items documented in
  `docs/SECURITY_PHASE6_ASSURANCE.md`: Canvas pagination can forward its bearer token to a
  cross-origin next link (F-01, high); dashboard service JWT JTIs are not replay-consumed
  (F-02, medium); and the HTTP API has no principal/route rate-limit gate (F-03, medium
  availability/cost gap). Do not fix or dismiss these without the user's review.
- Validation checkpoint: backend focused assurance 136 passed with two explicit TODOs;
  backend full suite 886 passed, 6 skipped, 2 TODO; dashboard focused assurance 52 passed;
  dashboard full suite 118 passed; Chromium 5 passed with one intentional mobile skip;
  both secret scans and both complete/production dependency audits passed with zero
  findings; TypeScript/build/Prisma and dashboard lint/build passed.
- Exact next action: present F-01 through F-03, wait for explicit remediation approval, and
  run the pushed synthetic PostgreSQL workflow after GitHub CLI re-authentication or through a
  reviewed pull request. Hosted staging, token rotation, safe production checks, merge, and
  deployment remain separate approval boundaries.
- Publication checkpoint: backend assurance commit `be7d2ec` and dashboard assurance commit
  `bf9c948` are pushed on their respective `codex/phase6-security-assurance` branches. No pull
  request, merge, or deployment was created. The workflows expose manual dispatch, but the local
  GitHub CLI credential is expired; therefore the remote ephemeral PostgreSQL stage is still
  awaiting a user-authenticated dispatch or pull request and must not be reported as passed.

## Completed checkpoint — Phase 5 browser hardening and maintainability (2026-08-17 SGT)

- Status: implementation and local validation complete on guarded branches. The user explicitly authorized
  Phase 5 and publication where safe; Phase 6 active security assurance and Phase 7 public Study
  architecture remain unauthorized.
- Repository baselines: backend `da3992130b1112d0d2b813a47f63d605fe361325` on new stacked branch
  `codex/phase5-browser-hardening`; dashboard `c560351d92b98316d555a259d66009dbbe1523c2`
  on its own `codex/phase5-browser-hardening` branch. Both baselines were clean and matched their
  remotes. Dashboard work is isolated in the writable linked worktree
  `D:\CodexData\WindowsDocuments\Codex\Threadwise\.local\phase5-dashboard`.
- Authorized scope: staged nonce-based CSP without `unsafe-inline`/`unsafe-eval`; expiring and
  identity/workspace-scoped local note drafts with logout/workspace cleanup; an explicit safe
  remote-Markdown-image policy; bounded/deferred Mermaid rendering with safe failures; dashboard
  pull-request/main CI with reproducible install, tests, lint, typecheck, build, dependency audit,
  and secret scanning; meaningful behavior/browser coverage; one bounded responsibility split where
  it reduces risk; and reconciliation of retired local-worker documentation with the server-side
  OpenAI implementation.
- Invariants: preserve safe GFM notes, same-origin protected images, crash-safe drafts, authenticated
  BFF authorization, Study owner/chat fail-closed behavior, PWA static-only caching, and production
  functionality. Do not weaken CSP with broad inline/eval allowances, render raw HTML, load arbitrary
  remote media automatically, expose secrets, inspect private production data, run active attacks,
  deploy, or mutate production configuration in this phase.
- Validation gate: focused CSP/draft/Markdown/Mermaid/auth/focus/scroll/responsive behavior tests;
  full dashboard tests, TypeScript, ESLint, production build, production dependency audit, CI syntax,
  diff/secret review, and clean pushed branches. Backend documentation changes receive the backend
  full gate. Deployment remains separate from branch publication.
- Rollback: all runtime changes stay on the dashboard Phase 5 branch and all cross-repository
  documentation stays on the stacked backend Phase 5 branch. Reverting either branch leaves current
  production untouched. No migration or destructive cleanup is planned.
- Recommended execution setup recorded by the roadmap: Terra medium for CI/tests/docs/mechanical
  refactors and Sol medium for CSP design or responsibility splits; high/xhigh/Ultra are not needed.
- Implementation checkpoint: the dashboard now has a request nonce CSP staged in report-only mode
  by default (`THREADWISE_CSP_MODE=enforce` is the explicit later activation switch), with no
  `unsafe-inline` or `unsafe-eval`; the Telegram bootstrap receives the request nonce. Study note
  and weekly-review drafts use versioned seven-day envelopes scoped to their owner/tenant/resource,
  invalid or expired records fail closed, prior-workspace and legacy drafts are cleared on the next
  workspace mount, and logout clears all Threadwise drafts before submission.
- Markdown media checkpoint: same-origin images continue to load; arbitrary HTTPS images now require
  a per-render explicit click that warns about the destination host/IP disclosure; insecure,
  protocol-relative, and embedded `data:` image payloads are blocked. Mermaid rendering moved to a
  dedicated component, is deferred until near the viewport, rejects configuration directives and
  diagrams over character/line/statement budgets, renders through a serialized queue with a timeout,
  and still sanitizes the strict-security SVG with DOMPurify.
- Final implementation: the dashboard also has pull-request/main CI with least-privilege workflow
  permissions, reproducible install, secret scanning, full and production dependency audits, unit,
  type, lint, build, and real Chromium desktop/mobile gates. Risky Markdown media and Mermaid work
  moved out of the generic Markdown renderer into bounded components. Provider documentation now
  names the deployed Study analysis path as server-side OpenAI; the historical/local Gemini Ideas
  adapter is not presented as a required laptop worker.
- Final validation: dashboard secret scan passed across 144 tracked files; 24 test files and all 99
  tests passed; TypeScript, ESLint, and the production build passed; Playwright passed five desktop/
  mobile smoke tests with one intentional mobile-only command-palette skip; full and production npm
  audits reported zero vulnerabilities. Backend documentation received the full gate: 117 files,
  884 tests passed with 6 intentional skips, TypeScript and build passed, and both dependency audits
  are clean after a non-breaking development-only `nanoid` lockfile refresh.
- Activation boundary: CSP remains report-only by design. Report-only browser evidence identifies
  framework/component inline style attributes that must be migrated before enforcement. Do not set
  `THREADWISE_CSP_MODE=enforce` until the inventory and rollout steps in the dashboard
  `docs/CSP_ROLLOUT.md` pass in a preview environment. Production, databases, migrations, and hosted
  configuration remain untouched. Phase 6 and Phase 7 remain unauthorized.

## Active checkpoint — Phase 4 Study scalability and transactional reliability authorized (2026-08-17 SGT)

- The user explicitly authorized Phase 4 implementation and publication where safe. Scope is the
  recorded Phase 4 only: bounded Study evidence/list payloads, precomputed encrypted excerpts,
  explicit query/payload/revision budgets, atomic note mutation side effects, indexed incremental
  wiki-link resolution, and synthetic scale/concurrency regression coverage. Phase 5 and later are
  not authorized.
- Dependency boundary: Phase 3 is validated but remains on the non-production
  `codex/phase3-privacy-remediation` branch because Gate 3A is unresolved. Phase 4 therefore starts
  from Phase 3 commit `14e8466183d1773b493165a6384f6279a007550f` and must publish on a separate
  stacked non-production branch. Do not merge, deploy, or apply either migration merely because
  Phase 4 code passes. Production remains unchanged until the Phase 3 backup/restore/key gate.
- Design decisions: store encrypted, bounded analysis excerpts rather than hydrating full resource
  and Canvas bodies for evidence; keep the existing dedicated full-resource endpoint for explicit
  detail; list at most 30 resource previews per paginated request and cap the compatibility snapshot
  at 400 records with each preview text field capped at 700 characters rather than 400 full bodies;
  keep evidence caps at 20 sessions, 28
  resources, 16 work items, 28 Canvas materials, and 16 assignments; retain a 48,000-character AI
  prompt ceiling; and cap revision history at 20 full snapshots of at most the existing 100,000
  body characters while skipping consecutive duplicates.
- Transaction invariant: a Study note create/update or accepted AI edit must commit the current
  resource, revision, outgoing links, and audit record in one database transaction. Optimistic
  concurrency remains fail-closed. Link resolution must query indexed normalized lookup keys for
  only the targets present in the changed note instead of scanning every active note.
- Expected surfaces: additive Study resource/Canvas excerpt and wiki-key schema migration;
  encryption policy and excerpt derivation; Canvas/Study persistence; evidence and dashboard
  preview queries; transaction-aware Markdown/revision/link services; guarded backfill tooling;
  focused contract, atomicity, concurrency, and synthetic scale tests; roadmap/context/runbook and
  working-log documentation.
- Validation: Prisma validate/format/generate, TypeScript/build, focused and full tests, synthetic
  large-workspace payload/query-budget checks, concurrent edit behavior, production dependency
  audit, diff/secret review, and clean pushed branch. No production database inspection, write,
  migration apply, deployment, or load test is authorized in this phase.
- Implementation checkpoint: the additive schema, encrypted/readiness-marked resource and Canvas
  excerpts, bounded preview/evidence queries, tenant-scoped pre-backfill compatibility fallback,
  guarded restart-safe backfill, indexed wiki targets, 20-snapshot revision policy, and atomic
  resource/revision/link/audit writes are implemented. Focused validation currently passes, including
  legacy readability and a 10,000-record synthetic derivation budget. The durable activation and
  rollback sequence is in `docs/PHASE4_STUDY_SCALE_RUNBOOK.md`.
- Publication boundary: publish only `codex/phase4-study-scalability`, stacked on Phase 3 commit
  `14e8466183d1773b493165a6384f6279a007550f`. Do not merge or deploy it and do not apply
  `20260817190000_phase4_study_scalability` or the Phase 4 backfill while Gate 3A remains unresolved.
  The dashboard contract remains backward-compatible, so no dashboard code change is required.
- Final local gate: Prisma validate and format check, Prisma generation, TypeScript, build, and all
  117 test files pass (884 tests passed; 6 intentionally skipped). The production dependency audit
  reports zero vulnerabilities. Diff/secret review found no added credential; the only matched API
  key text is the pre-existing documentation placeholder `OPENAI_API_KEY=...`. No production data,
  configuration, deployment, migration, backfill, or live load test was touched.
- Phase 4 implementation commit: `90db323` (`harden Study scaling and note transactions`). This
  commit is the reviewed code/schema/test/runbook checkpoint. The next action is publication of this
  stacked branch only; operational activation still waits for Gate 3A and the Phase 4 runbook.

## Active checkpoint — Phase 3 privacy remediation authorized (2026-08-17 SGT)

- The user explicitly authorized security remediation Phase 3 and publication where safe. Scope is
  the approved Phase 3 design only: encrypted/minimized AI payloads, exact blind-index replacement,
  bounded retention, restart-safe dry-run-first backfill/cleanup tooling, tests, schema additions,
  and operator documentation. Phase 4 and later remain unauthorized.
- The retention defaults in the Phase 2 report are treated as the selected implementation policy:
  failed/abandoned jobs 14 days; completed prompt/evidence diagnostics 7 days; superseded completed
  results 30 days while preserving the latest successful result per workspace/module/mode; pending
  suggestions until reviewed/superseded; applied/dismissed/superseded suggestions 30 days.
- Safety boundary: local implementation and synthetic validation may proceed. No production
  backfill, plaintext redaction, retention deletion, or irreversible migration apply may run until
  Gate 3A proves a current backup, isolated restore, and independent encryption-key recovery. The
  absence of Supabase control-plane access or owner confirmation must remain a reported blocker,
  not be guessed around. An additive schema migration must not be pushed to an auto-deploying
  production branch before that gate is resolved.
- Invariants: existing mixed plaintext/ciphertext reads continue; new AI payloads never create
  plaintext duplicates; blind tokens are replaced from the complete current content; concurrent
  edits use compare-and-swap; every apply path requires explicit acknowledgement and verified
  backup reference; checkpoints/audits contain aggregates and safe codes only; no private content,
  keys, identifiers, or row payloads enter logs/docs/chat.
- Expected surfaces: `prisma/schema.prisma` and one additive migration; content-encryption policy;
  Study/Idea AI persistence; a bounded retention service; guarded backfill/cleanup scripts;
  focused encryption, retention, migration, and mixed-compatibility tests; encryption/runbook and
  security roadmap/context documentation. Dashboard behavior should remain contract-compatible.
- Validation: Prisma format/validate/generate, focused and full tests, TypeScript/build, production
  dependency audit, synthetic interruption/retry/tamper/mixed-state tests, dry runs with no writes,
  diff/secret scan, and explicit production-gate review. Rollback before legacy redaction uses the
  prior release/additive legacy fields; after any future redaction it requires the verified backup
  and preserved key.
- Starting backend head is `a1694b9e88741c5808649395bb3088a735891be1`, clean on `main` and
  matched to `origin/main`. Implementation checkpoint: additive AI ciphertext/diagnostic columns,
  encrypted Canvas extraction and suggestions, exact complete-record blind-token replacement,
  guarded restart-safe backfill, bounded retention/minimization, focused tests, and the operator
  runbook are implemented locally. Final local validation passes: Prisma validate/format/generate,
  TypeScript, production build, all 873 tests with 6 intentional skips, 15 focused privacy tests,
  diff whitespace review, and a production dependency audit with zero vulnerabilities. The guarded
  utilities were not pointed at production or run in apply mode. No production database,
  configuration, deployment, content, or retention state has changed. Publication target is the
  non-production `codex/phase3-privacy-remediation` branch; production merge/apply is deliberately
  withheld. Gate 3A remains blocked on verified backup, isolated restore, and independent key
  recovery.
- Publication checkpoint: commit `0804596` was pushed to
  `origin/codex/phase3-privacy-remediation`. It has not been merged into `main`, so the additive
  migration has not entered the production auto-deploy path. The next authorized action is Gate 3A
  evidence collection and review; do not run either apply utility or merge this branch before it.

## Active checkpoint — Phase 2 privacy inspection completed (2026-08-17 SGT)

- The user explicitly authorized Phase 2 after Phase 1 containment passed production validation.
  Scope is read-only production privacy/data inspection only. Phase 3 writes, migrations,
  encryption backfills, retention deletion, credential rotation, active penetration testing, and
  every later remediation phase remain unauthorized.
- Production-query invariants: use the existing controlled database connection only in process;
  run aggregate/select-only queries; never select, print, export, or persist private note/OCR/image
  text, prompts, evidence, results, tokens, credentials, ciphertext, blind-token values, user ids,
  Telegram ids, workspace ids, or row-level records. Report counts, bounded size/age buckets,
  minima/maxima/averages/percentiles, boolean configuration presence, and anomaly counts only.
- Inspection targets are exactly the roadmap list: encryption presence/effective mode and protected
  model coverage; AI job/suggestion volume, age, aggregate bytes, and retention state; blind-search
  token distributions; cross-workspace relationship anomaly counts; Study resource/OCR/snapshot/
  revision size distributions; and backup/PITR/restore-test readiness. Unknown or inaccessible
  control-plane facts must be labelled unknown rather than inferred from database contents.
- Deliverables: a tracked redacted inspection report plus Phase 3 remediation/backfill design,
  rollback requirements, and an explicit approval gate. Expected repository changes are continuity
  documentation, the Phase 2 report, and—only if it materially improves repeatability—a narrowly
  guarded aggregate-only inspection utility. No dashboard product/runtime change is expected.
- Validation: inspect every query projection for aggregate-only output; verify production session
  read-only mode where supported; confirm report contains no secret/private identifiers or content;
  run relevant static/test gates for any utility; diff/secret scan; commit and push documentation.
  Rollback is deletion/reversion of local report/utility changes because production data and
  configuration must remain untouched. Recommended execution remains Terra/medium collection with
  bounded high-attention threat/migration analysis; Ultra/max is not justified.
- Starting backend head was `17866aea74831a1bd29353ae13294c8082560af3`, clean on `main` and
  matched to `origin/main`. A single guarded production inspection completed inside a verified
  read-only PostgreSQL transaction. It found effective write-mode encryption with a valid key,
  190 encrypted versus 926 plaintext protected field values, zero malformed envelopes, zero
  anomalies across 26 cross-workspace relationships, two failed/unretained Study analysis jobs,
  and confirmed blind-token accumulation (including one Study resource with 1,960 duplicate token
  entries). No production state or configuration changed.
- The redacted evidence, measured storage, backup/PITR unknowns, restart-safe backfill design,
  retention proposal, rollback rules, and explicit Phase 3 gate are in
  `docs/SECURITY_PHASE2_PRIVACY_INSPECTION.md`. Phase 3 and all production writes remain
  unauthorized. First prerequisite if Phase 3 is later approved: verify a current provider backup,
  perform an isolated restore test, and confirm independent key recovery before any apply/delete.

## Active checkpoint — Phase 1 security containment authorized (2026-08-17 SGT)

- The user explicitly authorized Phase 1 implementation and publication. Scope is limited to
  Phase 1A (authenticate and rotate the primary Telegram webhook) and Phase 1B (patch the four
  known high-severity dashboard production dependency advisories). Phase 2 production privacy/data
  inspection and every later phase remain unauthorized and must not start in this pass.
- Starting release heads are backend `9856f0d3019caca4d0fe584ac3196f136357545d` and dashboard
  `bc949f19f8d85c26c66c5a9c9bbd322caa818609`; both `main` worktrees were clean and matched
  `origin/main` before Phase 1 edits.
- Phase 1A invariants: a dedicated server-side Telegram secret (never documented or logged), a
  rotated non-secret route, constant-time secret-header validation before grammY receives an
  update, fail-closed production webhook startup, unchanged polling behavior, and independent
  Beacon authentication. Expected surfaces are environment validation/examples, Render service
  configuration, Telegram registration/startup, Fastify route authentication, focused tests, and
  deployment documentation. Roll back by restoring the prior backend release and its prior webhook
  configuration only if the new authenticated registration cannot pass legitimate Telegram traffic.
- Phase 1B invariants: make the smallest compatible Next.js/transitive production patch supported
  by current advisories, preserve React/application behavior, avoid unrelated package upgrades,
  and require a clean production audit plus focused/full tests, TypeScript, ESLint, and production
  build. Roll back as one dashboard dependency/lockfile commit if framework regressions appear.
- Reasoning policy for this execution follows the recorded plan: authentication receives the
  bounded high-attention review it warrants; dependency patching remains mechanical and scoped.
  No credential value, production data, repository content unrelated to Phase 1, or poisoned-task
  artifact may enter the implementation or its audit trail.
- Phase 1A implementation checkpoint: production webhook mode now requires a dedicated 32–256
  character Telegram-compatible secret; registration sends it as `secret_token`; the shared
  Fastify boundary validates the resulting header with a fixed-length SHA-256/timing-safe compare
  before invoking either bot handler; and the primary route rotates from `/telegram/webhook` to
  `/telegram/threadwise-v2`. Webhook URLs/routes were removed from runtime logs. Beacon remains a
  separate path/secret and now shares the same reviewed guard without changing its identity.
- Production configuration checkpoint: a new 64-character random secret was generated in memory
  and stored directly on the exact Render `threadwise` service, and the route variable was updated
  to `/telegram/threadwise-v2`. No secret value was printed, persisted locally, or documented.
  Render confirms both settings; its environment update endpoint does not deploy automatically, so
  production still runs the prior release until the reviewed backend commit is pushed.
- Phase 1A local gate so far: missing, malformed, invalid, and valid-header tests plus retired-route
  rejection pass 5/5; backend TypeScript and build pass. Full-suite and production Telegram/health
  verification remain pending.
- Phase 1B implementation checkpoint: dashboard Next.js and its matching ESLint config move only
  from `16.2.10` to the stable `16.2.12` patch. The vulnerable shipped transitive paths are pinned
  to Nano ID `3.3.18`, PostCSS `8.5.26`, and Sharp `0.35.3`; no other installed package version
  changed outside Next.js/Sharp platform artifacts. The production audit moved from four high
  findings to zero findings, and focused proxy/access/schema tests pass 35/35. A full audit still
  reports two development-only parser/glob advisories (`brace-expansion` and `js-yaml`); they are
  not in the shipped dependency graph and are intentionally not forced across incompatible ranges
  during this production patch. Full dashboard gates and deployment remain pending.
- Phase 1 completion checkpoint: backend runtime commit `5630f1e` is live on Render. `/health`
  returned HTTP 200 with that exact commit; Telegram reports the rotated route registered, zero
  pending updates, the intended allowed-update set, and no last webhook error. Bounded external
  probes confirmed the retired route plus missing and invalid secret headers all return opaque 404s.
  The dedicated secret remains only in Render and Telegram's registration; its value was never
  printed, copied locally, committed, or written to documentation.
- Dashboard runtime commit `5bf0ab4` is deployed successfully by Vercel and the canonical
  `/dashboard` route returns HTTP 200. Local gates passed: 35 focused proxy/access/schema tests,
  all 91 tests, non-incremental TypeScript, ESLint, isolated optimized production build, production
  audit with zero findings, lockfile/version review, and diff checks. The first local build attempt
  encountered the already-running app's locked `.next` trace; an isolated webpack build passed and
  Vercel's clean production build independently succeeded. Temporary build/panic artifacts were
  removed.
- Backend final local gates passed: webhook security tests 5/5, affected integration tests 19/19,
  TypeScript, build, production audit with zero findings, and the complete suite with one worker
  (111 files, 866 passed, 6 intentional skips). A concurrent run's sole unrelated file-courier
  filesystem timeout passed in the focused rerun and in the sequential full suite.
- **Phase 1 is complete. Phase 2 and later remain unauthorized.** Next action is to retain this
  release under normal observation and wait for explicit approval before any production privacy/data
  inspection, penetration testing, migration, encryption backfill, or additional remediation phase.

## Active checkpoint — security remediation roadmap recorded (2026-08-17 SGT)

- The cross-repository security/readability/scalability audit is complete. One critical
  boundary requires first attention: the primary Telegram webhook is registered and handled
  without Telegram secret-header validation. Additional priorities are plaintext duplication
  in Study AI-analysis records, vulnerable dashboard dependencies, oversized Study snapshots,
  optional/incomplete content encryption, non-atomic note side effects, browser hardening,
  maintainability/CI, and proper multi-tenant groundwork before public Study mode.
- The authoritative staged plan is
  [`docs/SECURITY_REMEDIATION_ROADMAP.md`](docs/SECURITY_REMEDIATION_ROADMAP.md). It records seven
  phases, validation and rollback gates, safe production-inspection and staging-penetration-test
  boundaries, model/effort guidance, and the exact handoff template required after every subphase.
- Phase order: (1) webhook containment and dependency patching; (2) bounded read-only production
  privacy/data inspection; (3) encryption and retention remediation; (4) Study scalability and
  transactional reliability; (5) browser/maintainability hardening; (6) staging-first active
  security assurance; (7) public Study multi-tenant architecture.
- Model policy: Terra medium for routine/mechanical work, Sol medium for ordinary architecture,
  Sol high for auth/crypto/migrations/pentest interpretation, and xhigh only for a bounded final
  review of unusually consequential irreversible work. Ultra/max is exceptional and is not the
  default for security tasks.
- Historical planning state: no phase had started when this roadmap was first recorded. Phase 1
  was subsequently authorized on 2026-08-17; production inspection/testing beyond its bounded
  deployment verification still requires separate approval.

## Active checkpoint — Threadwise-native Markdown notes (2026-08-17 SGT)

- The user approved the previously discussed Obsidian-compatible direction for Study notes.
  This release is intentionally Threadwise-native rather than an Obsidian clone: existing
  `StudyResource.body` remains the canonical source and ordinary Telegram-captured text remains
  valid Markdown.
- Approved first production slice: safe GitHub-Flavored Markdown rendering, strict/lazy Mermaid
  diagrams, a responsive reader and write/preview/split editor, restart-safe local draft recovery,
  `[[wiki links]]` and backlinks, bounded note revision history, and portable `.md` import/export.
  Telegram must show a readable bounded fallback instead of raw diagram/source noise.
- Security and scope boundaries: do not execute raw HTML, Obsidian plugins, arbitrary JavaScript,
  or imported vault code; do not add local-vault synchronization. Preserve the existing Study
  authorization boundary, content encryption behavior, AI/manual-approval semantics, stable
  resource identities, module/session links, search, and current image/file handling.
- Expected backend work: additive encrypted revision persistence, optimistic edit-conflict checks,
  note-link metadata, route/proxy coverage, Markdown-to-Telegram fallback, migration, and focused
  tests. Expected dashboard work: Markdown utilities/renderer, specialized note reader/editor,
  Library integration, responsive styling, dependencies, and regression tests.
- Validation and publication: Prisma format/validate/generate, focused and full backend tests,
  backend typecheck/build; dashboard focused/full tests, TypeScript, ESLint, production build,
  diff checks, then commit and push both `main` branches. Update this checkpoint after each
  material implementation/validation boundary.
- Implementation checkpoint: additive `StudyResourceRevision` and `StudyNoteLink` persistence is
  wired through dashboard saves, Telegram/dashboard note creation, and approved AI note edits.
  Note detail exposes a bounded connection/history projection; saves carry the observed update
  timestamp; Telegram converts rich notes to readable plain text. The dashboard now has a dedicated
  Markdown reader/editor, branded module control, local crash-safe draft, Write/Preview/Split modes,
  safe GFM/Mermaid, `.md` import/export, Library excerpts, backlinks, and version recovery.
- Validation checkpoint: Prisma format/validate/generate, backend typecheck/build, 18 focused tests,
  and the full 861-pass/6-skip suite succeed. Dashboard non-incremental TypeScript, ESLint, isolated
  optimized production build, 10 focused tests, and all 91 tests succeed. The isolated build avoided
  the already-running local Next process and its temporary output was removed. `npm audit --omit=dev`
  found no advisory introduced by the Markdown/Mermaid packages; four existing production advisories
  remain in Next.js 16.2.10 and its pinned transitive toolchain for a separate framework update.
- Final hardening checkpoint: note saves now condition the database update itself on the observed
  `updatedAt` value, closing the simultaneous-write race rather than checking only before the write.
  The final full backend rerun reached 860 passes plus 6 skips with the existing unrelated concurrent
  Excel import timeout; `src/services/excel.test.ts` passed 2/2 immediately in isolation and the
  affected Study/dashboard suites remained green.
- Release checkpoint: backend runtime commit `13b2431` is pushed and Render `/health` reports that
  exact commit with HTTP 200, confirming the additive note migration deployed. Dashboard runtime
  commit `14b691b` is pushed, its exact GitHub/Vercel deployment status is successful, and the
  canonical `/dashboard` route returns HTTP 200. Both canonical worktrees are expected clean after
  the deployment-outcome documentation commits.

## Active checkpoint — Weekly review viewport repair + OpenAI configuration audit (2026-08-16 SGT)

- The user reported that Weekly review's dark sheet overlay creates a black halo over the
  underlying “Close the loop” heading, Module signals cannot reliably reach every module, and
  reduced browser zoom makes the right-side sheet disproportionately narrow.
- Dashboard source diagnosis: the shared Study overlay applies `backdrop-filter: blur(7px)`, which
  blooms the large underlying serif text; the wide sheet and wizard both claim viewport height
  while a sticky footer competes with the same overflow container. The approved repair removes
  backdrop blur, sizes the wide sheet proportionally at expanded CSS viewports, and gives Weekly
  review fixed header/progress/footer rows with exactly one independently scrollable step body.
- Safe production configuration audit via Render's read-only API found `OPENAI_MODEL` configured
  but no `OPENAI_API_KEY` variable on the Threadwise service. No value was read or printed. The
  backend OpenAI adapter and fail-closed availability check are correct; new Study analysis cannot
  run until a server-side key is added. Because the user's Gemini migration instruction was
  conditional on finding no OpenAI problem, that condition is false and no provider migration is
  authorized in this pass.
- Validation checkpoint: focused Study UI regressions pass 7/7 and the full dashboard suite passes
  88/88; non-incremental TypeScript, full ESLint, optimized Next production build, and diff checks
  pass. A browser fixture with fourteen module
  cards proves the step body scrolls from 0 to 271 px while the progress row and footer remain fixed;
  at 1920px and an expanded 2880px CSS viewport, the sheet remains proportional and the overlay's
  computed backdrop filter is `none`. Temporary QA files and processes were removed.
- Release checkpoint: dashboard runtime commit `d928ef9` is pushed to `origin/main`; Vercel reports
  success and the canonical `/dashboard` route returns HTTP 200. Backend continuity commit `d8e9a8c`
  is live on Render and `/health` returns HTTP 200 with that commit. No backend runtime code or AI
  provider was changed. Operational next action is user-side UI verification and, separately, adding
  a valid server-side `OPENAI_API_KEY` in Render if OpenAI Study analysis should be re-enabled.

## Active checkpoint — Review/timetable/Ari/Study-analysis correction pass (2026-08-14 SGT)

- The user approved a focused production correction pass after live review. Dashboard scope is:
  rebuild the Review `Top three` card as one aligned form with a distinct action footer; make the
  horizontal timetable reserve its visible space for the explicit block title before optional
  module/location metadata while keeping exact time in the accessible label/details; and replace
  Ari's rapid alternating eye-state crossfades with a calmer authored cadence containing one
  deliberate blink and stable eyes through the rest of the motion.
- The backend OpenAI migration is already deployed and uses the server-side `OPENAI_API_KEY`; it
  does not require Gemini or a laptop worker. Live validation still produced a failed analysis job,
  so this pass must distinguish a functioning integration from provider/account availability. The
  current public error mapper collapses OpenAI quota/rate-limit detail into a generic busy message;
  preserve safe actionable provider errors without exposing credentials or raw provider payloads.
- Validate focused UI/provider tests, full dashboard gates, backend typecheck/build/tests as
  applicable, visual animation output, then push every completed repository change and verify the
  corresponding production deployment.
- Implementation checkpoint: the OpenAI Study adapter now advances through the configured fallback
  model chain for temporary 429/5xx/model-availability failures, while quota/billing failures stop
  immediately rather than multiplying calls. If every configured model is temporarily limited, the
  final safe provider classification is retained. Persistence now keeps distinct safe messages for
  invalid deployed keys, project permissions, quota/billing, cross-model rate limiting, timeouts,
  and model availability instead of collapsing them to generic busyness.
- Dashboard checkpoint: Review's Top three card is a semantic form with one content alignment and a
  separate responsive action footer; the horizontal timetable gives its title up to three visible
  lines before optional module/location metadata and removes redundant visible time while retaining
  exact time in its accessible label/details; the Up next summary and accessible label are title-first.
  Ari v6 contains 42 registered frames over 6.09 seconds, 13 open-eye anchors and one 330 ms authored
  blink. Closed-eye source poses are deterministically normalized from neighboring authored open eyes.
- Validation checkpoint: dashboard focused tests 9/9, full tests 83/83, TypeScript, ESLint, production
  build, generator decode/alpha/registration checks and diff checks pass. Backend focused tests 11/11,
  full tests 858 plus 6 intentional skips, TypeScript, build and diff checks pass. Next action: final
  source review, commit and push both `main` branches, then verify Render/Vercel and public health/assets.
- Release checkpoint: backend runtime commit `8e6a87d` is pushed and Render `/health` reports HTTP 200
  with exact commit `8e6a87dd47fa`. Dashboard runtime commit `313fa9d` is pushed, Vercel reports the
  deployment successful, `/dashboard` returns HTTP 200, and the v6 WebP returns HTTP 200 as
  `image/webp` with the expected 1,663,568-byte response. Integration/configuration and recovery from
  temporary provider/model failures are fixed; an authenticated user-side Study request is still the
  required proof that the deployed OpenAI project currently has usable quota and permissions.

## Active checkpoint — Study review UI and provider diagnostics (2026-08-14 SGT)

- User-reported production defects are confirmed in source: Module review still renders two
  native `<select>` controls; the Review “Top three” card spans a nonexistent second grid row
  and therefore stretches into a large empty panel; OpenAI HTTP 429 errors are collapsed into
  the generic “analysis service is busy” message.
- Approved implementation in progress: reuse and harden the existing Threadwise Study choice
  popover for Module and Review type, make the Top three card content-height, and preserve safe
  OpenAI failure metadata so invalid credentials, insufficient quota/billing, temporary rate
  limits, and provider outages have distinct actionable messages. No secret or upstream error
  payload may enter the browser or database.
- Safe diagnostic evidence: the failed live analysis reached OpenAI and returned HTTP 429.
  A minimal local probe (printing only status/code/type) returned HTTP 401, proving the laptop
  `.env` credential is not equivalent to a working deployed credential and cannot validate the
  Render key. No key value was read or printed.
- Expected files: dashboard Study component/CSS/regression tests and `CLAUDE.md`; backend OpenAI
  Study adapter/runner tests and continuity docs. Validate sequentially to avoid unnecessary
  laptop load, then commit and push both `main` branches and verify Render/Vercel production.
- Local implementation checkpoint: Module and Review type now use the shared Study choice picker
  with explicit non-empty choices, selected-state checks, outside-click close, Escape, and
  Arrow/Home/End keyboard movement. The picker keeps its existing mobile bottom-sheet geometry.
  The Top three card now aligns to the start of its real grid row and no longer creates/spans an
  implicit row. OpenAI failures now retain only safe numeric status and normalized code/type in a
  typed error; the persisted message distinguishes 401, 403, insufficient quota/billing, temporary
  429 rate limiting, and 5xx availability, while logs receive only the same safe metadata.
- Validation checkpoint: dashboard Study UI regressions pass 4/4 and the full dashboard suite
  passes 83/83; TypeScript, ESLint, and the production Next build pass. Backend OpenAI
  adapter/runner tests pass 7/7; TypeScript, build, and Prisma generation pass. The full backend
  suite reached 856 pass + 6 intentional skips; one unrelated Excel configuration test timed out
  only under full-suite concurrency and passed 2/2 immediately in isolation. Both diffs pass
  whitespace validation. Final review, commit/push, and live deployment verification remain.
- Production checkpoint: backend code commit `d0957db` and dashboard code commit `615e38e` are
  pushed to `origin/main`. Render `/health` returned HTTP 200 with version `0.32.0` and commit
  `d0957db3040e`; Vercel reported the exact dashboard commit successful and the canonical
  `/dashboard` route returned HTTP 200. Both worktrees were clean and synchronized immediately
  after verification. The remaining external issue is the OpenAI credential/account state:
  retrying analysis will now identify invalid deployed credentials, quota/billing exhaustion, or
  temporary throttling distinctly instead of reporting every HTTP 429 as generic busyness.

## Current checkpoint — 2026-08-13

- Status: Phase 1 is complete in production. Phase 2 (Canvas completeness and material
  coverage) is implemented and locally validated; commit, migration deployment, and live sync
  verification are next.
- Canonical validated baseline before this documentation checkpoint:
  - backend `D:\CodexProjects\Threadwise`: clean `main` at `0af42ca`
  - dashboard `D:\CodexProjects\threadwise-dashboard`: clean `main` at `38d5037`
- Phase 1 scope is limited to dashboard timetable behavior and presentation:
  - prevent dialog focus from being stolen during background refreshes;
  - render the sheet against the viewport with a uniform, non-blurred scrim;
  - omit absent destination place IDs and show plain-language inline guidance;
  - prioritize real block titles at every density;
  - size horizontal blocks per collision group so isolated events fill the row.
- Expected Phase 1 files: `src/components/study-timetable.tsx`,
  `src/lib/study-timetable.ts`, `src/lib/study-timetable.test.ts`, and
  `src/app/study-dashboard.css`, plus focused component tests if the existing harness
  supports them. No backend runtime or schema change is expected in this phase.
- Phase 1 validation: focused timetable tests, dashboard typecheck, lint, full test suite,
  production build, bounded desktop/mobile visual inspection, then push/deploy and live check.
- Phase 1 implementation checkpoint:
  - dialog focus lifecycle is stable across parent refreshes and keeps Escape/focus trapping
    current through refs rather than re-running the focus effect;
  - all timetable overlays render through a body portal, lock background scrolling, use a
    uniform non-blurred scrim, and have bounded desktop/mobile sheet dimensions;
  - create payloads omit absent destination fields; update payloads retain deliberate null
    clears; unresolved text uses plain-language inline guidance;
  - horizontal narrow blocks derive a meaningful abbreviation from the title, wider blocks
    render the title first, and accessible labels retain complete title/module/time/location;
  - connected collision groups share lanes while isolated groups expand to the full row.
- Phase 1 local evidence:
  - timetable unit tests: 9/9 focused assertions pass within the 73/73 full dashboard suite;
  - changed-file lint, TypeScript, production build, and Impeccable detector pass;
  - full-project lint still reports one pre-existing error in `dashboard-app.tsx:311` and one
    pre-existing warning in `group-workspace.tsx:305`; neither file was changed in Phase 1;
  - production-build browser QA at 1440x720 and 390x844 confirmed focus retention,
    body-level portal placement, no backdrop blur, bounded sheet geometry, friendly location
    copy, title-first density, and 58px shared/124px isolated collision-group sizing.
- Phase 1 publication checkpoint:
  - backend context commit `21b76b3` pushed to `main`;
  - dashboard implementation commit `8f40ea0` pushed to `main`;
  - Vercel production deployment `dpl_FrcWRVn3JmVfRJ3kAkbAy1w9K1Fj` is Ready and owns the
    canonical `https://threadwise-dashboard.vercel.app` alias;
  - both worktrees were clean immediately after publication.
- Phase 2 audit scope now in progress: trace pagination, enrollment/course filters,
  assignment inclusion/skip/archive rules, missing-assignment reconciliation, sync state,
  and existing tests; inspect configured environment-variable names without reading secrets;
  only then define the smallest durable, observable completeness repair and material mirror.
- Phase 2 established causes/risks:
  - the active-enrollment course request also required Canvas `state=available`, a redundant
    second filter capable of excluding otherwise valid active enrollments;
  - ignored submitted or inactive-course assignments produced no persisted explanation;
  - one global in-flight promise could return one workspace's result to another, and the due
    loop considered only the first active workspace;
  - an interrupted `RUNNING` row was not retryable until its future `nextSyncAt`;
  - only courses/assignments were queried; course modules, pages, files, and PDFs were absent.
- Phase 2 implementation checkpoint:
  - workspace-keyed coalescing with one global serialized queue and stale-run recovery;
  - all due active workspaces are considered in bounded batches;
  - active enrollment remains required, but the redundant course-state filter is removed;
  - per-course counts and skip reasons persist in `StudyCanvasSync.lastSummary` and audit data;
  - new workspace/module-scoped `StudyCanvasCourseModule` and `StudyCanvasMaterial` records;
  - published module items are indexed up to 500 per course; Canvas pages cache at most 64 KB
    of normalized text plus SHA-256; file/PDF bodies are not downloaded during routine sync;
  - material API URLs must remain under the configured Canvas API origin; material failures
    are diagnostic and do not prevent assignment reconciliation;
  - Study settings shows latest course/assignment/module/material coverage and the count of
    assignments waiting for course activation.
- Phase 2 local validation: Prisma generation/validation, backend TypeScript, full backend
  suite (830 passed, 6 skipped), backend production build, dashboard TypeScript, targeted lint,
  full dashboard suite (73/73), and dashboard production build pass.
- Phase 2 publication checkpoint (2026-08-13):
  - backend commit `02b8d79` is pushed to `main` and Render deployment
    `dep-d9upqrdg1s2s73e59ka0` reached `live` after applying the Prisma migration;
  - `https://threadwise-90du.onrender.com/health` returned HTTP 200 with release
    `02b8d7907ae3` and service version `0.32.0`;
  - dashboard commit `c4eb418` is pushed to `main`, and production deployment
    `https://threadwise-dashboard-gfoiv0zce-hein-lin-htets-projects.vercel.app` is Ready;
  - both worktrees were clean immediately after publication;
  - the production job loop can now perform bounded Canvas assignment/material sync, but a
    founder-workspace sync result remains an authenticated operational check; do not claim
    private account coverage from an unauthenticated health probe.
- Next implementation action: inspect current task assignment/reminder persistence and Telegram
  callback/message ownership, then add the Phase 3 schema and tests for explicit audiences,
  multiple reminder instants, deterministic due-date escalation, delivery dedupe, and one
  canonical task-control surface per chat. Keep every new record workspace-scoped.
- Phase 3 implementation checkpoint (implemented, published, and operationally verified):
  - migration `20260813190500_durable_task_reminders` adds explicit `TaskAudience`, leased
    `TaskReminderSchedule` rows, unique reminder delivery keys, and one persisted
    `TaskControlSurface` per task owner/chat;
  - the backfill is conservative: tasks with assignees become `ASSIGNEES`; tasks without
    assignees remain `UNASSIGNED`; no historical task is silently changed to `EVERYONE`;
  - explicit reminder times are future-only, sorted/deduplicated, capped at 20, claimed with
    a five-minute lease, retried after a 15-minute failure backoff, and marked sent using a
    stable delivery key; they are canceled when a task completes, closes, or is archived;
  - automatic dated reminders now use a deterministic distance-to-deadline ladder while
    retaining the configured final-nudge cadence; a custom delivery also advances the
    automatic schedule so the next polling pass cannot immediately duplicate it;
  - group access now distinguishes `EVERYONE`, `ASSIGNEES`, and `UNASSIGNED`; everyone tasks
    are actionable by every member but are never claimable; assignment/claim operations
    transition the audience explicitly;
  - repeated Telegram completion callbacks now converge their resulting task lists onto one
    persisted control surface, deleting the previous list or retiring its controls when
    Telegram no longer permits deletion;
  - dashboard task editing now exposes a deadline, automatic rhythm, and up to 20 exact
    reminders; the group collaboration sheet exposes explicit Everyone and Unassigned modes;
  - lifecycle cancellation is recorded separately from an owner's intentional schedule removal,
    so reopening a task restores only future reminders canceled by the task lifecycle and never
    resurrects reminder times the owner removed;
  - local validation after the final Prisma generation is green: schema validate, backend
    typecheck/build, 48 focused tests, and the complete backend suite (842 passed, 6 skipped);
    dashboard tests (74/74), TypeScript, full lint, production build, and a clean changed-UI
    detector all pass;
  - bounded Playwright QA verified one unified editor with two exact reminder rows and the group
    Everyone/Unassigned assignment sheet at 1440 x 900 and 390 x 844. Both mobile sheets stayed
    within the viewport with document width exactly 390px and no horizontal overflow;
  - the disposable local preview and browser session were stopped after QA. No local worker or
    persistent laptop process is required by this phase.
  - final diff review closed the Telegram fallback edge case: when an old reminder cannot be
    edited and Telegram returns a newly sent task list, the new message id—not the stale callback
    id—is persisted as the canonical surface. A regression test covers this path.
  - backend commit `3db35bf3babd18020c9928975f87b7cbf08b85e1` was pushed to `main`.
    Render deployment `dep-d9uqsr0ae00c738lkqag` reached `live`; `/health` returned HTTP 200,
    version `0.32.0`, and commit `3db35bf3babd` after the migration/startup completed;
  - dashboard commit `137750574820fb5d98d535af7184e9f3b6ef7357` was pushed to `main`.
    Vercel deployment `dpl_4xfc6RaV6FYC6KTHKT4BbQ9Tz68K` built that exact commit, reached
    `Ready`, owns the production aliases, and `/dashboard?demo=1` returned HTTP 200.
- Phase 3 next action: begin Phase 4 by auditing the existing Gemini analysis service, API
  contract, job schema, worker readiness checks, and deployed environment-variable wiring. Replace
  only Study analysis's laptop-worker dependency with a bounded, asynchronous server-side Gemini
  API runner; keep deterministic Study operations independent and do not read or expose the key.
- Phase 4 implementation checkpoint (implemented, published, and operationally verified):
  - confirmed the current module-review job table is already workspace/module scoped, leased,
    restart-safe, evidence-hashed, and dashboard-polled; no Phase 4 schema migration is required;
  - confirmed the incompatible pieces are worker readiness in `geminiStudyAnalysis.ts`, Study job
    claiming/execution in `codexWorker.ts`, the absence of Gemini settings in `config/env.ts`, and
    `.env.example` copy that says never to deploy the key;
  - current official Gemini documentation supports API-key authentication via the
    `x-goog-api-key` header, bounded `generateContent`, and structured JSON output. Phase 4 will
    use a configurable model, response-size/output-token limits, an abort timeout, safe provider
    errors, and the existing Zod/citation validation before persisting results;
  - planned files: `src/config/env.ts`, `.env.example`, new server-side Gemini API/runner services,
    `src/services/geminiStudyAnalysis.ts`, `src/main.ts`, focused tests, and the dashboard's
    unavailable-state wording. The secret will never be returned, logged, or committed.
  - implemented `geminiStudyApi.ts` with API-key header authentication, configured model
    fallbacks, structured JSON, a 90-second default abort, bounded output tokens, a 200K response
    ceiling, and safe HTTP/parse errors that never retain upstream bodies;
  - implemented `geminiStudyAnalysisRunner.ts`: one in-process pass at a time, one leased job per
    pass, immediate startup plus a bounded poll, safe failure persistence, and top-level rejection
    containment so database/provider failure cannot crash the app-server;
  - removed Study claiming/execution from `codexWorker.ts` and removed the four private Study-job
    worker relay routes. The separate owner-only Ideas CLI path remains intact;
  - changed Study availability from local-heartbeat state to backend provider configuration. A
    missing key leaves cached completed results readable and reports `provider_unavailable`;
  - validation: backend TypeScript/build pass, provider/runner/prompt tests pass 8/8, full backend
    suite passes 848 with 6 skips; dashboard tests pass 74/74, TypeScript, full lint, and production
    build pass.
  - configuration preflight found no `GEMINI_API_KEY` in Render, the backend `.env`, the current
    process, or the Windows user/machine environments. No value was printed and no other provider
    credential will be substituted. Phase 4 therefore deploys fail-closed with analysis reported
    offline until the owner adds the Gemini key directly to Render.
- Phase 4 deployment result: production is healthy in the intentionally disabled provider state.
  Live provider execution remains a named configuration follow-up, not an implementation failure
  or a reason to add a laptop worker.
  - backend commit `41fa0bb532fcfa26263ddedc7e96e23f8c3cb05c` reached Render `live` in
    deployment `dep-d9ur72uq1p3s73c16evg`; `/health` returned HTTP 200 with commit
    `41fa0bb532fc`;
  - dashboard commit `d215e7f` was verified in Vercel's build log, reached `Ready`, and the
    production dashboard returned HTTP 200.
- Phase 4 is complete. Phase 5 begins with a versioned, workspace-scoped evidence graph covering
  exact capture/session times, explicit and inferred session-resource links, Study work, Canvas
  ordering/material authority, and confidence/provenance. It must support Connections, Quiz, and
  Both without silently applying note corrections.
- Phase 5 implementation checkpoint (in progress):
  - migration `20260813203000_study_evidence_analysis` will add explicit Connections/Quiz/Both
    job modes and durable note-edit suggestions with Pending/Applied/Dismissed/Superseded state;
  - evidence snapshot v2 will include sessions, user notes/images/OCR, Study work, Canvas pages and
    file metadata, assignments, provenance/authority, exact occurrence times, explicit session
    links, cautious temporal links, and coverage metadata. It will never embed image bytes;
  - correctness claims and edit suggestions must cite both the user record being questioned and
    authoritative Canvas evidence. Metadata-only files cannot establish a correction;
  - applying a suggestion will be an authenticated explicit action with an optional user-edited
    replacement, an original-content hash conflict check, and an untouched original until Apply.
    Dismiss never changes the note;
  - planned backend files: Prisma schema/migration, `geminiStudyAnalysis.ts`, structured Gemini
    schema, Study dashboard schemas/routes, pure evidence-graph tests, and suggestion review tests.
    Planned dashboard files: Study analysis types/helpers/panel/styles/proxy allowlist/tests.
- Phase 5 next action: add the schema and v2 snapshot/result types first, regenerate Prisma, then
  implement pure edge/authority validation before wiring any mutation endpoint or UI.
- The retired poisoned Codex task and deleted rollout tree must never be accessed.
- User-provided screenshots are normal files under `D:\CodexData\Temp`; do not embed
  their bytes in this context or conversational history.

## User-confirmed product direction

### Study intelligence

- Study AI must run through a server-side provider API using the deployed
  `GEMINI_API_KEY` environment secret. There is no intended laptop-side Gemini worker for
  this feature. Never expose the key to the browser or persist it in Git.
- The analysis should be opt-in and asynchronous. It must not block deterministic capture,
  reminders, sessions, Canvas sync, or dashboard use, and it must not create meaningful
  load on the user's laptop.
- Build a time-aware evidence graph per module. Preserve when a note/image/resource was
  captured, explicit links to Study sessions, session time ranges, related work items,
  Canvas material coverage, and confidence/provenance for inferred associations.
- Analysis modes should be user-selectable: connections/review, quiz, or both. Quizzes
  should be creative and challenging but grounded in cited evidence and expected course
  coverage.
- The assistant should identify possible misconceptions, explain the correction and its
  evidence, and propose note edits. AI must never silently rewrite a note: present a diff
  or suggestion with Apply, Edit before applying, Dismiss, and an untouched original.
- Distinguish user-authored notes, OCR text, AI inference, and authoritative course
  material. When correctness cannot be established, say so rather than inventing a
  correction.

### Canvas coverage

- Current sync mirrors active courses, assignments, due dates, and submission state only.
  It does not currently ingest course modules, module items, pages, files, or PDFs.
- Planned expansion is read-only and metadata-first: sync module structure and published
  module items, then fetch bounded text/file content only when supported and relevant.
- Coverage should estimate expected progress by date from module ordering, unlock/due
  dates, timetable/semester week, and published materials, while labelling instructor
  ambiguity honestly.
- Canvas reconciliation must remain paginated, restart-safe, idempotent, archive-aware,
  and observable so missing weekly assignments can be diagnosed rather than guessed at.

### Future public Study product groundwork

- The current owner-only, two-member-group Study installation remains sealed. Do not relax
  its environment gates or expose it as the public product while preparing the future path.
- The eventual product should use a distinct Telegram bot identity, token, webhook path,
  command menu, branding, rate limits, and failure boundary. It may initially share the
  existing Render process and PostgreSQL database, as Beacon does, but it must not present
  itself as Threadwise or reuse Threadwise's bot token.
- Public Study should be private-chat-first. Academic records, Canvas authorization, AI
  results, and misconception feedback must not default to a Telegram group. Collaborative
  Study spaces can be a separate, explicitly consented feature later.
- Never ask friends or public users to paste or send manually generated Canvas access
  tokens. Canvas documents those tokens as password-equivalent and says multi-user apps
  must use OAuth. The current global `CANVAS_ACCESS_TOKEN` is acceptable only for the sealed
  founder installation during transition.
- A public Canvas connection requires an institution-issued Canvas developer key and an
  OAuth authorization-code flow. Store per-user access/refresh tokens encrypted at rest;
  never expose them to Telegram messages or browser JavaScript. Support revocation,
  disconnect, expiry/refresh, last-sync visibility, and account/data deletion.
- Model Canvas authorization as a workspace-scoped connection with an allowlisted Canvas
  origin, not global environment state. Every sync/material/job query must remain scoped to
  the owning Study workspace. Replace the process-global Canvas single-flight promise with
  a workspace-keyed, concurrency-bounded queue before enabling multiple users.
- New Study AI, reminder, material, quiz, and suggestion records must carry `workspaceId`
  and enforce tenant ownership at the service and dashboard boundary. Avoid new singleton
  assumptions even while only the founder instance is active.
- Public readiness also requires invite-only beta controls, per-user quotas, abuse/rate
  limits, operational kill switches, privacy/retention disclosures, AI-processing consent,
  export/delete flows, and tenant-isolation tests. If NUS does not issue the necessary
  developer key, launch Study without Canvas sync rather than collecting personal tokens.
- A separate Study dashboard domain/brand can follow later. Shared components and backend
  services are acceptable; authentication, workspace selection, telemetry, and product
  identity must remain independently scoped.

### Group tasks and reminders

- Group owners/admins need multiple explicit reminder times per task.
- Do not conflate “no assignee” with “everyone”. Preserve an explicit product distinction
  between unassigned/claimable work, everyone-visible obligations, and named assignees.
- Reminder delivery should use a deterministic escalation policy that becomes more frequent
  near a due date, respects quiet hours and spam limits, and does not suppress explicitly
  scheduled reminders. Durable reminder rows and delivery dedupe are required.
- Completing tasks from several Telegram reminders should converge on one current control
  interface/digest. Superseded reminder messages should be edited or removed where Telegram
  permits; repeated full task lists must not accumulate.

### Timetable defects and visual direction

- Confirmed focus-loss mechanism to fix: `useDialogFocus` depends on an unstable inline
  `onClose` callback and calls `dialogRef.current?.focus()` whenever the effect reruns,
  stealing focus from the label input during parent refreshes.
- The add/edit block layer should be a viewport-contained sheet/portal with a uniform
  scrim, no backdrop blur, no giant left fade, and no text-shadow/glow leakage from the
  underlying Timetable/Week heading. It must not distort the timetable layout.
- The create payload currently sends `destinationPlaceId: null`, while the backend POST
  schema accepts an optional string but not null. Omit absent create fields and provide
  inline, plain-language location guidance instead of exposing Zod text such as
  “Expected string, received null”.
- A typed but unresolved destination may save as a plain label only if the UI clearly says
  that leave-time reminders are disabled until a canonical location is selected.
- Horizontal timetable cards prioritize block title over time/module metadata. Overlap
  layout should be computed per collision group: only simultaneous blocks share vertical
  lanes; isolated blocks should use the full day-row height. Very short blocks need a
  meaningful micro-marker plus accessible/hover detail rather than an apparently empty pill.

## Repository evidence already established

- Superseded Phase 4 evidence: Study analysis previously depended on local-worker readiness.
  It now runs only through the bounded backend Gemini API runner. The remaining Phase 5 gap is
  its flat recent-session/resource snapshot, lack of explicit edges and Canvas authority, and
  its old no-correctness output contract.
- Superseded Phase 2 evidence: Canvas sync previously stopped at courses and assignments. It now
  mirrors module ordering, bounded page text, and file/PDF metadata. Actual file/PDF bodies remain
  unavailable to analysis unless a bounded on-demand content path is added.
- `src/services/reminders.ts` stores one `nextReminderAt` per task and switches to one fixed
  near-due interval. `src/services/studyReminders.ts` emits one deduplicated approaching or
  overdue candidate for high/critical Study items within 24 hours. Neither implements a
  graduated reminder ladder or multiple explicit reminder instants.
- `src/bot/callbacks.ts::handleTaskDone` replaces the clicked message with a full active-task
  list. Clicking completion on several independently delivered reminders therefore leaves
  several separate lists.
- `src/lib/study-timetable.ts::timetableBlockLanes` computes one lane count for the whole
  day. The dashboard then gives every block a fixed 58px height within that global row,
  causing unused vertical space outside overlap windows.
- The deterministic `21st review` CLI is not installed in the current environment. Planning
  is grounded in the five supplied screenshots, source, tests, and design documentation.

## Approved implementation order

1. Fix the blocking timetable focus, overlay, payload/error, and horizontal-layout defects.
2. Diagnose Canvas sync against persisted status and API reconciliation; repair assignment
   completeness before expanding the content mirror.
3. Add durable multi-reminder schedules, deterministic escalation, and one merged Telegram
   task-control surface.
4. Replace Study's local-worker dependency with a bounded server-side Gemini API job runner.
5. Build the module evidence graph, Canvas material coverage, misconception suggestions,
   manual note-edit review, connections, and quiz/both modes.
6. Validate each vertical slice with migrations, focused tests, full builds/suites, and
   authenticated operational checks before deployment.

Cross-cutting requirement for every step: preserve the sealed founder Study instance while
making new durable models, queues, provider adapters, and authorization checks workspace-scoped
enough for a future invite-only Study bot. Do not activate or publicize that bot yet.

### Phase 5 checkpoint — evidence-aware review implemented locally (2026-08-13 20:32 SGT)

- Added migration `20260813203000_study_evidence_analysis` with explicit `CONNECTIONS` / `QUIZ` / `BOTH` job modes and durable note-edit suggestions (`PENDING`, `APPLIED`, `DISMISSED`, `SUPERSEDED`).
- Added bounded evidence graph v2 across completed sessions, explicit/temporal session-resource links, work items, Canvas course modules/materials, assignments and source timestamps. Evidence authority is explicit: learner record, OCR transcript, published course material, course metadata, or activity log.
- Canvas file/PDF bodies are not downloaded during analysis; only already-synced page text can qualify as authoritative course material. No image bytes or base64 are added to analysis evidence.
- Pace is reported as `UNKNOWN` unless Canvas exposes dated module-release evidence; the model cannot assert ahead/on-track/behind from module numbering alone.
- Misconceptions and note edits are accepted only when citations include both learner/OCR evidence and authoritative `COURSE_MATERIAL`. Metadata alone cannot support a correction.
- Note suggestions never mutate notes automatically. Apply accepts a user-edited replacement, verifies the original body SHA-256 inside a transaction, and marks stale proposals `SUPERSEDED` rather than overwriting newer text.
- Dashboard now has Connections / Quiz / Both controls, cited corrections, expandable quiz answers, evidence provenance and manual note-edit review controls.
- Focused Gemini/runner tests pass (6); dashboard proxy/analysis tests pass (27); both codebases typecheck. Full test/build/UI validation remains pending.

### Phase 5 production checkpoint (2026-08-13 20:45 SGT)

- Backend feature commit `7ce3f4fe7043f05af3217c6236cfc25a1116a1f2` is live in Render deployment `dep-d9urmo5bedkc73bult90`; the additive Prisma migration completed and `/health` returns HTTP 200 with exact commit `7ce3f4fe7043`.
- Dashboard feature commit `7c018e194b06c287b336e7032c1ae227728f7574` has a successful Vercel deployment status and the canonical production alias returns HTTP 200.
- Final local gates: Prisma validate/generate, backend typecheck/build and all 849 tests (6 skipped); dashboard TypeScript, lint, production build and all 76 tests.
- Production AI execution remains deliberately fail-closed: a Render environment-name audit confirms `GEMINI_API_KEY` is absent. The code never substituted another provider or exposed a secret. Add the key directly in Render before live analysis can execute; cached analyses remain readable meanwhile.
- Canvas page bodies participate as authoritative course material. Canvas file/PDF records currently contribute ordering/title/type/size/update metadata only; routine sync deliberately does not download their bodies. Do not claim the AI read PDF contents until a separately bounded, consented extraction path is implemented.
- Both worktrees were clean at the feature commits before this production-context update. No local AI worker is required or running.

## Interruption protocol

Before any implementation begins, add the approved scope and exact files/migrations expected.
After each checkpoint, record completed work, tests run, current Git status, unresolved risks,
and the next command/action. Never mark incomplete work complete.

### UI recovery polish checkpoint — approved scope before implementation (2026-08-13)

- User supplied a final screenshot audit and approved implementation. Only defects that are
  still present in the current dashboard are in scope; already-replaced native pickers,
  native destructive confirmation, oversized resource picker, mobile drawer scrollbar,
  old library-search overlap, and the original nullable session-save payload are not to be
  reimplemented.
- Remaining Ari work: rebuild the eight-frame untangling sprite as a reproducible,
  transparent, consistently registered asset; remove the visible cream card/rectangle;
  use a correctly proportioned frame; and restore two frames per second (500 ms per frame).
  The offline Ari artwork must also use a transparent normal asset so it blends with the
  page instead of appearing as a rectangle.
- Remaining Deep Work work: normalize same-role type sizes at mobile and desktop sizes and
  replace corrupted separator/ellipsis characters that still surface in session/module
  copy. Preserve the incumbent layout and custom accessible pickers.
- Remaining numeric-input work: prevent sticky or irremovable leading zeros in every
  dashboard integer field, especially Daily reminder cap and Timed practice from week,
  while preserving empty edit states, min/max validation, and numeric API payloads.
- Expected dashboard files: `src/components/study-dashboard.tsx`,
  `src/app/study-dashboard.css`, `src/app/globals.css`, `src/components/ari.tsx`,
  `src/lib/ari-loader.ts`, their focused tests, `public/sw.js`, reproducible Ari asset
  generation metadata/script, and generated transparent assets under `public/brand/`.
  No backend schema, repository data, secrets, deployment configuration, or poisoned
  recovery artifacts are in scope.
- Validation plan: focused Vitest coverage for numeric normalization/Ari metadata, dashboard
  typecheck/lint/build/test suite, static scan for embedded base64 and mojibake, Impeccable
  detector on changed UI targets, responsive browser checks for loading/offline/Deep Work/
  Rhythm settings, and a final source diff. Update this ledger after each checkpoint.

### UI recovery polish checkpoint — implementation in progress (2026-08-13 21:21 SGT)

- Ari v4 is now generated reproducibly by `scripts/normalize_ari_assets.py`. The loader uses
  eight 640x640 transparent frames, registers the main teal silhouette to a common x-axis,
  centers every foreground vertically, removes inherited encoder seams, and retains the
  intentional thread motion. Playback is 500 ms per frame (2 fps), 7 seconds for the full
  forward/reverse loop. The visible card border/background/shadow were removed.
- Offline/light and dark avatar artwork now use circular-alpha assets so Ari remains centered
  on the warm canvas without a rectangular source sheet. Service-worker shell cache bumped
  to v3 and precaches the new offline avatar.
- Added an empty-edit-safe `IntegerInput` plus pure normalization/clamping helpers. Study
  Rhythm, Study travel buffers, timetable week bounds/buffer, and general reminder settings
  no longer coerce an emptied control immediately back to `0`; redundant leading zeros are
  removed while typing and committed values are clamped. The controlled expense preview now
  preserves a genuinely empty total instead of coercing it to zero.
- Deep Work form roles now share a readable 12/13/14px hierarchy across field labels,
  selected values, option details, methods, techniques, resources, history, and the active
  companion; the incumbent layout and custom pickers remain unchanged.
- Focused Vitest gate passes: 3 files / 6 tests. TypeScript passes. Initial lint found the
  React 19 `set-state-in-effect` rule in the first numeric-input implementation; the effect
  has been removed in favor of an idle-prop/editing-draft model. Lint rerun, full tests,
  build, detector, browser QA, and final diff are still pending.

### UI recovery polish checkpoint — validated locally (2026-08-13 21:34 SGT)

- Final dashboard gates pass: TypeScript, ESLint, production build, and all 78 Vitest tests.
  `git diff --check` is clean and the changed source contains no embedded base64 payloads.
- Playwright mobile QA at 393x852 confirms the offline avatar is centered and blends as a
  circular illustration with no rectangular sheet. The production loader markup renders
  with no card/background and a 220x220 computed frame box. The browser reports a 7s
  animation duration for the 14-frame forward/reverse sequence (2 fps).
- Playwright interaction QA confirms a reminder integer control can remain empty while
  focused and normalizes typed `019` to `19`. The same shared control is used for Study
  Rhythm and travel-buffer fields; timetable week drafts use the same pure normalization.
- Impeccable detector reported one pre-existing `border-left: 3px` on the expandable quiz
  answer at `study-dashboard.css:693`. It is unrelated to this approved screenshot scope
  and was not introduced or changed here. No detector finding applies to the changed Ari,
  Deep Work, or numeric-control selectors.
- Remaining action: review/stage the dashboard-only diff, commit, push, wait for Vercel,
  check the production alias/response, then record the deployed commit. Backend files and
  runtime behavior were not changed.

### UI recovery polish checkpoint — deployed (2026-08-13 21:37 SGT)

- Dashboard commit `e07a1dbf289722816874ad47b738be1991f1fc8d` (`fix study loader and
  numeric inputs`) is pushed to `origin/main`.
- Vercel reports the commit deployment successful. The canonical production `/offline`
  route returns HTTP 200, and `/brand/ari-untangle-normalized-v4.png` returns HTTP 200 as
  `image/png` with the expected 1,001,770-byte body.
- Dashboard worktree was clean at `e07a1db` after push. No backend runtime, database,
  repository data, deployment environment, or poisoned recovery artifact was accessed or
  changed. This documentation update is the only backend-repository change.

### Unified loader handoff — approved scope before implementation (2026-08-13 22:13 SGT)

- The user reported a visible two-phase loading handoff after the Ari asset repair. Code
  inspection confirms two sequential loading surfaces: Next's dashboard route loader uses
  the shared 220px Ari presentation and “Untangling your workspace…”, while Study bootstrap
  adds the Threadwise lockup, forces Ari to at least 260px, and says “Untangling your
  semester...”. The animation asset and frame registration are not the cause.
- Approved narrow fix: introduce one shared full-screen workspace-loader component and use
  it from both the dashboard route fallback and Study bootstrap so markup, label, geometry,
  background, and responsive behavior are identical across the handoff. Remove only the
  obsolete Study-only loader size override; preserve the distinct Study reconnect/error
  state and all other Study behavior.
- Expected dashboard files: `src/components/ari.tsx`, `src/app/dashboard/loading.tsx`,
  `src/components/study-dashboard.tsx`, `src/app/study-dashboard.css`, and the focused Ari
  loader test. No image asset, backend, data, secret, or deployment setting is in scope.
- Validation plan: focused Vitest, TypeScript, lint/build, the required UI detector, source
  diff, then push and verify the production deployment/route. Next action: implement the
  shared component before changing either caller.

### Unified loader handoff — implemented and validated locally (2026-08-13 22:18 SGT)

- Added `AriWorkspaceLoader` as the sole full-screen workspace-loading presentation. Both
  Next's `/dashboard` route fallback and Study bootstrap now render that component, so the
  sequential handoff has identical markup, “Untangling your workspace…” copy, 220px Ari
  geometry, canvas background, and responsive behavior. The animation sprite itself was not
  changed and remains the validated 2 fps normalized v4 asset.
- Removed the obsolete `.study-boot .ari-untangle-loader { min-width: 260px; }` override.
  Study's separate reconnect/error state still uses its existing brand lockup, Ari avatar,
  retry action, and dashboard escape path.
- Added a focused regression contract proving both loading callers use the shared component,
  the old Study label is absent, and the size override cannot return. Focused Vitest passes
  (2 tests); TypeScript, ESLint, and the production Next build pass; `git diff --check` is
  clean.
- The required Impeccable detector reports only the previously documented unrelated
  `border-left: 3px` at `study-dashboard.css:693`; none of the changed loader code triggers a
  finding. The optional 21st CLI is not installed, so no 21st command was run. Next action:
  commit and push the dashboard change, wait for Vercel, verify production, then record the
  deployed commit. No backend runtime or data change is required.

### Unified loader handoff — deployed (2026-08-13 22:22 SGT)

- Dashboard commit `608b14cde029eadb8b9ca792c6f4521a9a149c17` (`fix unified dashboard
  loading state`) is pushed to `origin/main`.
- Vercel's production deployment completed successfully for that exact commit. The immutable
  deployment URL redirects as expected (HTTP 302), and the canonical
  `https://threadwise-dashboard.vercel.app/dashboard` route returns HTTP 200.
- Dashboard validation for this change: focused Ari loader Vitest (2 tests), TypeScript,
  ESLint, Next production build, `git diff --check`, source review, and Impeccable detector.
  The two sequential loading stages now share one component and are visually identical;
  production interaction confirmation is left to the user's authenticated live check.
- No Ari image asset, backend runtime, database, secret, repository data, or poisoned recovery
  artifact was accessed or changed. The dashboard worktree is expected to be clean at
  `608b14c`; this PROJECT_CONTEXT update is the only backend-repository change.

### Ari 4 FPS cadence — approved scope before implementation (2026-08-13 22:30 SGT)

- The user approved increasing the normalized Ari loader from 2 FPS to 4 FPS because the
  discrete motion still feels clunky. Keep the existing eight registered transparent frames,
  forward/reverse 14-step sequence, loader geometry, shared loading surface, and reduced-motion
  behavior unchanged; only halve each frame hold from 500 ms to 250 ms.
- Expected dashboard files: `src/app/globals.css`, `src/lib/ari-loader.ts`, the two focused Ari
  loader tests, `scripts/normalize_ari_assets.py`, and the generated v4 JSON manifest metadata.
  The PNG sprite must remain byte-identical and no additional animation/image dependency is in
  scope.
- Validation plan: confirm 3.5-second loop duration and 4 FPS metadata in focused tests, verify
  the PNG hash is unchanged, run TypeScript/lint/build and the required UI detector, then push
  and verify Vercel production. Next action: update the canonical cadence constants/generator
  and CSS together so runtime, tests, and reproducible asset metadata cannot drift.

### Ari 4 FPS cadence — implemented and validated locally (2026-08-13 22:35 SGT)

- Ari now advances every 250 ms (4 FPS) through the unchanged 14-step forward/reverse sequence,
  making one seamless loop 3.5 seconds. Runtime CSS/constants, the reproducible normalization
  script, v4 JSON manifest, and focused tests all encode the same cadence.
- The eight normalized 640px transparent frames, registration, loader ratio/geometry, unified
  loading surface, and reduced-motion still frame remain unchanged. Git object hashes confirm
  the working PNG sprite is byte-identical to dashboard `HEAD` (`592d782d66a0c2ddfb57b5fd82c918b0ababb288`),
  so this adds no image payload and cannot reintroduce the earlier frame-alignment issue.
- Focused Ari Vitest passes (2 files / 4 tests); TypeScript, ESLint, and the Next production build
  pass; `git diff --check` is clean. The required Impeccable detector returns no findings for the
  changed runtime stylesheet. Next action: commit and push, wait for Vercel, verify production,
  and record the deployed commit.

### Ari 4 FPS cadence — deployed (2026-08-13 22:38 SGT)

- Dashboard commit `be3c88c` (`polish Ari loader cadence`) is pushed to `origin/main` and its
  Vercel production deployment completed successfully.
- The canonical `https://threadwise-dashboard.vercel.app/dashboard` route returns HTTP 200.
  Ari's shared loader now runs at 4 FPS in production with the unchanged normalized sprite and
  unchanged reduced-motion fallback.
- No backend runtime, database, secret, repository data, additional asset, or poisoned recovery
  artifact was accessed or changed. The dashboard worktree is expected to be clean at `be3c88c`;
  this PROJECT_CONTEXT update is the only backend-repository change.

### Ari smooth in-between animation — approved scope before implementation (2026-08-13 23:02 SGT)

- User correctly reported that 4 FPS still hard-cuts between the same eight drawings. Raising
  playback speed did not create transitional poses and therefore made the snapping more obvious.
- Chosen durable fix: keep all eight approved normalized frames as anchors, retain the existing
  14-step forward/reverse motion and exact 3.5-second loop, and deterministically generate two
  premultiplied-alpha in-between frames for every anchor transition. This yields 42 playback
  frames at 12 FPS without generative redrawing, optical-flow deformation, geometry changes, or
  a local/runtime worker.
- The production animation will be a transparent 480x480 animated WebP bounded below 2 MB.
  The original 640px v4 normalized sprite remains the reproducible anchor source and the
  reduced-motion still frame. The generator must encode interpolation method, source anchors,
  per-frame durations, frame count, transparency, and loop duration in a new v5 manifest.
- Naive block optical flow was prototyped and rejected before production because it visibly
  damaged Ari's lines. Generative image editing was also rejected because it could change the
  established mascot. Alpha-correct interpolation preserves colors/alignment and adds only
  short transitional blends between exact approved anchors.
- Expected dashboard files: `scripts/normalize_ari_assets.py`, new v5 WebP/JSON assets under
  `public/brand`, `src/components/ari.tsx`, `src/app/globals.css`, `src/lib/ari-loader.ts`, and
  focused Ari tests. Existing v4 PNG/JSON anchors must not be removed. No backend, data, secret,
  or unrelated UI change is in scope.
- Validation plan: regenerate from checked-in sources; verify 42 frames, 12 FPS, 3.5-second
  duration, transparent corners, exact square ratio, v4 anchor hash stability, size budget,
  reduced-motion fallback, focused tests, typecheck/lint/build, detector, and browser-computed
  loader geometry. Next action: implement the v5 generator and switch only the animated loader.

### Ari smooth in-between animation — implemented and validated locally (2026-08-13 23:18 SGT)

- Added reproducible `ari-untangle-smooth-v5.webp` plus a structured v5 playback manifest.
  The generator derives 42 transparent 480x480 frames from the approved v4 anchors: 14 exact
  anchor positions plus two premultiplied-alpha transitional frames per anchor interval. It
  plays at 12 FPS for the same exact 3.5-second loop and remains below the 2 MB budget at
  1,661,414 bytes.
- The generator now reopens the encoded WebP and fails if frame count, dimensions, transparent
  corners, or anchor fidelity drift. Current decoded validation: 42 frames, all corner alpha
  zero, maximum foreground anchor mean absolute error 3.61 against a strict 4.5 threshold.
  Approved v4 PNG and light/dark static Ari asset SHA-256 hashes remain unchanged.
- Runtime now renders the animated v5 WebP as a normal square image rather than moving a wide
  sprite with hard CSS steps. `prefers-reduced-motion: reduce` hides the animation and uses the
  crisp final v4 anchor as a static background. Shared Study/route loader markup, 220px normal
  geometry, 118px compact geometry, copy, background, and error behavior are unchanged.
- Focused Ari Vitest passes (2 files / 5 tests); TypeScript, ESLint, Next production build,
  `git diff --check`, and the Impeccable detector pass. Chromium QA confirms 480x480 natural
  media inside an exact 220x220 rendered frame, visible frame advancement over 110 ms, and the
  expected reduced-motion static background (`800%`, position `100% 0`). The only QA console
  request error was the temporary test page's absent favicon, unrelated to production code.
- Rejected experiments were not retained: block optical flow visibly damaged line art, and a
  lossless 56-frame prototype exceeded 6.9 MB. All temporary interpolation files, QA pages,
  screenshots, browser sessions, and local servers created during this pass were removed.
  Next action: stage only the v5 generator/asset/runtime/tests, commit, push, verify Vercel and
  the production v5 asset response, then record the deployed commit.

### Ari smooth in-between animation — deployed (2026-08-13 23:24 SGT)

- Dashboard commit `3c2b4ae` (`smooth Ari loader transitions`) is pushed to `origin/main`; its
  Vercel production deployment completed successfully.
- Canonical production verification: `/dashboard` HTTP 200,
  `/brand/ari-untangle-smooth-v5.webp` HTTP 200 as `image/webp` with the expected 1,661,414-byte
  body, and the v5 manifest HTTP 200 as JSON.
- The live loader now uses 42 frames at 12 FPS with two deterministic alpha-correct in-betweens
  between each approved anchor, the same 3.5-second forward/reverse loop, unchanged square
  geometry, and the unchanged crisp v4 reduced-motion fallback.
- Dashboard worktree is expected clean at `3c2b4ae`. No backend runtime, database, secret,
  repository data, unrelated session, local worker, or poisoned recovery artifact was accessed
  or changed. This PROJECT_CONTEXT update is the only backend-repository change.

### OpenAI Study analysis + general Telegram image batches — approved scope (2026-08-14 SGT)

- The user confirmed the deployed backend has `OPENAI_API_KEY`, `OPENAI_MODEL`, and
  `OPENAI_EMBEDDING_MODEL`, but no Gemini API key. Study analysis must therefore use the existing
  server-side OpenAI credential and must not depend on a laptop worker. Never copy or expose the
  secret; only the backend provider may read it.
- The current Study analysis queue is durable and restart-safe but is incorrectly hard-wired to a
  Gemini REST provider, so it remains disabled in production. Preserve its evidence bounds,
  validation, leasing, caching, note-edit review, and database history while switching provider
  execution and user-facing availability to OpenAI. A legacy Prisma model name may remain to avoid
  a destructive data migration, but active runtime/config/docs must no longer require Gemini.
- General Telegram image intake currently creates one review card per image in a media group.
  Implement a separate durable general-image batch record keyed by owner/chat/media-group, settle
  briefly after the last Telegram delivery, then publish exactly one review surface for the album.
  Saving with a caption must apply one shared caption to every image. Preserve single-image behavior
  and the existing Study-mode batch capture flow.
- The general batch must be restart-safe and idempotent: deduplicate Telegram redelivery, claim
  state transitions with leases, avoid duplicate stored images, expire stale reviews, and recover
  abandoned send/processing leases. Do not keep image bytes in PostgreSQL or AI prompts; retain only
  Telegram reusable file references and bounded metadata as today.
- Expected changes are backend-only: Prisma schema/additive migration, general image batch service
  and bot callbacks/keyboards, OpenAI Study provider/runner wiring, focused tests, environment/docs,
  and this continuity ledger. Next action: implement the additive schema and focused services, then
  run Prisma validation/generation, focused tests, typecheck, full tests, and build before release.

### OpenAI Study analysis + general Telegram image batches — local implementation checkpoint (2026-08-14 SGT)

- Study analysis now uses the existing backend `OPENAI_API_KEY`, `OPENAI_MODEL`, and fallback model
  chain through a bounded JSON-only OpenAI adapter. The prior Gemini Study adapter/runner is removed;
  provider-neutral runtime/config/docs use `STUDY_ANALYSIS_*` bounds. No laptop worker is involved.
  The historical `GeminiStudyAnalysisJob` Prisma table and legacy persistence service name remain so
  completed analysis history is preserved without a risky data rewrite; active routes and the runner
  use provider-neutral exports.
- General Telegram albums now persist in a dedicated additive `PendingImageUploadBatch` model keyed
  by owner/chat/media-group. Each Telegram message is deduplicated, the album settles for 1.8 seconds,
  stale send/save leases recover after restart, and one review message replaces per-image keyboards.
  A shared caption updates every pending item. Save all is one database transaction, reuses existing
  images by Telegram unique ID, assigns stable image IDs, then completes/removes the pending items.
- Group albums accept uncaptioned follow-on items only when the exact addressed album batch already
  exists. Caption entry edits the original review message back into the single batch control surface,
  avoiding duplicate interfaces. Existing single-image OCR/save behavior and Study capture batches
  are unchanged; albums store only Telegram file references and bounded metadata, never image bytes.
- Local validation so far: Prisma format/validate/generate pass; focused provider/runner/evidence/
  batch/keyboard tests pass (48 assertions plus 6 intentional skips); TypeScript, production build,
  and `git diff --check` pass. Next action: run the complete backend suite, review the final diff and
  migration, update both continuity logs, then commit/push and validate Render if all gates remain green.

### General image albums — ordinary-group routing correction (2026-08-14 SGT)

- Live feedback exposed a routing gap in the local batch implementation: Telegram supplies an album
  caption only on its first item. An addressed first image in an ordinary group opened the durable
  batch, but global mention/privacy routing discarded the later uncaptioned items before the image
  collector could associate them with that batch. This did not affect the dedicated Study collector;
  private albums also already reached the general collector. Production still shows the old per-image
  UI because backend commit `85f6812` has not been pushed/deployed.
- The correction permits an otherwise-unaddressed group image update only when it has an image media
  group ID and an unexpired COLLECTING/REVIEW batch already exists for the exact synthetic group owner,
  chat ID, and Telegram media-group ID. It never creates state from an unaddressed album and does not
  broaden ordinary group listening. Focused private/general-group/Study routing and batch coverage is
  green (50 tests); backend TypeScript, production build, Prisma validation, and `git diff --check` pass.
  The user explicitly authorized always pushing completed changes. Next action: commit and push this
  correction to `main`, then verify the Render migration/deployment, OpenAI analysis availability, and
  production health without exposing the configured API key.

### OpenAI Study analysis + all-mode image albums — deployed (2026-08-14 SGT)

- Backend commits `85f6812` and `3f0b12a` are pushed to `origin/main`. Render completed the additive
  migration/build and production `/health` returned HTTP 200 with version `0.32.0` and commit
  `3f0b12aec519`. The active Study analysis runtime now reads the existing server-side
  `OPENAI_API_KEY`; no Gemini key or laptop worker is involved.
- Private/individual albums use the durable general collector, ordinary groups retain uncaptioned
  follow-on items only for the exact already-open addressed album, and the sealed Study workspace
  continues to use its dedicated durable Study collector. Every mode presents one album review and
  applies one optional shared caption to all images. Sources retain Telegram file references only.
- Validation: 50 focused routing/batch tests, backend typecheck, production build, Prisma validation,
  and diff checks passed. No secret value was read or printed. Operational next action is user-side
  live verification of one multi-image album in each desired mode and one Study analysis request.

### Dashboard reminder editor cleanup — implementation started (2026-08-14 SGT)

- Live mobile feedback shows the shared task editor's empty exact-reminders `fieldset` rendering as
  a large beige panel whose full-width legend collides with its border. The approved correction is a
  compact reminder section: keep the heading, limit, timezone, and add action together; render dated
  rows only when they exist; retain the existing maximum of 20 and unchanged form payload semantics.
- The editor is shared by personal and group task flows, so the correction must remain in that shared
  component. Study-specific settings do not currently expose the same exact-reminder editor and must
  not receive a speculative second implementation.
- The user also reported redundant copy and a UI defect in Personal Settings, but the supplied image
  shows only the task editor. That part is awaiting an exact screenshot or text identification so the
  wrong Settings content is not removed. No privacy/security work is in scope for this pass.
- Next action: implement and test the shared reminder section, then incorporate the Personal Settings
  correction once identified; update this ledger before stopping, and push the completed dashboard.

### Dashboard reminder editor cleanup — local checkpoint (2026-08-14 SGT)

- The shared personal/group `EntityEditor` now renders a compact exact-reminder header with the add
  action, 20-item limit, and active timezone together. The dated-row card is mounted only when one
  or more reminders exist, eliminating the empty beige fieldset and legend/border collision. The
  repeated explanatory callout was removed; persistence and ISO conversion are unchanged.
- A focused source regression test passes, as do changed-file ESLint, non-incremental TypeScript,
  and `git diff --check`. The normal TypeScript command could not replace its existing build-info
  cache under the sandbox, so validation was rerun successfully with `--incremental false`.
- The Personal Settings portion remains intentionally untouched because the supplied screenshot is
  the task editor and does not identify which Settings copy or layout is defective. The user has
  been asked for the exact text or a Settings screenshot. Do not guess, commit, or push this partial
  pass until that remaining defect is identified, corrected, and the combined change is validated.

### Study block controls + Personal reminder settings — scope confirmed (2026-08-15 SGT)

- New screenshots identify the remaining work precisely. Study timetable block creation still uses
  browser-native Module, Type, Day, Starts, Ends, and origin controls; replace them with the existing
  accessible Threadwise choice-popover language, including a branded time chooser that preserves
  existing values. Do not introduce a second visual system.
- In day agenda/laptop view, the entire scheduled block row must open block details rather than only
  its trailing icon. Preserve keyboard semantics and avoid nested interactive controls.
- Personal Settings > Reminders must remove the ornamental “Helpful, never noisy” heading and its
  vague subtitle. Rename and explain regular follow-up frequency separately from the deadline-warning
  window, based on backend semantics: regular cadence covers ordinary/undated follow-ups; deadline
  warnings start N minutes before due and repeat at that near-deadline pace. The daily cap is a safety
  limit for ordinary reminders; deadline warnings bypass it. Fix the stretched cap input by preventing
  unequal helper-copy rows from stretching neighboring controls.
- Complete the already-local compact exact-reminder editor in the same dashboard release. Next action:
  implement shared Study choice controls, agenda-row activation, reminder copy/layout, focused tests,
  full validation, continuity logs, commit/push, and production verification.

### Study block controls + reminder UI cleanup — deployed (2026-08-15 SGT)

- Dashboard commit `dd6e233` is pushed to `origin/main`; GitHub reports the exact Vercel deployment
  successful and the canonical production `/dashboard` route returns HTTP 200.
- Study block creation/editing now uses the shared accessible Threadwise choice popover for module,
  block type, weekday, start/end time, and usual origin. Time choices use 15-minute steps while
  preserving any existing off-step value. Mouse, touch, Escape, Arrow/Home/End navigation, outside
  click, selected-state checks, and focus return use one reusable component.
- The full Study day-agenda schedule row is now a semantic button that opens block details, with the
  former trailing button retained as a non-interactive visual affordance. Vertical and horizontal
  week cards already had full-card activation and remain unchanged.
- Personal Reminder settings no longer show “Helpful, never noisy.” Regular follow-up frequency,
  near-deadline warning interval, message format, and the ordinary-reminder daily safety limit now
  have distinct plain-language explanations grounded in scheduler behavior. Grid alignment prevents
  the daily-limit input from stretching to match neighboring helper copy.
- The shared personal/group exact-reminder editor is compact when empty and mounts its dated rows
  only after Add reminder is used; timezone, optional status, and the 20-item limit remain visible.
- Validation passed: 87/87 dashboard tests, non-incremental TypeScript, full ESLint, optimized Next.js
  production build, and `git diff --check`. The optional local `21st` CLI is not installed, so its
  supplemental deterministic review could not run; direct source review and focused regressions cover
  the reported defects. No backend runtime, schema, repository data, or privacy/security behavior changed.
