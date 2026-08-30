# Post-Phase-7 Threadwise codebase audit

> Historical snapshot (2026-08-17). Current status and residual findings are in
> `docs/POST_RELEASE_CODE_UI_SECURITY_AUDIT_2026-08-31.md`. Gate 3A and findings F-01 through F-03
> were subsequently completed/remediated and released; the finding text below is preserved as the
> evidence that drove that work, not as a statement of current exposure.

Date: 2026-08-17 SGT  
Status: **final local audit complete; findings recorded; no audit finding remediated in this pass**

This report covers the seven-phase security and scalability cycle across the Threadwise backend
and dashboard, plus the requested correction to the Study Work module filter. It contains no
credentials, private payloads, production rows, or embedded images. The audit used local source,
tracked redacted reports, commit history, synthetic tests, static review, dependency metadata, and
local browser checks. It was **not** an active production penetration test, a new production data
inspection, a deployment, or a database migration.

## Executive verdict

- **Net result: materially better on the guarded branches.** Webhook authenticity, dependency
  posture, privacy migration tooling, retained-AI encryption coverage, Study transaction/scale
  behavior, browser trust boundaries, security CI, and public-Study design all improved.
- **No confirmed security or functional regression was introduced by Phases 1–7.** One backend
  Excel test failed during the first highly concurrent run, passed immediately in isolation, and
  the complete suite then passed with one worker. This is a test-execution stability signal, not a
  reproduced product defect.
- **Guarded does not mean live.** Phase 1 runtime/dependency containment is live and Phase 2 was a
  read-only production inspection. Phase 3–5 implementation, Phase 6 assurance additions, and
  Phase 7 architecture remain on guarded branches. Production therefore has not yet received most
  of the later improvements.
- **Four important boundaries remain:** Phase 3/4 production activation is blocked at Gate 3A;
  Phase 6 findings F-01 through F-03 are unresolved; CSP enforcement lacks a clean preview evidence
  window; and hosted synthetic staging has not been provisioned or exercised.
- The requested Study Work filter now uses the same accessible branded picker as the newer Study
  surfaces. Its persisted `all` value, filtering semantics, mobile sizing, and keyboard behavior
  are preserved by implementation and regression checks.

## Audited state

| Repository | Audit branch | Starting Phase-7 head | Main at audit time | Working outcome |
| --- | --- | --- | --- | --- |
| Backend/bot | `codex/post-phase7-work-filter-audit` | `06b9146` | `a1694b9` | Audit and continuity documentation only |
| Dashboard | `codex/post-phase7-work-filter-audit` | `45864dc` | `c560351` | Study Work picker correction and regression test |

No branch was merged, deployed, or used to mutate production during this audit.

## Deployment truth

| Phase | What is complete | Production state |
| --- | --- | --- |
| 1 | Primary Telegram webhook authentication/rotation and dashboard dependency patching | **Deployed/validated** before this audit |
| 2 | Bounded aggregate-only privacy inspection | **Read-only inspection complete**; no write was made |
| 3 | Additive privacy schema/runtime, encryption/backfill/retention tools, mixed reads | **Guarded only**; Gate 3A blocks apply/backfill/deletion |
| 4 | Study pagination, transactions, bounded evidence/scale behavior and migration tooling | **Guarded only**; stacked on Phase 3 and inherits Gate 3A |
| 5 | Browser CSP/draft/Markdown/Mermaid hardening and dashboard CI | **Guarded only**; CSP defaults to report-only |
| 6 | Synthetic assurance suites, CI gates, threat-matrix evidence | **Guarded only**; findings review and hosted staging remain open |
| 7 | Public Study multi-tenant/OAuth/bot/job/lifecycle architecture | **Documentation only**; no schema/runtime/public activation exists |

## What changed, phase by phase

### Phase 1 — immediate containment

**Better**

- The primary Telegram webhook now requires a dedicated high-entropy secret, rejects invalid
  requests before bot processing, compares secrets safely, uses a rotated path/registration flow,
  and gives opaque failures without leaking route details.
- Dashboard production dependencies were updated. At this audit, both backend and dashboard report
  zero vulnerabilities in production-only and complete npm audits.
- Focused webhook, route, proxy, build, type, and release checks were made repeatable.

**Trade-off / limitation**

- Webhook replay is bounded by Telegram update idempotency rather than a separate nonce protocol;
  this is appropriate to the provider but still depends on correct update deduplication.

