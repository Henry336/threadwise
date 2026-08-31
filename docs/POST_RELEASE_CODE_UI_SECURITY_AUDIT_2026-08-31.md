# Threadwise post-release code, UI, security, and privacy audit

Date: 2026-08-31 SGT  
Scope: initial audit of backend `3869a4a`, dashboard `b81f57f`, and the live dashboard demo, with
release addenda through backend `25f8093` and dashboard `703d89b`
Status: initial findings preserved; subsequent bounded resolutions and release evidence are addended

## Executive summary

Threadwise is materially safer and more coherent than it was at the start of the seven-phase cycle.
No critical vulnerability, cross-workspace data leak, exposed secret, or confirmed release regression
was found. The production dependency graphs report zero known vulnerabilities, tracked-secret scans
are clean, the complete serialized backend suite passes, and the dashboard unit, browser, type, lint,
and production-build gates pass.

The highest current risk is maintainability rather than an active breach. Several backend and
dashboard files are large enough that unrelated changes collide in the same modules. The most
important browser security gap is that Content Security Policy remains report-only and cannot yet be
enforced without breaking legitimate inline style attributes. The Study/Personal rich editor's
accessible names, nested filing focus, typed error handling, visible list markers, and normal-path
typing performance have since been remediated. Large-note benchmarking, fully reliable termination
recovery, and an authenticated Study lifecycle fixture remain appropriate gates before Group expansion.

## Remediation addendum — 2026-08-31

This pass resolves the latest note and timetable defects without claiming that the broader audit is
complete:

- Markdown conversion is bounded behind a 140 ms quiet window with a 900 ms maximum wait, then flushed
  before filing, explicit close, and best-effort page-hide persistence. Dashboard shortcuts now
  recognize every `contenteditable` descendant, eliminating the mid-word focus theft that opened Quick
  Capture when the learner typed `n`.
- Ordered and unordered lists have explicit nested markers. A browser regression types a numbered list
  continuously, checks its computed decimal marker, and proves the editor retains focus.
- Study and Personal filing sheets are active modal layers: the obscured editor is inert, the sheet owns
  dialog semantics and keyboard focus, and title/module controls share one aligned rhythm.
- Mobile Personal and Study search controls now retain stable accessible names.
- Markdown import failures are visible and structured draft error codes identify conflicts.
- Timetable creation no longer sends an invalid `customTypeLabel: null`. Backend validation converts
  invalid-type failures to field-specific guidance, while the full-width leave-time row aligns with the
  recurrence dates and clearly marks Destination as optional.
- Study modules can be pinned. A nullable `pinnedAt` column and bounded index put pinned modules first
  without rewriting existing records.

Still open: oversized modules, CSP enforcement readiness, revocable browser sessions, explicit Study
draft response DTOs, remaining native selectors, backend parallel-test timeout ergonomics, and two
older unnamed icon-only actions. Page-hide keepalive narrows the last autosave window for ordinary
drafts but cannot guarantee delivery after abrupt process/device loss or beyond browser keepalive limits.

## What was verified as improved

- Canvas API and pagination URLs are constrained to the configured origin and API path; redirects are
  refused before the bearer token can be forwarded.
- Dashboard service JWTs last 60 seconds, require a JTI, and mutation JTIs are consumed in a shared
  database replay store.
- Dashboard, server ingress, and Telegram webhook traffic use shared principal/route rate limits.
- Study note drafts are owner/workspace scoped, encrypted at the Prisma boundary, revision checked,
  and expired after seven days. Draft content is not added to search indexes or AI evidence.
- The browser BFF accepts only allowlisted paths and methods, applies same-origin checks to mutations,
  caps request and response bodies, and returns personalized responses as `no-store`.
- Raw Markdown HTML is not executed. Links and images are scheme checked, remote images require
  explicit consent, Mermaid is budgeted/serialized/time-bounded, and rendered SVG is sanitized.
- The service worker caches only static shell assets and the generic offline page, never authenticated
  navigation or `/api/*` responses.
- Gate 3A backup, isolated restore, and encryption-key recovery were completed before the guarded stack
  was released. Destructive historical backfill and retention deletion remain intentionally separate.

## Findings

### High engineering risk — oversized composition and routing modules

**Evidence.** Backend hotspots include `src/community/index.ts` (2,955 lines),
`src/bot/studyCapture.ts` (1,895), `src/services/study.ts` (1,486),
`src/dashboard/data.ts` (1,456), `src/bot/study.ts` (1,360), and
`src/dashboard/route.ts` (1,272). Dashboard hotspots include
`src/components/dashboard-app.tsx` (1,544) and `src/components/study-dashboard.tsx` (1,303).

**Impact.** Review scope, merge conflicts, test setup, and change-local reasoning all grow with these
files. Security-sensitive authorization and UI state can be changed accidentally while editing an
unrelated feature.

