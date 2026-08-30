# Threadwise security remediation roadmap

This document is the durable, cross-repository plan for addressing the security,
privacy, scalability, reliability, and maintainability findings reviewed on
2026-08-17. Execution status is recorded explicitly below; an unmarked phase is
not authorized or complete.

The active cross-repository checkpoint remains
[`../PROJECT_CONTEXT.md`](../PROJECT_CONTEXT.md). Update both documents before a
phase begins, after each material checkpoint, before an interruption, and when a
phase is validated or rolled back.

## Current state

- Status (2026-08-31): **The guarded Phase 1-6 runtime stack was reviewed, Gate 3A was proven, and the
  paired stack was released. Phase 7 public-Study architecture is complete; multi-tenant public Study
  implementation and activation have not started.**
- Gate 3A passed with an encrypted logical backup, isolated restore comparison, all migrations, and
  independently attested encryption-key recovery before release.
- Phase 6 F-01 through F-03 are remediated in current `main`: Canvas pagination/material URLs are
  origin/path constrained and redirects refused; dashboard mutation JTIs are consumed in a shared
  replay store; and shared ingress/principal/operation rate limits are active.
- CSP enforcement evidence and hosted synthetic authenticated staging remain open. CSP is deliberately
  report-only because current dynamic style attributes produce violations and would break under the
  present enforced policy.
- Destructive historical content backfill and retention deletion remain separate, explicitly gated
  operations; their absence is not a failed ordinary deployment.
- The 2026-08-17 state remains in `docs/POST_PHASE7_CODEBASE_AUDIT.md` as historical evidence. The
  current reconciliation is `docs/POST_RELEASE_CODE_UI_SECURITY_AUDIT_2026-08-31.md`.
- Phase 1 execution baseline: backend `9856f0d3019caca4d0fe584ac3196f136357545d` and dashboard
  `bc949f19f8d85c26c66c5a9c9bbd322caa818609`, both clean on `main` at the start of work.
- Backend baseline at audit: `d81536acd9e9762184f9fbdb67f7ce5b7755d42f`.
- Dashboard baseline at audit: `ad6e59391eb4a85585556b9b86b145c325dd07b9`.
- Both worktrees were clean when the audit ended.
- The audit was static code/configuration review plus production-header and
  dependency inspection. It was not an active penetration test, production data
  dump, full Git-history secret scan, or destructive database exercise.
- No old poisoned Codex task or rollout is needed or permitted for this work.

### Phase 1 completion record (2026-08-17 SGT)

- Phase 1A shipped in backend runtime commit `5630f1e`: the primary Telegram registration now uses
  a dedicated secret header, Fastify validates it before grammY, the route is rotated, and route/URL
  logging is removed. Render and Telegram hold the secret; it was never exposed to local files,
  logs, Git, documentation, or chat. Production health is HTTP 200, the new registration has no
  reported error or pending update, and the retired/missing/forged request paths return opaque 404s.
- Phase 1B shipped in dashboard runtime commit `5bf0ab4`: Next.js/ESLint config moved from `16.2.10`
  to stable patch `16.2.12`, with shipped Nano ID/PostCSS/Sharp paths pinned to patched versions.
  The production audit moved from four high findings to zero. Two development-only advisories remain
  outside the shipped graph and were not force-overridden across incompatible ranges in this bounded
  production release.
- Validation passed: backend TypeScript/build, focused security/integration tests, 866 full-suite
  passes plus 6 intentional skips, and zero-production-finding audit; dashboard 35 focused tests,
  all 91 tests, TypeScript, ESLint, clean production build, zero-production-finding audit, Vercel
  exact-commit success, and canonical route HTTP 200.
- Rollback was not needed. Phase 2 was subsequently authorized and completed read-only; its result
  is recorded below and in `docs/SECURITY_PHASE2_PRIVACY_INSPECTION.md`.

## Established findings that drive the plan

1. **Critical — primary Telegram webhook authentication.** The main webhook is
   registered without Telegram's `secret_token` and its Fastify route accepts
   updates without validating `X-Telegram-Bot-Api-Secret-Token`. Beacon already
   demonstrates the intended constant-time validation pattern.
2. **High — plaintext AI-analysis duplication.** Analysis jobs retain bounded but
   sensitive evidence, prompts, results, and full original/suggested note bodies
   outside the current content-encryption policy, with no discovered retention
   cleanup.
