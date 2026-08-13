# Threadwise active implementation context

This tracked file is the compaction-safe ledger for active cross-repository work. The
backend and dashboard `CLAUDE.md` files remain the canonical general contributor guides;
this file records the current objective, decisions, evidence, and interruption state.

Update this file at the start of an implementation, after each material checkpoint, and
before stopping. Never store secrets, tokens, embedded images, or large tool output here.

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