**Recommendation.** Split by stable responsibility, not arbitrary line count. Start with route
registration versus handlers, Study shell versus feature views, and Beacon registration versus
moderation domains. Preserve public service seams and add characterization tests before moving code.
Do not attempt one big-bang refactor.

### Medium security — CSP is report-only and current UI is not enforcement ready

**Location.** Dashboard `src/proxy.ts:5-17`, `src/lib/content-security-policy.ts:3-31`, and dynamic
style attributes throughout `src/components`.

**Evidence.** The live demo returned a nonce policy in report-only mode on 2026-08-31. A fresh browser
load logged at least five `style-src` violations for legitimate style attributes. The repository has
many dynamic widths, positions, colors, and CSS custom properties expressed with React `style`.

**Impact.** The policy currently observes rather than blocks script/style violations. Turning on
enforcement now would break legitimate presentation, including timeline and progress geometry.

**Recommendation.** Keep production report-only. Inventory violations in a synthetic staging account,
move bounded values to classes or a deliberately reviewed CSP-compatible styling mechanism, and
enforce in staging before production. Do not solve this by broadly adding `unsafe-inline` or
`unsafe-eval`.

**Qualification.** This is defense in depth, not evidence of an existing XSS exploit. React escaping,
raw-HTML refusal, URL validation, Mermaid sanitization, framing denial, and object blocking remain
effective independent controls.

### Medium security/privacy — signed browser sessions cannot be revoked before seven-day expiry

**Location.** Dashboard `src/lib/auth.ts:12-50` and the Telegram auth routes.

**Evidence.** The dashboard session is a correctly HMAC-signed client-contained token with a fixed
seven-day expiry. Logout deletes the browser cookie but there is no server-side session identifier,
rotation counter, or revocation store.

**Impact.** If the HttpOnly cookie is stolen through a compromised device, browser profile, extension,
or future browser exploit, logout alone cannot invalidate that copied token before expiry.

**Recommendation.** Use an opaque server-side session or include a session/version identifier checked
against a revocation store. Rotate on reauthentication and destructive account/privacy actions. Keep
HttpOnly, Secure, SameSite, and the same-origin BFF controls.

**Qualification.** The token is not readable by ordinary client JavaScript and is not a bearer token
for direct Render access. An attacker must first obtain the cookie.

### Resolved in the current pass — mobile search controls keep accessible names

**Location.** Dashboard `src/components/dashboard-app.tsx:781`,
`src/components/study-dashboard.tsx:361`, `src/app/globals.css:667`, and
`src/app/study-dashboard.css:1202-1203`.

**Evidence.** Both search buttons rely on visible text for their name, while narrow CSS sets the text
and shortcut to `display: none`. The live 390×844 accessibility snapshot exposed the Personal search
button as an unnamed button.

**Impact.** Screen-reader and voice-control users cannot identify the primary search command on mobile.

**Resolution.** Both controls now have stable `aria-label` values independent of responsive visible
copy. Focused regressions guard both names.

### Resolved in the current pass — filing sheets isolate keyboard focus

**Location.** Dashboard `src/components/study-note-editor.tsx:149-174` and `:227-235`.

**Evidence.** The outer editor dialog owns one focus trap. The filing sheet is a visually modal form
inside it, but it has no nested dialog semantics or separate focus boundary. The outer trap continues
to include toolbar and editor controls behind the filing scrim.

**Impact.** Keyboard users can tab into obscured controls and lose context while choosing title/module.

**Resolution.** Study and Personal filing forms now own nested dialog semantics and the active focus
trap while the underlying editor header, status, messages, and writing space are inert. Browser coverage
proves the filing title receives focus and the editor is excluded.

### Mitigated in the current pass — abrupt browser exit can still outrun persistence

**Location.** Dashboard `src/components/study-note-editor.tsx:131-145`.

**Evidence.** Normal editor Close waits for dirty content to persist, but autosave is debounced by 650
milliseconds and there is no page-hide/unload handoff. Closing the tab, browser, PWA process, or device
immediately after typing can drop the newest edits even while the UI says autosave is on.

**Mitigation.** Both editors flush pending Markdown and attempt a bounded same-origin keepalive write on
`pagehide`; normal Close still waits for persistence and status distinguishes saving, error, and saved
states. Browser shutdown is not transactional: abrupt process/device loss and oversized keepalive bodies
remain residual risks and should be exercised by a dedicated termination harness.

### Resolved 2026-08-31 — duplicate per-keystroke serialization and selection replacement

**Location.** Dashboard `src/components/study-rich-note-body.tsx:124-132`.

**Previous evidence.** Every Tiptap update called `getMarkdown()`, updated React parent state, and then
the sync effect called `getMarkdown()` again to compare the new prop. Notes may contain up to 100,000
characters, and treating the echoed prop as replacement content could reset the active selection.