3. **High — dashboard dependency advisories.** The production audit reported four
   high-severity packages, including the direct Next.js `16.2.10` dependency.
   Several exploit paths appear unused, but the production framework still needs
   a controlled patch and regression pass.
4. **High scalability risk — oversized Study snapshots.** The snapshot loads and
   decrypts up to 400 full Study resources before truncating them for transport,
   alongside other bounded collections. This is acceptable only at the current
   tiny scale.
5. **Public-Study blocker — singleton tenancy.** Study authorization and Canvas
   access are currently bound to one configured owner, one chat, and one Canvas
   token. The checks are appropriately fail-closed and must not be relaxed to
   simulate multi-tenancy.
6. **Medium — incomplete encryption posture.** Phase 2 confirmed production write mode is enabled,
   but historical content remains mostly plaintext. Blind search tokens are appended on updates,
   so removed terms can remain represented and arrays can grow.
7. **Medium — non-atomic note side effects.** A note row can be committed before
   its revision, backlinks, and audit record. A later failure may return an error
   after the primary save already succeeded.
8. **Medium — browser hardening and client availability.** The dashboard has no
   Content Security Policy; local drafts have no expiry/logout cleanup; arbitrary
   remote Markdown images reveal normal network metadata; Mermaid has no
   diagram-specific complexity budget.
9. **Medium maintainability risk.** Several backend and dashboard modules exceed
   1,000 lines, dashboard UI regressions often assert source strings rather than
   behavior, the dashboard has no CI workflow, and some analysis documentation
   still describes the retired Gemini CLI worker instead of server-side OpenAI.

## Global execution rules

- Work on one bounded subphase at a time. Do not combine an authentication patch,
  data migration, performance redesign, and broad refactor in one release.
- Start every subphase by recording scope, expected files, invariants, validation,
  rollback, model, and reasoning effort in `PROJECT_CONTEXT.md`.
- Update the checkpoint after implementation, after local validation, after
  staging, after production deployment, and before any interrupted stop.
- Never place secrets, tokens, raw private content, production dumps, embedded
  images, or large command output in documentation or conversational context.
- Use synthetic or redacted data for tests. Production inspection must aggregate
  metadata and counts rather than print user content.
- Test active attacks against a staging deployment with dedicated test identities.
  Production verification must be bounded, non-destructive, rate-limited, and
  explicitly approved.
- Back up and prove a rollback path before any data migration, encryption backfill,
  retention deletion, credential rotation, or destructive cleanup.
- Keep changes reviewable and reversible. Prefer separate commits for runtime
  behavior, migrations/backfills, tests, and documentation when that separation
  materially improves rollback.
- Do not publicize Study mode by weakening the current owner/chat gate. Public
  Study is a separate multi-tenant architecture phase.

## Phase 1 — immediate containment

### Phase 1A: authenticate and rotate the primary Telegram webhook

Status: **completed in backend runtime commit `5630f1e` (2026-08-17)**.

Objectives:

- Add a dedicated random webhook secret distinct from the webhook path.
- Pass it to Telegram as `secret_token` during webhook registration.
- Validate the Telegram secret header in constant time before grammY receives an
  update; reject missing or mismatched values without revealing the route.
- Rotate the webhook route/secret and stop logging secret-bearing values.
- Preserve Beacon behavior and keep the two webhook identities isolated.

Validation gate:

- Focused tests for missing, malformed, invalid, and valid secret headers.
- Forged updates cannot reach any bot handler.
- Real staging Telegram updates work after registration and rotation.
- Old route/secret is rejected; production health and legitimate bot flows remain
  healthy after deployment.

Recommended model: **GPT-5.6 Sol, high reasoning**. Ultra is not justified.

### Phase 1B: patch production dashboard dependencies

Status: **completed in dashboard runtime commit `5bf0ab4` (2026-08-17)**.

Objectives:

- Patch Next.js to a non-vulnerable compatible version and refresh its vulnerable
  transitive packages without opportunistic unrelated upgrades.
- Re-run dependency audit and all dashboard gates.
- Review release notes and generated lockfile changes for behavior or deployment
  implications.

Validation gate:

- Focused authentication/proxy tests, full tests, TypeScript, ESLint, production
  build, and staging smoke tests pass.
- Production dependency audit contains no unresolved high advisory in the shipped
  dependency path, or any exception is explicitly documented and approved.

Recommended model: **GPT-5.6 Terra, medium reasoning**. Escalate to Sol medium only
if the patch introduces a real framework incompatibility.

## Phase 2 — read-only production privacy and data inspection

