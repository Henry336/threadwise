# Threadwise post-release code, UI, security, and privacy audit

Date: 2026-08-31 SGT  
Scope: backend `3869a4a`, dashboard `b81f57f`, and the live dashboard demo  
Status: findings documented; no runtime finding was changed during this audit

## Executive summary

Threadwise is materially safer and more coherent than it was at the start of the seven-phase cycle.
No critical vulnerability, cross-workspace data leak, exposed secret, or confirmed release regression
was found. The production dependency graphs report zero known vulnerabilities, tracked-secret scans
are clean, the complete serialized backend suite passes, and the dashboard unit, browser, type, lint,
and production-build gates pass.

The highest current risk is maintainability rather than an active breach. Several backend and
dashboard files are large enough that unrelated changes collide in the same modules. The most
important browser security gap is that Content Security Policy remains report-only and cannot yet be
enforced without breaking legitimate inline style attributes. The new Study editor also has bounded
accessibility, abrupt-close recovery, performance, and behavioral-test gaps that should be fixed
before it is expanded to Personal or Group mode.

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

### Medium accessibility — mobile search controls lose their accessible names

**Location.** Dashboard `src/components/dashboard-app.tsx:781`,
`src/components/study-dashboard.tsx:361`, `src/app/globals.css:667`, and
`src/app/study-dashboard.css:1202-1203`.

**Evidence.** Both search buttons rely on visible text for their name, while narrow CSS sets the text
and shortcut to `display: none`. The live 390×844 accessibility snapshot exposed the Personal search
button as an unnamed button.

**Impact.** Screen-reader and voice-control users cannot identify the primary search command on mobile.

**Recommendation.** Add stable `aria-label` values such as `Find anything` and
`Search this semester`; retain visible tooltips where appropriate.

### Medium accessibility — the Study filing sheet does not isolate keyboard focus

**Location.** Dashboard `src/components/study-note-editor.tsx:149-174` and `:227-235`.

**Evidence.** The outer editor dialog owns one focus trap. The filing sheet is a visually modal form
inside it, but it has no nested dialog semantics or separate focus boundary. The outer trap continues
to include toolbar and editor controls behind the filing scrim.

**Impact.** Keyboard users can tab into obscured controls and lose context while choosing title/module.

**Recommendation.** Treat filing as the active modal layer: give it dialog semantics, trap focus within
it, make the underlying editor inert while open, and restore focus to Save when it closes.

### Medium data-loss UX — abrupt browser exit can lose the last autosave window

**Location.** Dashboard `src/components/study-note-editor.tsx:131-145`.

**Evidence.** Normal editor Close waits for dirty content to persist, but autosave is debounced by 650
milliseconds and there is no page-hide/unload handoff. Closing the tab, browser, PWA process, or device
immediately after typing can drop the newest edits even while the UI says autosave is on.

**Recommendation.** Add a privacy-reviewed page-hide strategy, such as a bounded same-origin keepalive
write, and test process/tab termination. If reliable delivery cannot be guaranteed, make the status
distinguish `Unsaved changes` from `Saved across devices` at all times.

### Medium efficiency — long notes are serialized twice per editor transaction

**Location.** Dashboard `src/components/study-rich-note-body.tsx:124-132`.

**Evidence.** Every Tiptap update calls `getMarkdown()`, updates React parent state, and then the sync
effect calls `getMarkdown()` again to compare the new prop. Notes may contain up to 100,000 characters.

**Impact.** Typing cost grows with document size and can become visible input latency on slower devices.

**Recommendation.** Keep editor-local state, serialize on a bounded debounce, and use an explicit
external-version signal for real remote replacements instead of comparing the entire Markdown body on
every keystroke. Measure at representative 10k/50k/100k sizes before and after.

### Medium reliability — the rich-note acceptance gate is mostly structural

**Location.** Dashboard `src/components/study-ui-regressions.test.ts:145-164`.

**Evidence.** The primary rich-note regression test reads source files and checks for strings. There is
no browser/component flow covering autosave recovery, filing focus, conflict resolution, import error,
Mermaid editing, or abrupt close. The live demo cannot enter the owner-gated Study editor.

**Impact.** Refactors can satisfy the assertions while interaction behavior is broken; conversely,
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

### Low UX/robustness — editor errors are silent or coupled to English copy

**Location.** Dashboard `src/components/study-note-editor.tsx:117-122`, `:180-195`, and `:245-257`.

**Evidence.** Wrong-extension and oversized imports return without feedback. Conflict detection uses
`/changed somewhere else/i` because `noteApi` discards the structured backend error code. Draft-delete
failure after canonical save is ignored, so a stale draft may reopen and then conflict safely.

**Recommendation.** Preserve typed API error codes, show bounded import errors, and let the backend
ignore/delete drafts whose bound canonical resource version is already stale.

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
3. Profile/debounce Markdown serialization before expanding the editor beyond Study mode.
4. Establish synthetic authenticated staging and eliminate CSP violations before enforcement.
5. Add revocable dashboard sessions and explicit draft DTOs as a bounded security/privacy release.
6. Split the largest modules incrementally behind characterization tests.
7. Migrate remaining native selectors in user-visible feature groups.

No active penetration test, production content inspection, destructive migration, credential
rotation, or runtime remediation was performed in this audit.