**Resolution.** The editor records the last locally emitted body and returns before serializing or
calling `setContent` when the parent echoes it. Markdown conversion is also coalesced behind a 140 ms
quiet window with a 900 ms maximum wait and synchronously flushed at filing/persistence boundaries.
Only genuine external content can replace the editor document. The parent callback is stable, and the
global shortcut handler now treats Tiptap descendants as typing targets rather than opening Quick
Capture on the letter `n`. Pure sync tests and a real browser typing/list/focus flow cover the path.
Representative 10k/50k/100k latency measurement remains useful.

**Residual recommendation.** Benchmark representative 10k/50k/100k notes before widening the rollout.
If serialization is still visible, debounce parent serialization separately without weakening draft
durability or cross-device conflict detection.

**Release evidence.** Dashboard runtime `e9e21b192f15` passed the complete local gate and hosted CI run
`33353462062`, then completed its Vercel production deployment. The canonical dashboard returned HTTP 200.

### Resolved and released 2026-08-31 — checklist geometry and first Personal rich-note lifecycle

**Previous evidence.** Tiptap checklist text inherited the document paragraph's top margin while the
checkbox occupied a separate grid cell, visibly placing the empty control above its first text line.
Personal notes still used the compact legacy textarea even after the Study writer proved viable.

**Resolution.** Task-item CSS now targets Tiptap's `li > label + div` structure, centers the control in
the first line, and removes only the first/last task paragraph's outer margins. Personal Today and Notes
reuse the same selection-safe editor and strict local diagram boundary with Personal accent tokens and a
title-only filing step. New encrypted `PersonalNoteDraft` storage scopes by signed owner, expires after
seven days, checks draft and canonical-note revisions, and remains outside search/AI evidence. Group is
explicitly not widened.

**Release evidence.** Backend type/build, 981 tests with 6 intentional skips, 152 focused security
checks, secret scan, and both zero-finding dependency audits pass. Dashboard typecheck/lint/build, 169
unit/regression tests, 78 focused security checks, secret scan, both zero-finding dependency audits, and
the complete browser gate (10 pass, 2 intentional mobile skips) pass. The browser check measures the
rendered checkbox/text centers, not merely CSS source strings. Backend `25f80939b8e2` released first;
Render applied additive migration `20260831150000_personal_note_drafts` and `/health` returned HTTP 200
at that commit. Dashboard `7bf90df1a75a` passed GitHub CI run `33360802480` and then completed its
Vercel production deployment. The same
Personal create/checklist/title/save flow passed against the canonical production URL in desktop and
mobile Chromium; desktop additionally verified `.md` export.

### Resolved and released 2026-08-31 — timetable deletion could permanently lock page scrolling

**Previous evidence.** Study block details and its deletion confirmation remained mounted as separate
portal siblings. Both independently captured and replaced `document.body.style.overflow`; when a
successful deletion closed both in one React commit, cleanup order could restore the inner dialog's
captured `hidden` value last. Every recurrence scope shared that lifecycle on desktop and mobile.

**Resolution.** The destructive confirmation now replaces block details, leaving one active modal and
focus owner. Timetable overlays additionally use a reference-counted scroll lock that restores the
original overflow only when the last holder releases, regardless of release order or duplicate cleanup.
The recurrence request bodies and backend deletion semantics are unchanged.

**Release evidence.** Two lock-order tests and a structural single-modal guard pass within 172 dashboard
tests. All 78 focused security checks, typecheck, lint, isolated production build, secret scan, and the
browser gate (10 pass, 2 intentional mobile skips) pass. Dashboard `703d89b1612e` passed GitHub CI run
`33369782858`, completed Vercel production deployment, and passed the 10 hosted browser checks.

### Medium reliability — the authenticated Study rich-note lifecycle is still mostly structural

**Location.** Dashboard `src/components/study-ui-regressions.test.ts:145-164`.

**Evidence.** The primary rich-note regression test still reads source files and checks for strings.
Pure tests now cover local/external synchronization and indentation boundaries, and Playwright loads the
installed Mermaid runtime to parse every shipped Mermaid/UML template. There is still no browser/component
flow covering autosave recovery, filing focus, conflict resolution, import error, diagram editing, or
abrupt close. The live demo cannot enter the owner-gated Study editor.

Personal demo coverage now exercises opening, rich checklist entry, measured alignment, title filing,
and successful save on desktop and mobile. The owner-gated Study lifecycle still lacks an authenticated
fixture.

**Impact.** Study refactors can satisfy the assertions while interaction behavior is broken; conversely,
safe refactors can fail because text moved.

**Recommendation.** Keep narrow serializer/security unit tests, then add a synthetic authenticated
Study fixture and behavioral component/browser tests for the complete editor lifecycle.