Status: **completed read-only on 2026-08-17; no production writes occurred**.

Do this only after Phase 1 containment. The inspection is deliberately narrow and
must not read or export private note text merely for convenience.

Inspect and record only safe aggregates:

- Presence and effective mode of content-encryption configuration; never display
  the encryption key. A non-secret fingerprint may be used only if necessary to
  confirm that two controlled environments use the intended key.
- Encrypted-versus-plaintext row/field counts for each protected model.
- AI job/suggestion counts, age distribution, aggregate byte estimates, and
  retention state without outputting evidence, prompts, or note bodies.
- Blind-search-token count distributions and outliers.
- Cross-workspace relationship anomaly counts.
- Study resource, OCR, snapshot, and revision size distributions.
- Database backup, point-in-time recovery, and restore-test readiness.

Deliverable: a redacted inspection report, remediation/backfill design, rollback
plan, and explicit user approval gate before any write.

Outcome: the guarded inspection verified a read-only transaction, found 190 encrypted versus
926 plaintext protected field values, confirmed zero malformed envelopes and zero anomalies across
26 cross-workspace relationship checks, measured unretained AI duplicates, and confirmed blind
search-token accumulation. Backup/PITR/restore readiness remains a control-plane prerequisite.
See `docs/SECURITY_PHASE2_PRIVACY_INSPECTION.md`. Phase 3 was subsequently authorized for guarded implementation.

Recommended model: **GPT-5.6 Terra, medium reasoning** for bounded evidence
collection; **GPT-5.6 Sol, high reasoning** for migration and threat analysis.

## Phase 3 — privacy and encryption remediation

Status: **implementation and synthetic validation complete; production schema deployment,
backfill, diagnostics minimization, and retention deletion are not activated**. Gate 3A still
requires evidence of a current provider backup, an isolated restore test, and independent
recovery of the content-encryption key. The implementation is intentionally published on a
non-production branch until that evidence exists. See `docs/PHASE3_PRIVACY_RUNBOOK.md`.

Objectives:

- Extend encryption coverage to AI evidence, prompts, results, original note
  bodies, suggested bodies, and any other sensitive duplicates that need to remain.
- Minimize what must be stored at all; prefer hashes, references, and bounded
  redacted summaries where full content is unnecessary.
- Define retention windows for pending, completed, failed, and superseded analysis
  jobs and suggestions.
- Add a dry-run cleanup path, auditable deletion, bounded batches, restart safety,
  and failure recovery.
- Replace rather than indefinitely append blind search tokens when protected
  searchable content changes; provide a safe token-rebuild migration.
- Add tests that fail when newly introduced sensitive fields bypass the intended
  encryption/retention boundary.
- Keep the product's privacy explanation accurate. Server-side encryption remains
  distinct from client-side/end-to-end encryption.

Validation gate:

- Backups and rollback are proven before backfill or deletion.
- Migration dry run succeeds on staging-shaped data.
- Mixed plaintext/ciphertext compatibility, key absence, retry, interruption, and
  rollback cases are tested.
- Production verification reports aggregates only.

Recommended model: **GPT-5.6 Sol, high reasoning**. Use **Sol xhigh** only for one
bounded final review of an irreversible migration/backfill if it provides a clear
quality gain. Do not use Ultra by default.

## Phase 4 — Study scalability and transactional reliability

Status: **implementation and synthetic validation complete on the non-production
`codex/phase4-study-scalability` branch; production schema deployment, backfill,
activation, and load testing have not occurred**. The branch is stacked on Phase 3 and
inherits Gate 3A. See `docs/PHASE4_STUDY_SCALE_RUNBOOK.md`.

Objectives:

- Replace full-resource snapshot reads with selected preview fields or precomputed
  excerpts, pagination, and dedicated detail endpoints for full bodies.
- Establish explicit payload, query, concurrency, and latency budgets.
- Make note update, revision, backlink rebuild, and audit recording atomic, or use
  a durable outbox where a single transaction is unsuitable.
- Incrementally resolve wiki links rather than scanning every active note on every
  save where feasible.
- Bound revision payloads and evaluate diff/compression only after measuring real
  data.
- Add synthetic large-workspace and concurrency tests without using production
  content.

Validation gate:

- Contract and behavioral tests prove no loss of note bodies, search, backlinks,
  revisions, Telegram fallbacks, or optimistic concurrency.
- Load tests demonstrate bounded memory, query count, payload size, and latency at
  a documented target scale.