### Phase 2 — privacy inspection

**Better**

- A transaction-enforced, aggregate-only inspection established an evidence baseline without
  exporting private content or modifying production.
- It found 190 encrypted and 926 plaintext protected values, no malformed encrypted envelopes, and
  no anomalies across the inspected cross-workspace relationships.
- It identified two failed Study AI jobs retaining about 63 KB of duplicated evidence/prompt/error
  material, accumulating blind-search tokens, and unproven backup/PITR/restore/key recovery.

**Still true in production**

- The historical plaintext and duplicated-retention findings are not cleared merely because Phase 3
  code exists. They remain production risks until Gate 3A passes and the guarded migration/retention
  procedure is deliberately activated and verified.

### Phase 3 — privacy and encryption remediation

**Better on the guarded branch**

- Encryption coverage extends to retained Study AI evidence/prompts/errors, Canvas source metadata,
  and note-edit suggestions.
- Search-token updates now produce complete-record blind-index sets instead of unbounded append-only
  accumulation.
- Restart-safe, dry-run-capable backfill and retention tools support bounded batches, checkpoints,
  mixed-state reads, tamper detection, and explicit rollback sequencing.

**Not yet achieved**

- No production schema apply, backfill, diagnostic minimization, or retention deletion occurred.
- Gate 3A still requires a current provider backup/PITR reference, a successful isolated restore,
  and independently recoverable production encryption keys before any irreversible step.

### Phase 4 — Study scale and transaction reliability

**Better on the guarded branch**

- Large collections use selected previews, pagination/detail endpoints, response budgets, and
  bounded evidence graphs instead of repeatedly hydrating everything.
- Note/revision/backlink/audit writes were grouped into atomic transactions; capture claiming and
  concurrency behavior gained deterministic tests.
- Incremental link resolution, guarded migration/backfill tooling, and synthetic large-workspace
  tests reduce quadratic work and partial-write risk.

**Trade-off / limitation**

- This code is stacked on Phase 3 and cannot safely be deployed independently. Hosted, realistic
  large-tenant validation is still absent.

### Phase 5 — browser hardening and maintainability

**Better on the guarded dashboard branch**

- A nonce-bearing CSP pipeline avoids broad `unsafe-inline`/`unsafe-eval` allowances and defaults to
  report-only until evidence supports enforcement.
- Unsaved drafts are owner/workspace scoped, expire after seven days, and are cleared on logout or
  workspace change rather than becoming an indefinite cross-context browser cache.
- Markdown raw HTML is not rendered; dangerous links and embedded/insecure image URLs are blocked;
  remote HTTPS images require explicit user consent.
- Mermaid rendering is lazy, serialized, size/time/complexity bounded, and sanitized before the
  intentionally isolated `dangerouslySetInnerHTML` sink.
- Dashboard CI gained secret scans, production/full dependency audits, type/lint/build gates, focused
  hostile-input tests, and desktop/mobile Chromium smoke coverage.

**Trade-off / limitation**

- CSP is still report-only. Earlier preview evidence included inline-style violations, so switching
  directly to enforcement could break UI without a new clean evidence window.
- Browser drafts remain plaintext in local storage by design. Their shortened, scoped lifecycle
  reduces exposure but is not client-side encryption.

### Phase 6 — security assurance

**Better**

- Backend and dashboard gained reproducible assurance commands, tracked-secret scans, dependency
  gates, pinned CI actions, an ephemeral PostgreSQL CI service, and focused adversarial tests for
  webhook, JWT, proxy, authorization, Markdown/Mermaid, encryption, payload, and concurrency paths.
- The exercise surfaced three concrete gaps instead of silently claiming readiness.

**Still open**

- F-01 through F-03 below have not been remediated.
- The remote ephemeral-PostgreSQL workflow was not dispatched because GitHub authentication was not
  available, and no isolated hosted database/synthetic secret set exists for safe staging.

### Phase 7 — public Study architecture

**Better**

- The architecture now specifies tenant membership/capabilities, founder compatibility, per-tenant
  encrypted Canvas OAuth custody, a separate Study bot identity, tenant-scoped jobs/leases/quotas,
  audit/export/deletion, threat controls, and staged cohort rollout.
- The dashboard boundary keeps provider credentials out of the browser and treats a selected
  workspace as a candidate requiring server authorization, not proof of access.