### Medium test ergonomics — default parallel backend run has insufficient timeout headroom

**Evidence.** The first default `npm test` run passed 973 tests but timed out one Excel import test and
two file-courier tests. The same files passed together with one worker (8/8), and the complete suite
passed with one worker (976 passed, 6 skipped).

**Impact.** A healthy change can appear red under local/CI contention, encouraging wasteful reruns or
masking a future real timeout.

**Recommendation.** Profile import/filesystem setup, reduce shared startup work, or give only those
integration-style tests evidence-based timeouts. Keep a serialized full-suite lane until the parallel
lane is stable.

### Medium UI consistency — browser-native selectors remain in mature surfaces

**Location.** Examples include dashboard `src/components/dashboard-app.tsx:1065,1192,1367-1368,
1507-1509`, `src/components/group-scheduling.tsx:153,228-229`, and Study
`src/components/study-dashboard.tsx:436,985,1020-1026,1135-1137,1208,1229-1230`.

**Evidence.** Newer Work and analysis selectors use branded accessible pickers, while Library,
settings, review, task/idea editors, scheduling, Deep Work, and assignment controls still use native
`select` elements.

**Impact.** The visual language changes between adjacent workflows and native popups do not match the
dashboard in light/dark mode.

**Recommendation.** Migrate in bounded feature groups using one shared accessible picker. Preserve
native semantics, keyboard/typeahead behavior, and mobile viewport safety; do not replace all selects
in one risky sweep.

### Low privacy — Study draft responses expose internal ownership metadata to the owner browser

**Location.** Backend `src/dashboard/study.ts:751-825`.

**Evidence.** `findFirst`, `create`, and `findUniqueOrThrow` return raw `StudyNoteDraft` rows. The browser
needs draft id, revision, resource version, module, title/body, and timestamps, but also receives
internal `ownerUserId`, `workspaceId`, `draftKey`, and `resourceId` values.

**Impact.** Authorization is correct, so this is not a cross-tenant leak. It increases exposed metadata
and couples the browser contract to the database model.

**Recommendation.** Map drafts to an explicit response DTO and test that internal identifiers are not
serialized.

### Resolved in the current pass — editor errors are visible and code-driven

**Location.** Dashboard `src/components/study-note-editor.tsx:117-122`, `:180-195`, and `:245-257`.

**Evidence.** Wrong-extension and oversized imports return without feedback. Conflict detection uses
`/changed somewhere else/i` because `noteApi` discards the structured backend error code. Draft-delete
failure after canonical save is ignored, so a stale draft may reopen and then conflict safely.

**Resolution.** The shared note-draft client preserves backend error codes, conflict handling checks
those codes, and invalid extension, size, and file-read failures provide specific feedback. Post-save
draft deletion remains best-effort because stale drafts expire and conflict safely.

### Low accessibility — several icon-only actions have no explicit label

**Location.** Dashboard `src/components/dashboard-app.tsx:1007` (Recent frames navigation) and
`src/components/phase-two-collections.tsx:240` (image delete), plus any future icon-only action.

**Evidence.** These buttons contain only an icon and no `aria-label`; the live accessibility snapshot
showed the Recent frames action as unnamed.

**Recommendation.** Add action-and-object labels and an automated scan for unnamed interactive
elements at desktop and mobile widths.

## Validation evidence

| Gate | Result |
| --- | --- |
| Backend full suite, default parallel | 973 passed, 6 skipped, 3 timeout failures |
| Backend isolated timeout files | 8 passed |
| Backend full suite, one worker | 976 passed, 6 skipped |
| Backend typecheck / build / secret scan | passed |
| Dashboard unit/regression suite | 153 passed |
| Dashboard typecheck / lint / production build / secret scan | passed |
| Dashboard browser suite | 7 passed, 1 intentional mobile skip |
| Backend and dashboard production/full npm audits | zero vulnerabilities in all four runs |
| Live demo, 390×844, light and dark | visually coherent; no console errors; CSP report-only notices |

The first dashboard build/browser attempt was run concurrently and hit Windows access errors on
shared `.next` and `test-results` files. Both passed independently. That is a validation-run collision,
not a product defect.

## Suggested order of work

1. Fix accessible names and filing focus isolation; add behavioral editor tests with the same change.
2. Make autosave termination-safe and typed-error driven; prove recovery and conflict behavior.
3. Profile/debounce Markdown serialization before any Group expansion or broader large-note rollout.
4. Establish synthetic authenticated staging and eliminate CSP violations before enforcement.
5. Add revocable dashboard sessions and explicit draft DTOs as a bounded security/privacy release.
6. Split the largest modules incrementally behind characterization tests.
7. Migrate remaining native selectors in user-visible feature groups.

No active penetration test, production content inspection, destructive migration, credential
rotation, or runtime remediation was performed in this audit.