Recommended model: **GPT-5.6 Sol, medium reasoning**; use high for schema or
transaction redesign. Terra medium is appropriate for mechanical pagination and
test expansion after the design is fixed.

## Phase 5 — browser hardening and maintainability

Status: **implemented and locally validated on `codex/phase5-browser-hardening` in both repositories;
no deployment or production configuration change is authorized by completion alone**.

Objectives:

- Introduce and stage a nonce-based Content Security Policy without papering over
  failures using broad `unsafe-*` directives.
- Add local-draft expiry and logout/workspace cleanup while preserving crash-safe
  recovery.
- Decide and enforce a policy for remote Markdown images: allowlist, same-origin
  proxy, or explicit click-to-load. Prefer HTTPS for external media.
- Add Mermaid source/complexity budgets, deferred rendering, and safe failure UI.
- Add dashboard CI on pull requests and `main`, dependency scanning, and meaningful
  browser/component tests for authentication, focus, scrolling, Markdown safety,
  and responsive behavior.
- Split the largest modules gradually along domain and interaction boundaries; do
  not mix broad file moves with security behavior changes.
- Reconcile provider and worker documentation with the current server-side OpenAI
  implementation.

Recommended model: **GPT-5.6 Terra, medium reasoning** for CI, tests, documentation,
and bounded component work; **GPT-5.6 Sol, medium reasoning** for CSP design and
large responsibility splits.

Completion record (2026-08-17 SGT):

- Added a nonce-bearing CSP pipeline with report-only staging as the safe default and an explicit
  enforcement switch. The policy contains no `unsafe-inline` or `unsafe-eval`; report-only evidence
  still identifies inline style attributes, so enforcement is intentionally deferred to a preview
  rollout governed by the dashboard `docs/CSP_ROLLOUT.md` runbook.
- Versioned local drafts now expire after seven days, are scoped to owner/workspace/resource, reject
  malformed or future records, and clear on logout or workspace changes. Remote Markdown images are
  same-origin by default and require explicit click-to-load consent for HTTPS third-party hosts;
  insecure, protocol-relative, and embedded data images are blocked.
- Mermaid rendering is viewport-deferred, serialized, time- and complexity-bounded, strict-security,
  and sanitized after rendering. Markdown media/Mermaid responsibilities were split from the generic
  renderer without a broad file move.
- Dashboard CI now runs a tracked-file secret scan, full and production dependency audits, 99 unit/
  component tests, TypeScript, ESLint, production build, and Chromium desktop/mobile smoke coverage.
  Local final validation passed all gates (five browser passes and one intentional mobile skip), with
  zero dependency findings. Backend documentation passed all 884 tests (6 intentional skips),
  TypeScript, build, and zero-finding audits after a non-breaking development-only lockfile refresh.
- Production, hosted configuration, databases, migrations, and active security testing were not
  touched. Phase 6 and Phase 7 remain separate approval boundaries.

## Phase 6 — active security assurance

Status: **local synthetic assurance and CI infrastructure completed on
`codex/phase6-security-assurance` (backend `be7d2ec`, dashboard `bf9c948`); three findings await
review, the remote ephemeral database workflow awaits authenticated dispatch, and hosted staging is
blocked on a proven isolated database/credential set**. See `docs/SECURITY_PHASE6_ASSURANCE.md`. No finding has
been remediated silently, and production was not tested or changed.

Begin only after the known critical boundary and plaintext duplication are
remediated. Create a staging deployment with synthetic users, chats, workspaces,
provider responses, and credentials.

Test at minimum:

- Telegram webhook spoofing, replay, wrong-secret, stale-route, and malformed
  update behavior.
- Authentication, authorization, membership changes, and IDOR across personal,
  group, Study, and Beacon boundaries.
- Dashboard JWT issuer, audience, expiry, replay/JTI, workspace selection, proxy
  allowlist, origin, CSRF, and body/response limits.
- Stored/reflected Markdown and Mermaid XSS, dangerous URLs, remote media, and
  oversized diagram behavior.
- SSRF opportunities through provider URLs, Canvas/NUSMods material discovery,
  OAuth callbacks, media delivery, and external integrations.
- Rate limits, queue leases, duplicate delivery, concurrency, resource exhaustion,
  and interrupted-job recovery.
- Secret scanning and dependency/static analysis in CI.

Do not run destructive account deletion, forged bot mutations, large-payload
exhaustion, or provider abuse against production. After staging passes, production
verification is limited to safe configuration/header checks and dedicated test
identities under explicit approval.