**Not implemented**

- Phase 7 changed documents only. There is no public bot, invitation flow, Canvas OAuth tenancy,
  public Study schema/runtime, cohort, or general-availability claim.

## Current findings requiring owner decisions

### F-01 — High: Canvas pagination can forward the bearer token cross-origin

- **Location:** `src/services/studyCanvas.ts:726-756`, especially the unvalidated `Link` value at
  line 736 and unconditional bearer attachment at line 756.
- **Evidence:** `nextCanvasLink()` accepts an absolute next URL supplied by the response. The next
  loop iteration passes it to `canvasFetch()`, which attaches `CANVAS_ACCESS_TOKEN` without proving
  that its origin matches `CANVAS_BASE_URL`.
- **Impact:** a malicious or compromised Canvas response could direct the token to another host.
- **Recommended fix:** parse every pagination URL, require exact protocol/host/port equality with
  the configured Canvas origin, reject credentials/userinfo and downgrade redirects, add hostile
  redirect tests, then rotate the Canvas token after a deployed fix.
- **Interim mitigation:** pause Canvas sync if provider integrity is in doubt; use the least-privilege
  token available and monitor unexpected Canvas-sync destinations/failures.
- **False-positive note:** normal Canvas responses are expected to return same-origin links, but the
  application currently does not enforce that trust assumption.

### F-02 — Medium: dashboard service JWT identifiers are not replay-consumed

- **Location:** `src/dashboard/auth.ts:69-107`; explicit pending test at
  `src/dashboard/auth.test.ts:74`.
- **Evidence:** issuer, audience, EdDSA algorithm, lifetime, subject, and JTI shape are validated, but
  a successful JTI is not stored/consumed. The same captured signed token can therefore be replayed
  until its short expiry.
- **Impact:** an attacker who obtains a valid BFF-to-backend token has a replay window of up to 120
  seconds and can repeat authorized requests.
- **Recommended fix:** choose a shared, atomic, TTL-backed replay store or a request-signing design;
  consume JTI before mutation while preserving safe retries/idempotency. Do not use per-instance
  memory in a horizontally scaled deployment.
- **Interim mitigation:** retain the short maximum age, TLS-only transport, strict audience/issuer,
  narrow backend exposure, and avoid logging authorization headers.

### F-03 — Medium availability/cost gap: no principal/route HTTP rate limit

- **Location:** backend route registration in `src/server.ts` and `src/dashboard/route.ts`; current
  provider cooldowns in `src/ai/openaiProvider.ts` are not an application ingress limit.
- **Evidence:** body sizes, timeouts, queues, leases, provider retries/cooldowns, and pagination caps
  exist, but no shared per-principal/per-route request budget is enforced at ingress.
- **Impact:** valid sessions, valid webhooks, or automation can sustain database, provider, and queue
  load, causing availability degradation or avoidable AI/provider cost.
- **Recommended fix:** define route classes and principal keys, use a shared atomic limiter with
  explicit burst/sustained budgets, preserve webhook retry/idempotency behavior, and validate it in
  synthetic hosted staging before production enforcement.
- **Interim mitigation:** keep existing payload/job/provider bounds and use host/provider monitoring
  and emergency feature-disable controls.

### F-04 — High operational blocker: production privacy activation is not recoverability-proven

- **Location:** `docs/PHASE3_PRIVACY_RUNBOOK.md` Gate 3A and the Phase 2 production inspection.
- **Evidence:** current provider backup/PITR, isolated restore, and exact encryption-key recovery were
  not proven during the cycle.
- **Impact:** applying privacy migrations or deleting retained plaintext without recoverability
  evidence could turn a remediation into irreversible data loss.
- **Recommended action:** complete Gate 3A with dated, independently verifiable evidence before any
  Phase 3/4 production activation. This is a safety prerequisite, not optional paperwork.

## Maintainability and scalability audit

### Improvements

- Security, migration, scale, and rollout decisions are now durable in runbooks rather than trapped
  in chat context.
- Focused service helpers, transaction boundaries, response budgets, synthetic scale fixtures, and
  CI commands make high-risk behavior easier to reason about and reproduce.
- Guarded phases use additive migrations, mixed-state reads, checkpoints, dry runs, and explicit
  rollout/rollback gates rather than a one-shot rewrite.

### Remaining debt

