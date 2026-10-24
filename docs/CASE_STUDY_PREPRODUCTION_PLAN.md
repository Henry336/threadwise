# Threadwise Case Study — preparation and production dossier

Prepared: 2026-10-02. Production was explicitly authorized by Henry on the same date.

## Publication checkpoint — 2026-10-02

Completed three source-pinned educational volumes: Main Textbook (115 pages), Workbook
(46 pages, 108 core exercises), and Suggested Solutions (46 pages, every exercise ID matched).
Each includes the common glossary; the textbook has 36 chapters, vector figures, a complete
synthetic MiniThreadwise lab, source/support coverage inventory, alternatives, reuse recipes,
historical limits, and primary references. Complex database/editor/diagram sections include
additional hands-on guidance. The original sections below preserve the preproduction plan;
the present checkpoint supersedes their earlier not-yet-authorized/not-yet-installed statuses.

Validation: 35 runnable TypeScript chapter listings and MiniThreadwise compiled/executed
successfully with throwing assertions. Workbook/solution IDs match all 108 questions.
All 207 PDF pages passed mechanical content, text-bound, glossary, bookmark, and link checks.
Every chapter-opening page was visually reviewed in contact sheets; dense code/glossary and
companion samples were additionally inspected. This is not a fresh product test suite, an
exhaustive line-by-line audit, or a live-production certification.