Recommended model: **GPT-5.6 Sol, high reasoning**. Use deterministic tools for
bulk checks and the model for threat modeling, evidence interpretation, and
targeted investigation. Ultra is not required.

## Phase 7 — public Study architecture

This is a product architecture phase, not a permission change to the founder
workspace.

Status: **architecture completed on `codex/phase7-public-study-architecture`; no runtime,
schema, configuration, credential, bot, database, invitation, merge, or deployment change**.

Architecture publication commits: backend `77739bd`; dashboard `16687b3`.

Canonical records:

- [`PUBLIC_STUDY_ARCHITECTURE.md`](PUBLIC_STUDY_ARCHITECTURE.md)
- [`PUBLIC_STUDY_THREAT_MODEL.md`](PUBLIC_STUDY_THREAT_MODEL.md)
- [`PUBLIC_STUDY_ROLLOUT.md`](PUBLIC_STUDY_ROLLOUT.md)
- dashboard `docs/PUBLIC_STUDY_DASHBOARD_BOUNDARY.md` on its matching guarded branch

Required design:

- Tenant-scoped Study users, workspaces, ownership, memberships, authorization,
  audit, export, and deletion.
- Per-user or per-workspace encrypted Canvas credentials with revocation and
  rotation. Do not ask friends to place shared tokens in global environment
  variables.
- A separately branded Study Telegram bot and secret, while the shared backend may
  continue hosting multiple isolated bots.
- Tenant-scoped sync, analysis, reminders, quotas, leases, rate limits, abuse
  controls, and fair background-job scheduling.
- A privacy/threat-model review and staging cohort before general availability.

Recommended model: **GPT-5.6 Sol, high reasoning**. Consider xhigh only for the
final threat-model review when architecture and evaluation criteria are already
concrete.

## Model and effort policy for this roadmap

- **Terra low:** formatting, narrowly mechanical version/copy changes, and other
  fully specified edits with strong tests.
- **Terra medium:** routine implementation, dependency patches, CI, tests, and
  mechanical refactors after design decisions are settled.
- **Sol medium:** scalability work, ordinary architecture, and bounded refactors
  requiring judgment.
- **Sol high:** authentication, authorization, cryptography, sensitive data
  migrations, tenant boundaries, and penetration-test interpretation.
- **Sol xhigh:** one bounded quality-first review when an irreversible migration or
  security architecture decision has unusually high consequences. It is not the
  default implementation setting.
- **Ultra/max:** exceptional only. Parallel work must divide cleanly and produce a
  measured quality or latency benefit. Security work alone does not justify Ultra.

## Required handoff checkpoint for every subphase

Use this structure in `PROJECT_CONTEXT.md` before stopping or handing off:

```text
### Security roadmap — Phase X.Y checkpoint (date/time SGT)

- Status: not started | investigating | implementing | validating | staged |
  deployed | blocked | rolled back.
- Objective and authorization:
- Repository baselines and branch/commit:
- Invariants and out-of-scope items:
- Evidence inspected (no secrets/private payloads):
- Files/schema/config changed:
- Decisions and rejected alternatives:
- Tests and validation completed:
- Deployment/migration state:
- Rollback state:
- Known risks, uncertainties, and blockers:
- Exact next safe action:
- Recommended model and effort for that next action:
```

A phase is complete only when implementation, focused and full validation,
staging evidence, production verification where applicable, documentation, exact
commits, rollback status, and remaining limitations are recorded. Do not mark a
phase complete merely because code was written or pushed.

## Next authorized action

Phase 7 architecture is complete. The next safe public-Study product unit remains **Stage 7.1 tenant
foundations only**, but it is not authorized: wait for explicit approval before adding public-tenant
schema/runtime code, applying a public-Study migration, or beginning a cohort rollout.

Phase 6 F-01 through F-03 and Gate 3A are no longer blockers; they were completed before/currently in
the released stack. Current remediation candidates are listed in
`docs/POST_RELEASE_CODE_UI_SECURITY_AUDIT_2026-08-31.md` and still require owner prioritization before
runtime fixes. Dedicated hosted synthetic authenticated staging and clean CSP enforcement evidence
remain blockers before CSP enforcement or any public cohort. Do not provision staging, rotate
credentials, run destructive privacy tooling, create/register a public Study bot, connect a real
public Canvas tenant, invite users, or cut over the founder workspace without the corresponding
recorded approval and gate evidence.