- Backend files over 1,000 lines include `src/community/index.ts` (2,793),
  `src/bot/studyCapture.ts` (1,815), `src/dashboard/data.ts` (1,306),
  `src/bot/study.ts` (1,292), `src/services/study.ts` (1,274), and several others. Dashboard
  `src/components/dashboard-app.tsx` (1,359) and `src/components/study-dashboard.tsx` (1,239) are
  also broad. This raises review cost and regression risk even though current tests are strong.
- The seven-phase backend branch adds 4,193 lines and removes 266 across 61 files from its Phase 1
  baseline. The guarded dashboard phase stack adds 1,106 lines and removes 106 across 35 files from
  current `main`. This is reviewable but should be merged/deployed in gated units, not as an opaque
  all-at-once release.
- The Study Work module filter is now branded, but legacy native selectors still exist in Library,
  older Deep Work/settings/editor forms, and some non-Study dashboard forms. They are functional and
  not a security defect, but dashboard-wide control consistency remains incomplete.
- The design review still reports one pre-existing autofocus warning and five informational
  hardcoded-color observations. The requested picker change introduced no new 21st review error.
- Next.js emits a multiple-lockfile/worktree-root warning in this guarded checkout. The production
  build passes, but explicitly configuring the tracing/Turbopack root would make worktree builds less
  noisy and reduce false alarms.

## Requested Study Work correction

- Replaced the Work toolbar's legacy `ModuleSelect`/native browser menu with
  `StudyChoicePicker`.
- Preserved the internal `all` value by mapping it to the picker's empty placeholder and mapping an
  empty selection back to `all`.
- Added desktop/mobile toolbar rules so the branded 46 px trigger retains the existing layout.
- Added a focused regression proving that the Work component no longer contains a native selector
  and that its value mapping/placeholder remain intact.
- Did not opportunistically replace unrelated selectors during an audit-oriented change.

## Validation evidence from this audit

### Dashboard

- Full unit/component suite: **27 files, 119 passed**.
- Focused Work/UI regression suite: **8 passed**.
- Focused security assurance: **9 files, 52 passed**.
- Playwright: **5 passed, 1 intentional mobile skip**.
- TypeScript, ESLint, and optimized Next.js production build: **passed**.
- Tracked secret scan: **149 files, passed**.
- Production-only and complete dependency audits: **0 vulnerabilities**.
- 21st UI review: **0 errors**, one pre-existing autofocus warning, five informational color notes.

### Backend

- Complete deterministic rerun: **117 files, 886 passed, 6 skipped, 2 explicit TODO findings**.
- First concurrent run: one Excel test failure; focused rerun: **2/2 passed**; one-worker complete
  rerun passed. Record as concurrency/test-environment instability unless it becomes reproducible.
- Focused security assurance: **15 files, 136 passed, 2 explicit TODO findings**.
- TypeScript typecheck/build and Prisma schema validation: **passed**.
- Tracked secret scan: **383 files, passed**.
- Production-only and complete dependency audits: **0 vulnerabilities**.

## Audit limitations

- No active penetration testing, load attack, provider abuse, forged Telegram mutation, or live
  production data sampling was performed.
- No safe hosted staging environment with an isolated database and synthetic credentials was
  available.
- Production headers/configuration and the live branch/release were not re-probed in this pass.
- Static sink searches include intentional, bounded uses (for example sanitized Mermaid SVG and
  trusted local worker process launches); they were manually separated from actionable findings.
- Passing tests and audits reduce known risk but do not prove absence of vulnerabilities.

## Recommended next decision sequence

1. Review and authorize a bounded remediation for F-01 first; deploy it and rotate the Canvas token.
2. Choose shared replay/rate-limit architecture, then implement F-02 and F-03 with synthetic tests.
3. Provision isolated hosted staging and synthetic credentials; dispatch the remote ephemeral
   PostgreSQL workflow and run the Phase 6 matrix there.
4. Complete Gate 3A before considering Phase 3/4 production activation.
5. Merge/deploy in reviewable gates: security remediations, Phase 3 privacy, Phase 4 scale, Phase 5
   browser hardening/CSP evidence. Do not bundle Phase 7 public Study implementation into that work.
6. Only after the safety work above, decide whether to begin Phase 7 Stage 7.1 tenant foundations.

The Work selector correction may be reviewed and published independently of these security gates.