Build workspace: D:\CodexData\Temp\ThreadwiseCaseStudy-build. Isolated Python environment:
D:\CodexData\Temp\threadwise-case-study-env. Desktop publication target:
C:\Users\Henry\Desktop\Threadwise Case Study (Windows' actual Desktop known folder).
Rebuild source, educational lab, requirements, and validation manifests accompany the PDFs
under its Source subfolder. No product runtime code, credentials, migrations, or deployments
were changed. Both pinned repository HEADs remained unchanged at final verification.

## 1. Agreed brief

Henry is comfortable programming but new to TypeScript, databases, and web architecture. Teach the complete system, with reusable components in depth, not merely a feature tour. Include Individual, Group, and Study modes without treating Study as the entire product.

Future deliverables:
- Threadwise — Main Textbook.pdf
- Threadwise — Workbook.pdf
- Threadwise — Suggested Solutions.pdf

Destination reported by Windows' Desktop known-folder API: C:\Users\Henry\Desktop\Threadwise Case Study. This folder was absent during preparation and has not been created. A OneDrive Desktop also exists, but do not silently substitute it for the OS-reported Desktop.

Each PDF needs its own glossary, useful navigational links, clear code, explanatory visuals, and cross-references. Original conversational prose, occasional relevant humour, and selectively bolded takeaways should aid understanding and skimming. Do not imitate copyrighted wording or the For Dummies branding.

No hard page cap. Depth and the ability to rebuild take priority over making a short architecture report. Avoid bloating the set by printing every production file verbatim.

## 2. Evidence baseline and honesty rules

Canonical backend: D:\CodexProjects\Threadwise
- Local HEAD: 778370398f235e27850c8508bb8d206ac95e6fb3
- Package version: 0.35.7
- Runtime: Node.js; TypeScript targeting ES2022/CommonJS; Fastify; grammY; Prisma 6/PostgreSQL.
- Local reachable history: 268 commits at inspection.

Canonical dashboard: D:\CodexProjects\threadwise-dashboard
- Local HEAD: 5ecfe5fe6edc887505aaa6b5111d892180dba6bc
- Package version: 0.10.2
- Runtime: Next.js 16/App Router; React 19; TypeScript; Tailwind 4; Tiptap 3; Mermaid 11; DOMPurify.
- Local reachable history: 131 commits at inspection.

D:\CodexData\WindowsDocuments\Codex\Threadwise is an older workspace location, not the chosen source baseline.

Preparation inspected both repository entry instructions, file/schema inventories, architecture/onboarding/product context, sampled history, and representative implementation paths. This is NOT a claim that every line, every commit, or the live deployment has been audited. No production API/database credentials or private content were read. No fresh build/test/deployment was run.

Before writing each chapter:
1. Trace its real entry points, dependencies, reads/writes, permissions, and error paths.
2. Read the relevant full implementation and tests, not only exports or comments.
3. Record source commit, file, and symbol for each production-specific claim.
4. Reconcile code/document disagreement; use current code for behaviour and journal/history for historical rationale.
5. Distinguish documented intent, observed implementation, inference, and recommended alternative.
6. Do not portray code existence, a historical passing test count, or a release log as proof of present live health.

Before publication, compare both HEADs with this baseline. If another agent changed a relevant component, update its source tracing and dependent examples deliberately rather than mixing snapshots.

Use four labels throughout:
- Production excerpt: copied/adapted from a named pinned source.
- Learning implementation: reduced but runnable, with simplifications stated.
- Pseudocode: explains an algorithm but is not offered as runnable.
- Proposed alternative: useful design, not claimed to be Threadwise's implementation.

## 3. Important discoveries to carry into the books

- Parsing is layered: commands, active conversation state, scope, deterministic signals, optional AI, ambiguity/review, and correction. An action verb is not permission to silently save a todo.
- Default heuristic embeddings are hashed token vectors, not learned semantic representations. Explain lexical similarity and collisions. Do not promise synonym understanding.
- Classification confidence is a heuristic score unless separately calibrated; it is not a measured probability of truth.
- plannedFor, dueAt, and reminderAt express different things. An uncompleted planned day is carryover, not automatically a missed deadline.
- Durable drafts are scoped and expire; batch saving uses transactions. Preview is not persistence.
- Telegram update claiming suppresses duplicates, but claim-before-work has a crash window. Teach delivery semantics and recovery rather than promising universal exactly-once execution.
- A dashboard backend-for-frontend signs short-lived server requests. Browser identity fields are not authorization.
- Study is currently owner-gated and bound to a restricted group. Public multi-tenant Study documents include planning, not proof of released public access.
- Personal rich notes reuse a shared writer while retaining canonical Personal Note records.
- Application field encryption is not end-to-end encryption. The application server can decrypt; metadata and searchable derived fields require a separate threat-model explanation.
- Diagram safety includes strict Mermaid settings, native SVG labels, sanitization, input budgets, and timeout limits. Removing the sanitizer is not the rendering fix.
- Google Calendar mirroring is one-way and uses stable event identities, persisted links, bounded retries, and periodic reconciliation. Network success and local success are separate events.
- The one-day Calendar error concerns weekday conventions/occurrence calculations, not an excuse to label every date bug a timezone bug.
- Current studyTransit.ts still calls legacy GET /api/... through transitGet, not the proposed locked /api/v1 POST-journeys contract. Show the implemented adapter first; v1 migration is an explicit exercise/alternative, not a shipped claim.
- Rich editing must preserve focus/caret and separate local edits from genuine external updates. Autosave is a synchronization problem, not just a timer.
- Visible-client synchronization and unchanged-provider updates have real database/network costs.
- September incident evidence identified multiple sources of recurring work: idle analysis polling, reminder duplicate churn, Calendar replay/queue behaviour, dashboard revision polling, and unchanged Canvas writes. Aggregate NAT metrics cannot attribute every byte to one cause.
- Frozen Expenses/Excel/Microsoft code belongs in a labelled historical appendix, not an advertised active feature.
- Beacon moderation and the owner-authorized local worker/file courier are separate reusable subsystems; include them instead of overlooking them because they are not ordinary dashboard cards.

Known documentation drift: backend architecture version header lagged runtime; a dashboard architecture description of 30-second revision checks lagged the backend's two-minute watcher. Reconcile exact current defaults before book claims. July journal entries explicitly include reconstruction; preserve this distinction.

## 4. Learning path and chapter map

Teach foundations before dependent tools. Show a one-page system map early for orientation, but reserve the final integration chapter for a full reconstruction after the components are understood.

| Ch. | Topic and build outcome | Threadwise source anchors / reuse |
|---|---|---|
| 01 | Read the system map, distinguish process, package, service, API, and database | main.ts; server.ts; dashboard app; reuse: any multi-channel service |
| 02 | Bridge existing programming into JavaScript/TypeScript: runtime versus type checks, structural typing, unions, narrowing, modules | tsconfig/package scripts; ai/types.ts; reuse: typed boundaries |
| 03 | Build asynchronous HTTP calls with promises, timeouts, cancellation, and event-loop reasoning | transitGet; external provider adapters; reuse: any network client |
| 04 | Model data with SQL before Prisma: keys, relations, nulls, constraints, indexes, queries, migrations | prisma/schema.prisma; db/connectionUrl.ts; reuse: relational applications |
| 05 | Construct a small Fastify service and compose dependencies/configuration safely | main.ts; server.ts; config/env.ts if verified; reuse: service skeleton |
| 06 | Receive Telegram updates: webhooks, callbacks, authentication, update claims, safe responses | telegramWebhookAuth; bot/index; telegramUpdates; reuse: chat integrations |
| 07 | Build a scoped domain service, CRUD, soft archive, undo, and audit | tasks; notes; itemEdits; archives; undo; reuse: recoverable record operations |
| 08 | Make writes atomic and replay-aware: transactions, unique constraints, concurrency, crash windows | taskCaptureDrafts; sharedRateLimit; replay guards; reuse: checkout/import workflows |
| 09 | Interpret intent without hijacking conversation: routing order, explicit lanes, signals, reviews, correction | naturalLanguage; naturalCommands; deterministic; captureReview; reuse: intake/helpdesk |
| 10 | Parse dates and task lists safely: grammar, punctuation, continuation paragraphs, ambiguity, timezone | taskPlanning; dates; timezones; reuse: batch capture/scheduling |
| 11 | Build durable conversational drafts: Add more, editing, expiry, atomic save, state transitions | taskCaptureDrafts; menuInputs; pendingCaptures; reuse: multi-step forms |
| 12 | Build Today across modes: planned day/deadline/reminder separation, carryover, ordering, completion, pagination | dailyAgenda; today; today-planner; reuse: personal/team work views |
| 13 | Build reminders as bounded occurrence state machines with acknowledgements, quiet hours, logical caps | reminders; studyReminders; taskReminderSchedules; reuse: appointments/alerts |
| 14 | Authorize Group work and assignment using identity, membership, current roles, and visibility | groupWorkspaces; groupTaskPolicy; groupCollaboration; reuse: shared SaaS domains |
| 15 | Coordinate group availability and proposed events without exposing individual data unnecessarily | groupScheduling; group-scheduling; reuse: meeting polls |
| 16 | Construct Study's domain: modules, weeks, deadlines, focus sessions, mistakes and evidence | study; studyResources; studySessions; exact exports verified later |
| 17 | Calculate timetables and conflicts: recurrence, exceptions, deletion scopes, half-open intervals, overlap lanes | studySchedule; study-timetable; study-week; reuse: booking/calendar views |
| 18 | Capture long notes from conversation and preserve provenance | noteCaptureSessions; Study capture sessions; notes; reuse: journaling/meeting capture |
| 19 | Build the rich-note writer: document model, Markdown conversion, editing, indentation, drafts, revision conflicts | study-note-editor; personal-note-editor; study-editor-sync; note-draft-api |
| 20 | Render diagrams safely and make aliases/layout portable | study-mermaid; templates; markdown-security; reuse: docs/learning editors |
| 21 | Retrieve what was saved: filters, ranking, token vectors, similarity limits, deep links, complete views | search; vector; listPagination; links; reuse: recall/search layers |
| 22 | Process media: image batches, bounded OCR, stored media, voice jobs, fresh Telegram file access | imageOcr; imageUploadBatches; voiceTranscription; reuse: document intake |
| 23 | Keep AI replaceable: typed provider interface, deterministic fallback, caching, budgets, structured validation | ai/*; OpenAI/Gemini services; reuse: resilient optional intelligence |
| 24 | Run durable background work: claims, leases, single-flight, retry/backoff, cancellation, recovery | studyAnalysisRunner; Gemini jobs; voice/courier jobs; reuse: background pipelines |
| 25 | Import external systems by reconciliation, not append: Canvas/NUSMods freshness and stable identity | studyCanvas; studyNusmods; reuse: external data mirrors |
| 26 | Build OAuth and Calendar mirroring: consent, encrypted tokens, event identity, recurrence, failure recovery | googleCalendar; studyCalendar; studyRoutes; reuse: one-way sync |
| 27 | Put transport behind an adapter: places, journeys, privacy, caches, rate limits, upstream uncertainty | studyTransit; proposed NextBus v1 separately; reuse: location services |
| 28 | Construct the dashboard boundary: React state, Next.js routes, BFF, DTOs, signed requests, sessions, deep links | proxy; threadwise-api; auth; route; browserSessions; reuse: web clients |
| 29 | Make UI lifecycle reliable: keyboard/mobile accessibility, dialogs, scroll locks, drag ordering, SSE, offline/private cache rules | body-scroll-lock; dashboard-live-sync; browser-privacy-lifecycle; PWA |
| 30 | Protect content and ownership: threat model, encryption/AAD, key lifecycle, blind indexes, rate limits, retention | security/*; privacyRetention; reuse: private multi-user records |
| 31 | Build Beacon moderation as a separate policy/control plane | community/*; docs/BEACON; reuse: community tooling |
| 32 | Build an authorized laptop worker and file courier: bounded capabilities, paths, secrets, approvals, worktrees | codexWorker; codex* services; fileCourier*; reuse: remote local-work automation |
| 33 | Test what users actually experience: parser/service/HTTP/browser gates, synthetic providers, fake clocks, failure injection | *.test.ts; e2e; acceptance suites; reuse: executable requirements |
| 34 | Ship and operate: additive migrations, CI, Render/Vercel boundaries, environment separation, monitoring, cost, backup | scripts; .github; render.yaml; repair runbooks; reuse: safe releases |
| 35 | Learn from Threadwise's evolution: UX feedback, parser reversal, editor bugs, Calendar shift, bandwidth incident, refactoring | product journal; Git history; changelog; audits; reuse: evidence-led engineering |
| 36 | How it all comes together: reconstruct the complete system and defend its decisions | five end-to-end traces and independent capstone below |

Appendices: common glossary; source/version map; selected schema and API reference; reusable-component extraction recipes; historical/frozen integration gallery (including Gmail only after verifying its lifecycle); current limitations and deferred architecture.

Anchors are navigation leads, not proof that every name is current. Some broad names above require resolving their exact file/symbol before chapter drafting. The inventory below gives the complete tracked file baseline for that verification.

## 5. Required component chapter pattern

1. Outcome: "After this chapter, you can build..." with a measurable artifact.
2. Prerequisites: link backward to already taught ideas; offer a short refresher.
3. User problem and smallest concrete example, before introducing an abstract label.
4. Diagram of responsibility, data, and trust boundary; explain it in nearby prose.
5. Inputs/outputs, data model, invariants, and a state table where appropriate.
6. Build a small version step by step: filenames, dependencies, full incremental edits, run commands, expected output.
7. Pause-and-predict checks between steps, then remove scaffolding.
8. Trace the actual Threadwise implementation and the production additions.
9. Explain documented decisions, alternatives, tradeoffs, and where the decision would change.
10. Reuse recipe: dependencies to keep/remove, boundary interface, data/authorization adaptation, tests.
11. Real-world pattern comparison supported by primary docs; do not imply another company runs Threadwise's exact design.
12. Failure, security/privacy, performance, and cost considerations proportional to the component.
13. Minimal tests plus edge cases and one adversarial case.
14. Rebuild-from-scratch challenge with observable acceptance criteria.
15. Bold skimmable takeaways, brief local term definitions, and matching workbook references.

A component is not "rebuildable" if crucial setup or helper logic is hidden behind "just use this library." Explain the library's job and teach the underlying idea; distinguish building on a library from rebuilding the library itself.

## 6. Teaching design

Use worked examples alternating with independent problems, not several pages of examples followed by one enormous project. Combine simple explanatory visuals with text; revisit earlier ideas in later chapters. Foundation practice should connect concrete code/results to abstract principles.

Align the exercise to the stated outcome: a chapter promising implementation must test implementation, not merely ask the reader to define a term. Add short retrieval checks, code tracing, debugging, and explaining why an alternative fails.

Use two complementary routes:
- Main route: one cumulative Mini-Threadwise with mock channels/providers, then a disposable development database.
- Extraction route: isolated reusable components with explicit interfaces, independent examples, and adapters.

Avoid overwhelm: a small correct version first, a "production adds..." section second, and an optional advanced stretch third. This is a learning scaffold, not advice to ship an insecure toy implementation.

Theory/explanation and hands-on instructions should be visually distinct. Keep reference lookup material in appendices; do not interrupt a first build with a catalogue of every option.

## 7. Workbook contract

Stable IDs: TW-C09-E01; repeat exact IDs in textbook references and solutions. Each chapter includes:
- Explain/recall without consulting the book.
- Predict a code trace or state transition.
- Diagnose and fix a realistic defect.
- Complete a partly scaffolded implementation.
- Build the component independently against a contract.
- Adapt it to a different product/domain.
- Optional stretch: concurrency/security/performance/design defence.

For each exercise provide objective, prerequisites, input fixtures, constraints, expected observable behaviour, allowed tools, hints separated from questions, and a completion checklist. Estimated effort is approximate, not a speed contest.

Synthetic fixture examples must include:
- "Meet mom, dad" and continuation "Reason:" paragraphs.
- planned day versus due date versus reminder; ambiguous dates.
- timezone/DST/midnight and recurrence exceptions.
- duplicated Telegram updates, callback replay, restart mid-draft.
- one invalid batch item and rollback.
- cross-owner/workspace reads and writes; member without private bot access.
- overlapping and adjacent blocks; all deletion scopes.
- autosave responses out of order, conflict, focus/caret continuity, logout clearing.
- Mermaid labels, malformed aliases, malicious inputs, budgets.
- Calendar create success followed by timeout; 404, revoked OAuth, retry exhaustion.
- no-op Canvas import and bounded statement/provider request counts.
- stale routes, rate limits, missing media, AI outage.
- encryption key mismatch, retention, unsafe file paths, unauthorized local capabilities.

No real tokens, accounts, calendars, private notes, or production database are required for core exercises. Explicit integration opt-in comes only after mocked paths and a disposable setup.

## 8. Suggested solution book contract

For every workbook ID:
- Restate the essential requirement briefly.
- Show a suggested solution with reasoning and a worked trace.
- Include tests/expected output and explicit edge cases.
- Explain likely incorrect approaches.
- Where genuinely valid, show an alternative and when it is preferable.
- Give a rubric for open-ended design answers, not a fictional single perfect answer.
- State which simplifications would prevent production readiness.
- Keep hints/progression available before revealing full solutions.

Do not introduce a concept needed to solve an exercise only in the solution book.

## 9. Final integration chapter and capstone

Show five full request journeys:
1. User text -> route/review -> durable task draft -> transaction -> Today -> completion.
2. Telegram notes -> capture session -> note/draft -> rich editing -> autosave -> filing -> search.
3. Study import -> reconciliation -> timetable occurrence -> overlap -> Calendar queue -> acknowledgement-aware reminder.
4. Authenticated dashboard -> session/BFF -> signed request -> principal/scope -> DTO -> visible update.
5. Authorized Telegram request -> durable worker job -> laptop capability boundary -> safe result delivery.

For each journey annotate process boundaries, source of truth, data writes, authorization, retry points, privacy exposure, and cost. Include representative failure traces, not only happy arrows.

Capstone: rebuild a smaller complete system from a specification without copying production files, then adapt a reusable module to a new project. Test both successful behaviour and the safety invariants. Finish with "explain your own app" prompts and a component dependency map.

## 10. Development journey evidence plan

Use git history + journal + changelog + implementation reports, not chat recollection alone.
- Initial July: bot, persistence, note/task capture, reminders, archive/undo, early AI adapters.
- July web/group development: dashboard boundary, scheduling, integration lifecycle.
- August Study and privacy: timetable/import/focus/resources, evidence-bound analysis, encryption/gates.
- August Today/notes: planned-day model, drafts, cross-mode dialogue, rich writer.
- September capture correction: explicit todo lane, reversible classifications.
- September diagrams/timetable sync: safe rendering, aliases, recurrence mirroring, bounded alerts.
- September operational repairs: idle work, Calendar backlog/reconciliation, Canvas no-op writes, weekday preservation.

For each case study: user friction -> plausible hypotheses -> actual evidence -> defect mechanism -> fix -> tests -> tradeoff -> residual uncertainty. Clearly label reconstructed early rationale. Do not invent the author's original thoughts from a commit subject.

## 11. Visual and print plan

Default A4, screen/print friendly:
- Searchable/selectable text, embedded fonts, linked TOC and bookmarks.
- Body text with comfortable line length; monospaced code with no clipped lines.
- Vector diagrams preferred for sequence/state/entity/component relationships.
- Labels explain the diagram without requiring colour; grayscale-readable figures.
- Code chunks short enough to discuss; long listings split intentionally with filenames.
- No screenshot-only code. Synthetic UI figures only if necessary.
- Consistent headings, chapter/exercise IDs, page numbering, captions, glossary terms.
- Workbook answer space and checklists; avoid tiny fonts to force everything onto a page.
- Use selective bold sentences for key ideas, not an entire sea of bold.

Source Markdown/code/diagram assets should remain reproducible locally, but the requested handoff is three PDFs. Do not create standalone LaTeX unless a specific production decision calls for it; if it does, follow the app's built-in LaTeX workflow.

## 12. PDF/tooling readiness

No tooling installed during preparation.
- Node is available.
- Default Python points into an unrelated Hermes environment; do not modify that environment.
- That Python lacked ReportLab, pypdf, PyMuPDF, and WeasyPrint at inspection.
- Pandoc/Typst were not located through Get-Command.
- Bundled workspace dependency resolver returned an unavailable-tool message; do not treat it as a working toolchain.

First production gate: locate a supported bundled runtime or create an isolated project environment for one PDF pipeline and smoke-test a tiny sample. Validate fonts, links/bookmarks, page breaks, code wrapping, and diagram embedding before producing hundreds of pages. Rendering itself is not yet authorized in this research task.

Build one volume/chunk at a time; avoid concurrent renderers or browser instances. Run only relevant educational code checks serially at production time, not entire product suites in parallel. Do not start a local bot with real credentials.

## 13. Publication gates

- Every chapter has an outcome, prerequisites, runnable checkpoints, design alternatives, reuse, and independent reconstruction.
- Every exercise maps to taught material and a matching solution; no missing/duplicate IDs.
- Production-specific facts tie to pinned files/symbols; scope/status claims are truthful.
- All production modules in the source inventory map to a chapter/appendix or have an explicit exclusion reason.
- No private material, secrets, live account identifiers, or credentials in examples/assets/PDFs.
- Executable examples run against synthetic fixtures in an isolated learning workspace.
- Diagrams/captions/code compile/render and fit pages; verify representative dense and long pages.
- Check all pages mechanically for overflow/missing content and visually sample every chapter, expanding inspection for anomalies.
- Glossary definitions do not rely on unexplained jargon; identical definitions across all three books.
- Final integration chapter matches the earlier components and workbook capstone.
- Extract PDF text and check TOC, page count, exercise IDs, glossary, and expected code/labels.
- Complete this final gate before claiming the books are finished.

## 14. Research bibliography and use

Pedagogy:
- IES What Works Clearinghouse, Organizing Instruction and Study to Improve Student Learning: https://ies.ed.gov/ncee/wwc/PracticeGuide/1 — worked examples, retrieval, spacing, explanatory graphics, deep why questions.
- Carnegie Mellon Eberly Center, assessment/objective/instruction alignment: https://www.cmu.edu/teaching/assessment/basics/alignment.html — exercises should assess the promised skill.
- CMU learning objectives: https://www.cmu.edu/teaching/designteach/design/learningobjectives.html
- Diataxis tutorials: https://diataxis.fr/tutorials/ — guided practical learning; keep explanation/reference distinct.

Primary technical starting references (check exact version against the lockfiles before adapting code):
- TypeScript OOP bridge: https://www.typescriptlang.org/docs/handbook/typescript-in-5-minutes-oop.html
- React Effects and cleanup: https://react.dev/learn/synchronizing-with-effects
- Prisma v6 transactions: https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions
- Google recurring events: https://developers.google.com/workspace/calendar/api/guides/recurringevents
- OWASP authorization: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- Stripe idempotent requests: https://docs.stripe.com/api/idempotent_requests
- AWS retry/backoff pattern: https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/retry-backoff.html

These support teaching patterns and external technical explanations, not claims that Threadwise uses another company's implementation. Paraphrase narrowly and attribute; do not reproduce copyrighted tutorials or illustrations. Add chapter-specific official references during detailed source tracing.

## 15. Next steps — after explicit production authorization

1. Recheck repository status/HEADs and coordinate around the other agent without stopping it.
2. Validate an isolated PDF toolchain and a typography/figure sample.
3. Complete per-component source tracing and the chapter coverage ledger.
4. Develop and test the cumulative learning scaffold.
5. Write coordinated chapter/workbook/solution units; validate them incrementally.
6. Add final integration, source references, and glossaries.
7. Compile serially, inspect, repair, and place the three PDFs on the OS Desktop.

No product implementation, migration, API call, deployment, new agent, install, or heavy test/build is part of the present preparation task.

## Appendix A — tracked source/support inventory

This is a coverage checklist, NOT a statement that every file was read. Lists exclude .test/.spec filenames; test suites still need chapter mapping. Documentation/migrations/scripts/public assets are included to prevent code-only blind spots. Source paths are relative to the pinned repository roots above.


### Backend

- `.github/workflows/ci.yml`
- `.github/workflows/migrate-supabase-region.yml`
- `docs/ARCHITECTURE.md`
- `docs/BANDWIDTH_REPAIR_2026-09-12.md`
- `docs/BANDWIDTH_REPAIR_2026-09-15.md`
- `docs/BEACON.md`
- `docs/CONTENT_ENCRYPTION.md`
- `docs/COURSEMOLOGY_INTEGRATION_RESEARCH.md`
- `docs/DEVELOPER_ONBOARDING.md`
- `docs/GATE3A_RECOVERY_EVIDENCE.md`
- `docs/OWNER_FILE_COURIER.md`
- `docs/PHASE1_3_TODAY_MORNING_UPDATE.md`
- `docs/PHASE2_CROSS_MODE_EXPERIENCE.md`
- `docs/PHASE2_TODAY_INTERACTIONS_IMPLEMENTATION_REPORT.md`
- `docs/PHASE3_PRIVACY_RUNBOOK.md`
- `docs/PHASE3_TODAY_DELIVERY_NOTES_IMPLEMENTATION_REPORT.md`
- `docs/PHASE4_STUDY_SCALE_RUNBOOK.md`
- `docs/POST_PHASE7_CODEBASE_AUDIT.md`
- `docs/POST_RELEASE_CODE_UI_SECURITY_AUDIT_2026-08-31.md`
- `docs/PRIVATE_CODEX_IMPLEMENTATION_NOTES.md`
- `docs/PRODUCT_JOURNAL.md`
- `docs/PUBLIC_STUDY_ARCHITECTURE.md`
- `docs/PUBLIC_STUDY_ROLLOUT.md`
- `docs/PUBLIC_STUDY_THREAT_MODEL.md`
- `docs/SECURITY_PHASE2_PRIVACY_INSPECTION.md`
- `docs/SECURITY_PHASE6_ASSURANCE.md`
- `docs/SECURITY_REMEDIATION_ROADMAP.md`
- `docs/STUDY_TIMETABLE_SYNC_OPERATIONS.md`
- `docs/SUPABASE_REGION_MIGRATION.md`
- `docs/TELEGRAM_REMOTE_OPERATOR.md`
- `docs/TODAY_TASKS_AND_NOTE_SESSIONS_PRODUCT_SPEC.md`
- `docs/VOICE_AND_TONE.md`
- `docs/VOICE_NOTE_CAPTURE.md`
- `package.json`
- `prisma/migrations/20260705130000_init/migration.sql`
- `prisma/migrations/20260706170000_add_notes/migration.sql`
- `prisma/migrations/20260706210000_add_processed_telegram_updates/migration.sql`
- `prisma/migrations/20260707010000_add_pins_and_archives/migration.sql`
- `prisma/migrations/20260707020000_add_note_merge_and_archive_metadata/migration.sql`
- `prisma/migrations/20260707030000_add_pending_item_edits/migration.sql`
- `prisma/migrations/20260707040000_add_search_edit_and_due_nudge/migration.sql`
- `prisma/migrations/20260707110000_add_gmail_integration/migration.sql`
- `prisma/migrations/20260707150000_raise_reminder_cap_default/migration.sql`
- `prisma/migrations/20260708110000_add_task_assignees_and_recurrence/migration.sql`
- `prisma/migrations/20260712180000_add_google_calendar_oauth/migration.sql`
- `prisma/migrations/20260712210000_add_image_expenses_excel/migration.sql`
- `prisma/migrations/20260712220000_add_yearly_recurrence/migration.sql`
- `prisma/migrations/20260712233000_add_currency_ocr_preferences/migration.sql`
- `prisma/migrations/20260713003000_add_pending_bulk_actions/migration.sql`
- `prisma/migrations/20260713010000_add_multi_assignees_dm_nudges/migration.sql`
- `prisma/migrations/20260714120000_add_stored_images_monthly_recurrence/migration.sql`
- `prisma/migrations/20260714180000_add_image_search_metadata/migration.sql`
- `prisma/migrations/20260717123000_normalize_quiet_hours/migration.sql`
- `prisma/migrations/20260718010000_add_stored_image_pinning/migration.sql`
- `prisma/migrations/20260719120000_add_group_workspaces/migration.sql`
- `prisma/migrations/20260719183000_add_group_collaboration/migration.sql`
- `prisma/migrations/20260722180000_integration_lifecycle/migration.sql`
- `prisma/migrations/20260723190000_add_group_availability/migration.sql`
- `prisma/migrations/20260723230000_add_note_capture_sessions/migration.sql`
- `prisma/migrations/20260729110000_add_private_codex_mode/migration.sql`
- `prisma/migrations/20260729170000_add_codex_task_selection/migration.sql`
- `prisma/migrations/20260729210000_add_gemini_idea_intelligence/migration.sql`
- `prisma/migrations/20260729223000_add_trusted_codex_publishing/migration.sql`
- `prisma/migrations/20260729233000_add_owner_file_courier/migration.sql`
- `prisma/migrations/20260730001000_add_voice_note_capture/migration.sql`
- `prisma/migrations/20260803043000_add_group_task_imports/migration.sql`
- `prisma/migrations/20260803130000_group_undated_reminder_cadence/migration.sql`
- `prisma/migrations/20260804030000_add_private_study_mode/migration.sql`
- `prisma/migrations/20260804183000_add_codex_remote_operator/migration.sql`
- `prisma/migrations/20260805143000_study_travel_departures/migration.sql`
- `prisma/migrations/20260805183000_add_codex_job_dependencies/migration.sql`
- `prisma/migrations/20260805193000_legacy_group_item_edits/migration.sql`
- `prisma/migrations/20260806030000_add_beacon_community_bot/migration.sql`
- `prisma/migrations/20260806050000_add_beacon_private_controls/migration.sql`
- `prisma/migrations/20260806063000_add_beacon_offence_ledger/migration.sql`
- `prisma/migrations/20260809110000_simplify_group_task_assignments/migration.sql`
- `prisma/migrations/20260810190000_study_archive_visibility/migration.sql`
- `prisma/migrations/20260810213000_study_capture_context_and_pending_ocr/migration.sql`
- `prisma/migrations/20260811183000_add_content_search_tokens/migration.sql`
- `prisma/migrations/20260811190000_study_temporary_origins/migration.sql`
- `prisma/migrations/20260812165000_add_nusmods_schedule_source/migration.sql`
- `prisma/migrations/20260812193000_reconcile_nusmods_schedule_duplicates/migration.sql`
- `prisma/migrations/20260812213000_expand_study_deep_work_sessions/migration.sql`
- `prisma/migrations/20260812231500_add_gemini_study_analysis_jobs/migration.sql`
- `prisma/migrations/20260813113000_add_study_capture_batches/migration.sql`
- `prisma/migrations/20260813182500_canvas_sync_diagnostics_and_materials/migration.sql`
- `prisma/migrations/20260813190500_durable_task_reminders/migration.sql`
- `prisma/migrations/20260813203000_study_evidence_analysis/migration.sql`
- `prisma/migrations/20260814003000_add_general_image_upload_batches/migration.sql`
- `prisma/migrations/20260817090000_study_markdown_notes/migration.sql`
- `prisma/migrations/20260817170000_phase3_privacy_remediation/migration.sql`
- `prisma/migrations/20260817190000_phase4_study_scalability/migration.sql`
- `prisma/migrations/20260818130000_dashboard_replay_protection/migration.sql`
- `prisma/migrations/20260818143000_shared_rate_limits/migration.sql`
- `prisma/migrations/20260821120000_personal_overview_quotes/migration.sql`
- `prisma/migrations/20260824120000_phase1_study_reliability/migration.sql`
- `prisma/migrations/20260825120000_phase2_cross_mode_experience/migration.sql`
- `prisma/migrations/20260828120000_today_planning_foundation/migration.sql`
- `prisma/migrations/20260828180000_phase3_today_delivery_notes/migration.sql`
- `prisma/migrations/20260829090000_personal_today_ordering/migration.sql`
- `prisma/migrations/20260831090000_study_note_drafts/migration.sql`
- `prisma/migrations/20260831150000_personal_note_drafts/migration.sql`
- `prisma/migrations/20260831190000_pin_study_modules/migration.sql`
- `prisma/migrations/20260831220000_dashboard_browser_sessions/migration.sql`
- `prisma/migrations/20260903130000_unified_capture_reminder_prompts/migration.sql`
- `prisma/migrations/20260903190000_add_study_calendar_and_reminder_sequences/migration.sql`
- `prisma/schema.prisma`
- `render.yaml`
- `scripts/doctor-codex-worker.ps1`
- `scripts/enforce-privacy-retention.ts`
- `scripts/inspect-privacy-aggregates.ts`
- `scripts/install-codex-worker-startup.ps1`
- `scripts/migrate-content-encryption.ts`
- `scripts/migrate-deploy.mjs`
- `scripts/migrate-phase3-privacy.ts`
- `scripts/migrate-phase4-study-scale.ts`
- `scripts/migrate-render-to-supabase.ps1`
- `scripts/migrate-supabase-seoul-to-singapore.ps1`
- `scripts/ocr-smoke.ts`
- `scripts/run-codex-worker.ps1`
- `scripts/scan-tracked-secrets.mjs`
- `scripts/stop-codex-worker.ps1`
- `scripts/update-codex-worker.ps1`
- `src/ai/cachedProvider.ts`
- `src/ai/deterministic.ts`
- `src/ai/heuristicProvider.ts`
- `src/ai/index.ts`
- `src/ai/json.ts`
- `src/ai/openaiProvider.ts`
- `src/ai/resilientProvider.ts`
- `src/ai/types.ts`
- `src/bot/activeLists.ts`
- `src/bot/calendarReplies.ts`
- `src/bot/callbacks.ts`
- `src/bot/captureCorrections.ts`
- `src/bot/captureReview.ts`
- `src/bot/codex.ts`
- `src/bot/codexAttachmentBatch.ts`
- `src/bot/commandMenus.ts`
- `src/bot/commands.ts`
- `src/bot/controlCards.ts`
- `src/bot/dailyBriefs.ts`
- `src/bot/ephemeral.ts`
- `src/bot/errorResponses.ts`
- `src/bot/files.ts`
- `src/bot/formatters.ts`
- `src/bot/geminiIdeas.ts`
- `src/bot/groupRouting.ts`
- `src/bot/groupTopics.ts`
- `src/bot/help.ts`
- `src/bot/imageMessages.ts`
- `src/bot/index.ts`
- `src/bot/interactions.ts`
- `src/bot/itemCards.ts`
- `src/bot/keyboards.ts`
- `src/bot/links.ts`
- `src/bot/menu.ts`
- `src/bot/menuInputs.ts`
- `src/bot/naturalCommandParsing.ts`
- `src/bot/naturalCommands.ts`
- `src/bot/naturalLanguage.ts`
- `src/bot/navigationState.ts`
- `src/bot/notePagination.ts`
- `src/bot/noteSessions.ts`
- `src/bot/quietAcknowledgements.ts`
- `src/bot/scheduling.ts`
- `src/bot/storedImageReplies.ts`
- `src/bot/study.ts`
- `src/bot/studyCapture.ts`
- `src/bot/taskImports.ts`
- `src/bot/taskMentions.ts`
- `src/bot/today.ts`
- `src/bot/todayExpiry.ts`
- `src/bot/voiceCapture.ts`
- `src/codexTaskSync.ts`
- `src/codexWorker.ts`
- `src/community/controlAccess.ts`
- `src/community/index.ts`
- `src/community/policy.ts`
- `src/community/registration.ts`
- `src/community/store.ts`
- `src/community/ui.ts`
- `src/config/codexTaskSyncPublicKey.ts`
- `src/config/env.ts`
- `src/dashboard/auth.ts`
- `src/dashboard/browserSessions.ts`
- `src/dashboard/capture.ts`
- `src/dashboard/collaboration.ts`
- `src/dashboard/data.ts`
- `src/dashboard/ideaBrief.ts`
- `src/dashboard/overviewQuotes.ts`
- `src/dashboard/personalNoteDrafts.ts`
- `src/dashboard/publicKey.ts`
- `src/dashboard/realtime.ts`
- `src/dashboard/route.ts`
- `src/dashboard/schemas.ts`
- `src/dashboard/snapshot.ts`
- `src/dashboard/study.ts`
- `src/dashboard/studyRoutes.ts`
- `src/dashboard/today.ts`
- `src/dashboard/workspaces.ts`
- `src/db/connectionUrl.ts`
- `src/db/prisma.ts`
- `src/logger.ts`
- `src/main.ts`
- `src/security/contentEncryption.ts`
- `src/security/dashboardRequestReplay.ts`
- `src/security/protectedPayload.ts`
- `src/security/sharedRateLimit.ts`
- `src/server.ts`
- `src/services/archives.ts`
- `src/services/bulkActions.ts`
- `src/services/calendar.ts`
- `src/services/captureReclassification.ts`
- `src/services/codex.ts`
- `src/services/codexAdditionalDirectories.ts`
- `src/services/codexAttachments.ts`
- `src/services/codexCapabilities.ts`
- `src/services/codexDiscovery.ts`
- `src/services/codexQueuePolicy.ts`
- `src/services/codexSubprocessEnv.ts`
- `src/services/codexTaskSyncAuth.ts`
- `src/services/codexThreadDiscovery.ts`
- `src/services/codexWorkerDiagnostics.ts`
- `src/services/dailyAgenda.ts`
- `src/services/excel.ts`
- `src/services/expenses.ts`
- `src/services/fileCourier.ts`
- `src/services/fileCourierLocal.ts`
- `src/services/fileCourierPolicy.ts`
- `src/services/geminiCli.ts`
- `src/services/geminiIdeas.ts`
- `src/services/geminiStudyAnalysis.ts`
- `src/services/googleCalendar.ts`
- `src/services/groupCollaboration.ts`
- `src/services/groupScheduling.ts`
- `src/services/groupTaskCompatibility.ts`
- `src/services/groupTaskPolicy.ts`
- `src/services/groupWorkspaces.ts`
- `src/services/ideas.ts`
- `src/services/imageOcr.ts`
- `src/services/imageUploadBatches.ts`
- `src/services/itemEdits.ts`
- `src/services/listPagination.ts`
- `src/services/noteCaptureSessions.ts`
- `src/services/noteMerges.ts`
- `src/services/notes.ts`
- `src/services/openAiStudyApi.ts`
- `src/services/pendingCaptures.ts`
- `src/services/pins.ts`
- `src/services/privacyRetention.ts`
- `src/services/publicIds.ts`
- `src/services/reminders.ts`
- `src/services/review.ts`
- `src/services/search.ts`
- `src/services/settings.ts`
- `src/services/storedImages.ts`
- `src/services/study.ts`
- `src/services/studyAnalysis.ts`
- `src/services/studyAnalysisRunner.ts`
- `src/services/studyAttention.ts`
- `src/services/studyCalendar.ts`
- `src/services/studyCanvas.ts`
- `src/services/studyCaptureBatches.ts`
- `src/services/studyDeadlineTrust.ts`
- `src/services/studyEvidenceGraph.ts`
- `src/services/studyMarkdown.ts`
- `src/services/studyNaturalLanguage.ts`
- `src/services/studyNoteEditSuggestions.ts`
- `src/services/studyNusmods.ts`
- `src/services/studyReminders.ts`
- `src/services/studyResources.ts`
- `src/services/studyScale.ts`
- `src/services/studySmokeSeed.ts`
- `src/services/studyTransit.ts`
- `src/services/taskCaptureDrafts.ts`
- `src/services/taskControlSurfaces.ts`
- `src/services/taskImports.ts`
- `src/services/taskPlanning.ts`
- `src/services/taskReminderSchedules.ts`
- `src/services/tasks.ts`
- `src/services/telegramChatMigrations.ts`
- `src/services/telegramUpdates.ts`
- `src/services/trustedDeployment.ts`
- `src/services/trustedGitPublisher.ts`
- `src/services/trustedGitWorktree.ts`
- `src/services/undo.ts`
- `src/services/users.ts`
- `src/services/version.ts`
- `src/services/voiceTranscription.ts`
- `src/types/knayi-myscript.d.ts`
- `src/utils/clock.ts`
- `src/utils/currencies.ts`
- `src/utils/dates.ts`
- `src/utils/html.ts`
- `src/utils/messageFormat.ts`
- `src/utils/ocrLanguages.ts`
- `src/utils/text.ts`
- `src/utils/timezones.ts`
- `src/utils/vector.ts`
- `tsconfig.json`

### Dashboard

- `.github/workflows/dashboard-ci.yml`
- `docs/ARCHITECTURE.md`
- `docs/BRAND.md`
- `docs/CSP_ROLLOUT.md`
- `docs/DESIGN.md`
- `docs/DEVELOPER_ONBOARDING.md`
- `docs/PUBLIC_STUDY_DASHBOARD_BOUNDARY.md`
- `next.config.ts`
- `package.json`
- `public/brand/ari-approved-sheet.png`
- `public/brand/ari-avatar-dark-sheet.png`
- `public/brand/ari-avatar-dark-transparent-v2.webp`
- `public/brand/ari-avatar-light-sheet.png`
- `public/brand/ari-avatar-light-transparent-v2.webp`
- `public/brand/ari-full-sheet.png`
- `public/brand/ari-telegram-512.png`
- `public/brand/ari-threading-sheet.png`
- `public/brand/ari-untangle-calm-v6.json`
- `public/brand/ari-untangle-calm-v6.webp`
- `public/brand/ari-untangle-contact-v3.webp`
- `public/brand/ari-untangle-loading-v2.webp`
- `public/brand/ari-untangle-loading.png`
- `public/brand/ari-untangle-normalized-v4.json`
- `public/brand/ari-untangle-normalized-v4.png`
- `public/brand/ari-untangle-overlay-v3.png`
- `public/brand/ari-untangle-registered-v3.json`
- `public/brand/ari-untangle-registered-v3.webp`
- `public/brand/ari-untangle-smooth-v5.json`
- `public/brand/ari-untangle-smooth-v5.webp`
- `public/brand/threadwise-mark-sheet.png`
- `public/demo/book-stack.svg`
- `public/demo/city-rain.svg`
- `public/demo/garden-light.svg`
- `public/demo/launch-board.svg`
- `public/demo/morning-cafe.svg`
- `public/demo/receipt.svg`
- `public/pwa/apple-touch-icon.png`
- `public/pwa/icon-192.png`
- `public/pwa/icon-512.png`
- `public/pwa/maskable-512.png`
- `public/pwa/threadwise-apple-touch-icon-v2.png`
- `public/pwa/threadwise-icon-192-v2.png`
- `public/pwa/threadwise-icon-512-v2.png`
- `public/pwa/threadwise-maskable-512-v2.png`
- `public/sw.js`
- `scripts/normalize_ari_assets.py`
- `scripts/scan-tracked-secrets.mjs`
- `scripts/study-browser-fixture.mjs`
- `src/app/api/auth/callback/route.ts`
- `src/app/api/auth/login/route.ts`
- `src/app/api/auth/logout/route.ts`
- `src/app/api/auth/telegram-mini-app/route.ts`
- `src/app/api/threadwise/[...path]/route.ts`
- `src/app/api/workspace/select/route.ts`
- `src/app/dashboard/loading.tsx`
- `src/app/dashboard/page.tsx`
- `src/app/globals.css`
- `src/app/icon.png`
- `src/app/layout.tsx`
- `src/app/manifest.ts`
- `src/app/offline/page.tsx`
- `src/app/page.tsx`
- `src/app/privacy/page.tsx`
- `src/app/study-dashboard.css`
- `src/components/action-menu.tsx`
- `src/components/ari.tsx`
- `src/components/browser-privacy-lifecycle.tsx`
- `src/components/confirmation-dialog.tsx`
- `src/components/dashboard-app.tsx`
- `src/components/group-scheduling.tsx`
- `src/components/group-workspace.tsx`
- `src/components/integer-input.tsx`
- `src/components/personal-note-editor.tsx`
- `src/components/phase-two-collections.tsx`
- `src/components/pwa-registration.tsx`
- `src/components/study-choice-picker.tsx`
- `src/components/study-dashboard.tsx`
- `src/components/study-deep-work.tsx`
- `src/components/study-dialog.tsx`
- `src/components/study-markdown-media.tsx`
- `src/components/study-markdown.tsx`
- `src/components/study-mermaid-help.tsx`
- `src/components/study-note-editor.tsx`
- `src/components/study-place-combobox.tsx`
- `src/components/study-rich-note-body.tsx`
- `src/components/study-timetable.tsx`
- `src/components/task-import-review.tsx`
- `src/components/telegram-mini-app-auth.tsx`
- `src/components/threadwise-mark.tsx`
- `src/components/today-planner.tsx`
- `src/lib/ari-loader.ts`
- `src/lib/auth.ts`
- `src/lib/body-scroll-lock.ts`
- `src/lib/browser-drafts.ts`
- `src/lib/browser-session-registry.ts`
- `src/lib/content-security-policy.ts`
- `src/lib/dashboard-copy.ts`
- `src/lib/dashboard-live-sync.ts`
- `src/lib/dashboard-snapshot-schema.ts`
- `src/lib/demo-data.ts`
- `src/lib/note-draft-api.ts`
- `src/lib/numeric-input.ts`
- `src/lib/proxy-allowlist.ts`
- `src/lib/proxy-security.ts`
- `src/lib/study-access.ts`
- `src/lib/study-analysis.ts`
- `src/lib/study-editor-indentation.ts`
- `src/lib/study-editor-sync.ts`
- `src/lib/study-image.ts`
- `src/lib/study-markdown-security.ts`
- `src/lib/study-markdown.ts`
- `src/lib/study-mermaid-templates.ts`
- `src/lib/study-mermaid.ts`
- `src/lib/study-preferences.ts`
- `src/lib/study-session.ts`
- `src/lib/study-timetable.ts`
- `src/lib/study-types.ts`
- `src/lib/study-week.ts`
- `src/lib/telegram-mini-app.ts`
- `src/lib/telegram-start-param.ts`
- `src/lib/threadwise-api.ts`
- `src/lib/types.ts`
- `src/proxy.ts`
- `tsconfig.json`
