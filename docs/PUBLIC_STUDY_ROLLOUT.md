# Public Study staged implementation and rollout

Date: 2026-08-17 SGT  
Status: **planning only; no implementation, migration, deployment, or invitations authorized**

This runbook turns the Phase 7 architecture into reviewable slices. It intentionally prevents a
single change from combining tenancy, credential migration, a new bot, public traffic, and
destructive lifecycle operations.

## Global invariants

- The founder Study workspace remains sealed and operational through its current gate until an
  explicitly approved cutover stage.
- No friend/public user is asked to provide a manual Canvas token. OAuth or no Canvas.
- No production migration runs before Gate 3A proves current backup, isolated restore, and
  independent encryption-key recovery.
- No public/cohort traffic runs before Phase 6 F-01–F-03 are remediated and remote ephemeral
  PostgreSQL CI passes.
- Staging uses dedicated synthetic data, database, bot, Canvas account/key, provider limits, and
  secrets. It never falls back to production configuration.
- Every stage has an off switch and a rollback that does not require deleting the founder data.

## Stage 7.0 — architecture record

Deliverables:

- canonical architecture, threat model, dashboard contract, and this rollout plan;
- current-code traceability and explicit dependency gates;
- no runtime/schema/configuration changes.

Exit gate:

- documents are internally consistent, reviewed, and pushed on guarded Phase 7 branches;
- Phase 7 is recorded as architecture-complete but implementation-not-started.

Rollback: revert documentation commits only.

## Stage 7.1 — tenant foundations

Scope:

- additive Study workspace kind/lifecycle fields;
- `StudyMembership` and centralized capability definitions;
- bot installation/binding metadata without a real new bot;
- tenant-scoped audit envelope;
- schema invariant and authorization unit tests;
- founder membership backfill utility in dry-run-only default mode.

Do not include Canvas OAuth, job scheduler conversion, public UI, or bot registration.

Validation:

- two synthetic tenants cannot cross-read/mutate any representative Study object;
- exactly one active owner invariant and ownership-transfer failure cases;
- founder rows are unchanged in dry run;
- mixed legacy/new reads remain compatible;
- migration rollback is proven on an isolated restored database.

Activation gate: Gate 3A plus separate approval to apply the additive migration/backfill.

Rollback: code rollback while additive tables remain dormant; before any destructive legacy cleanup,
drop only unused additive structures according to an reviewed down plan.

Recommended setup: GPT-5.6 Sol high for schema/authorization design; Terra medium for mechanical
tests after interfaces are fixed. xhigh/Ultra are not required.

## Stage 7.2 — authorization shadow and service scoping

Scope:

- every Study dashboard and Telegram service accepts a canonical authorized scope;
- new authorization runs in shadow beside the legacy founder gate;
- queries, caches, dedupe keys, audit events, and content/media routes are checked for workspace
  scope;
- remove process-global workspace selection from new/public code paths;
- cross-tenant IDOR suite covers every route/object type.

Shadow rules:

- legacy gate remains authoritative;
- record only safe allow/deny parity metrics, not ids or content;
- any unexpected new-allow decision is a release blocker;
- public selection of `FOUNDER_PRIVATE` is always denied.

Exit gate: sustained exact authorization parity for founder flows plus complete synthetic tenant
matrix. No route may rely on UI visibility.

Rollback: disable shadow computation; legacy founder path continues unchanged.

## Stage 7.3 — Phase 6 remediation and shared abuse controls

This stage may be implemented before or alongside 7.1/7.2 on its own bounded remediation branches,
but it is a hard dependency for public traffic.

Scope:

- F-01 same-origin Canvas pagination/redirect enforcement and founder token rotation plan;
- F-02 selected durable mutation replay/idempotency model;
- F-03 route-class principal/workspace/webhook rate limiting with bounded shared storage;
- repeat full Phase 6 local and remote ephemeral-database assurance.

Exit gate: findings closed with tests, remote CI passing, no regression, and user review. Token
rotation and production deployment remain separately approved operations.

## Stage 7.4 — Canvas OAuth connection custody

Scope:

- institution allowlist and developer-key configuration;
- authenticated state + PKCE authorization-code flow;
- per-user/workspace encrypted connection store and key versions;
- serialized refresh, reauth state, disconnect/revoke, last-use visibility;
- jobs reference `connectionId` and canonical origin, never credentials;
- same-origin pagination/redirect enforcement;
- connection-specific Canvas provenance.

Fallback: if an appropriate developer key is unavailable, leave Canvas absent from the beta.

Validation:

- fake-provider hostile callback/refresh/pagination suite;
- credential tamper, ciphertext swap, wrong key, rotation, interruption, and retry;
- browser/network/log/Telegram inspection shows no token material;
- collaborative workspace cannot silently expose one member's Canvas data to another.

Rollback: disable new connections and sync; revoke test tokens; keep encrypted rows quarantined for
a short rollback window, then delete according to the approved retention plan.

## Stage 7.5 — fair tenant work scheduler

Scope:

- durable tenant job envelope, leases, idempotency, priority class, cost estimate, safe error code;
- per-tenant and global Canvas/AI/OCR concurrency;
- deficit round-robin or equivalent deterministic fairness;
- quota policy/state and admission control;
- workspace-scoped reminders and bot binding at send time;
- job/queue aggregate observability and independent feature kill switches.

Validation targets must be set before implementation. Minimum synthetic shape:

- at least 100 tenants;
- one tenant producing sustained heavy work;
- light tenants continue within the agreed maximum service delay;
- worker crashes before and after provider/delivery boundaries;
- multi-instance claim/retry behavior;
- quota reset, suspension, reactivation, and clock-boundary tests.

Rollback: disable public admissions and return queued jobs to a safe pending/cancelled state; founder
legacy scheduler remains available until cutover.

## Stage 7.6 — dashboard and separate Study bot staging

Provision only in isolated hosted staging:

- separately branded Study test bot/token/webhook secret/path/menu;
- Study BFF/app identity or explicitly separated Study route/product shell;
- synthetic database and secrets;
- synthetic Canvas/provider accounts;
- product-specific telemetry and kill switches.

Required exercises:

- wrong product webhook/update replay;
- sign-in, workspace discovery, suspended/removed membership;
- two-tenant CRUD/search/media/analysis/export boundaries;
- browser cache/storage/CSP/logout behavior;
- bot block/unblock/rebind and stale queued reminder;
- provider failure, quota exhaustion, and safe degraded mode;
- backup, restore, key recovery, and complete environment teardown.

Exit gate: all architecture/threat-model acceptance tests pass in a network-reachable environment.

Rollback: disable webhook and bot token, invitations, jobs, and hosted staging service; preserve only
redacted test evidence needed for review, then delete synthetic tenant data.

## Stage 7.7 — invite-only cohort

Initial cohort: 5–10 explicitly invited users using private chats and personal Study workspaces.
Collaborative workspaces remain disabled.

Entry criteria:

- prior stages and blockers complete;
- privacy notice, AI consent, Canvas disclosure, export/delete, and support guidance reviewed;
- incident response owner, support path, kill-switch owner, and rollback thresholds assigned;
- conservative quotas and invitation cap configured;
- cohort users understand beta limits and may use Study without Canvas or AI.

Measure only safe aggregates:

- onboarding completion and failure reason;
- daily/weekly active tenants;
- Canvas connection/sync/reauth outcomes and latency;
- queue service delay/fairness, quota/rate-limit outcomes, duplicate delivery;
- AI result validation/failure and opt-out;
- export/delete/disconnect success;
- privacy/security support reports;
- backend error budget and effect on Threadwise/Beacon.

Stop/rollback triggers:

- any confirmed cross-tenant access;
- any secret/token in logs, browser, Telegram, export, or job payload;
- incorrect deletion or unrecoverable migration;
- repeated wrong-chat reminders;
- shared-service degradation beyond the agreed error budget;
- queue starvation, uncontrolled provider cost, or missing kill-switch behavior.

Rollback: close invitations, disable Study webhook/new jobs/reminders, preserve user-visible access to
export/delete where safe, revoke provider connections as requested, and return to a reviewed build.
Never roll back by restoring one user's data over another tenant.

## Stage 7.8 — limited beta and general-availability decision

Limited beta expands gradually (for example 25, then 100 tenants) only after a cohort review. Raise
quotas only from measured evidence. Collaborative Study, additional institutions, billing, or
institution-admin functionality require their own architecture/security review.

General availability requires:

- no unresolved critical/high tenant or credential finding;
- completed privacy/threat-model re-review against implemented code;
- restore and key-rotation rehearsal at the deployed scale;
- export/deletion SLO evidence;
- incident response and breach-notification readiness;
- capacity/cost model and fair scheduling evidence;
- user-facing privacy/security documentation that matches runtime behavior;
- explicit owner approval.

## Founder workspace cutover

The founder workspace is not a cohort canary. Cut it over only after invited tenants prove the new
path. Required sequence:

1. current founder data backup/restore/key evidence;
2. dry-run founder membership/bot-binding/connection mapping;
3. authorization shadow parity and data-count invariants;
4. read-only new-path preview;
5. explicit owner cutover approval and short maintenance window;
6. reversible switch to the new private workspace path;
7. production validation of ordinary capture/search/reminder/Canvas/analysis/export flows;
8. retain legacy gate as disabled rollback for a bounded window;
9. retire global Study identity/Canvas configuration only in a later approved cleanup.

No cohort milestone alone authorizes this cutover.

## Documentation and handoff required at every stage

Update `PROJECT_CONTEXT.md`, the security roadmap, relevant runbook/report, and both repository
working logs with:

- authorization and exact scope;
- branch/baseline/commit;
- invariants and exclusions;
- schema/config/code changed;
- tests and hosted evidence;
- migration/deployment state;
- rollback state;
- blockers and exact next safe action;
- recommended model/effort for that next action.

Phase 7 architecture completion should leave the next safe action as **Stage 7.1 tenant foundations
design/implementation only**, pending explicit approval. It must not silently begin that stage.
