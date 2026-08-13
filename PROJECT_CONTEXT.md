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

- `src/services/geminiStudyAnalysis.ts` currently queues work for local worker readiness,
  limits evidence to recent sessions/resources, ignores explicit session-resource edges,
  and explicitly instructs the model not to grade correctness. This conflicts with the
  newly confirmed direction and must be replaced, not cosmetically renamed.
- `src/services/studyCanvas.ts` currently requests `/courses` and
  `/courses/:id/assignments`; it has no module/file/page ingestion.
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

## Interruption protocol

Before any implementation begins, add the approved scope and exact files/migrations expected.
After each checkpoint, record completed work, tests run, current Git status, unresolved risks,
and the next command/action. Never mark incomplete work complete.
