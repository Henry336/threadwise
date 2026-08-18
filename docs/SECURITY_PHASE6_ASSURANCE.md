# Phase 6 active security assurance

Date: 2026-08-17 SGT  
Status: **release remediation, validation, Gate 3A, and production activation complete**

This report contains no credentials, private payloads, production records, or provider
responses. Phase 6 used synthetic identities, chats, workspaces, tokens, bodies, provider
responses, and mocked persistence. The assurance run did not use production as a staging substitute;
the separately authorized release activation and read-only verification are recorded below.

## 2026-08-18 release-remediation checkpoint

The owner authorized release of the complete guarded stack. F-01 through F-03 are now implemented,
merged, and active in production:

- F-01 validates every Canvas material/pagination request against the exact configured origin and
  API path before attaching a bearer token, rejects URL credentials, and disables automatic
  redirects.
- F-02 consumes mutation JWT identifiers atomically in PostgreSQL using only hashed token/principal
  fingerprints. Safe reads remain retryable; a replayed mutation is rejected before its effect.
- F-03 uses shared PostgreSQL fixed-window buckets with hashed principals and separate dashboard
  read/write/expensive/stream, authenticated Telegram-actor, and remaining server-ingress budgets.
  Bounded `429` responses include `Retry-After`.

Complete local regressions, schemas, builds, secret scans, browser checks, and security assurance
pass. A newly published high-severity `deepmerge-ts` advisory discovered by the release audit is
resolved with the compatible 8.0.0 package override; both production-only and complete dependency
audits now report zero findings. Backend PR #17 passes its hosted isolated PostgreSQL 17 migration
and assurance job. Dashboard PR #2 passes hosted validate/browser jobs and its Vercel preview after
unit and Playwright discovery were explicitly separated. Gate 3A recoverability evidence, merge,
production deployment/verification, and post-fix Canvas-token rotation remained pending at that
checkpoint. Gate 3A subsequently passed using a fresh encrypted logical backup: all 95 public
tables and 21,563 rows matched an isolated restore, all release migrations applied cleanly,
temporary plaintext/restore
state was removed, and the owner confirmed independent recovery of the exact production content
key. See `docs/GATE3A_RECOVERY_EVIDENCE.md` for non-secret evidence. Historical Phase 6 evidence
below is preserved to show what originally caused each finding. Production activation subsequently
completed: backend merge `0699835d8ffe` is healthy on Render, the database reports all 60 migrations
and the three new security tables, dashboard merge `b00a3d15660a` completed on Vercel, and the
canonical demo route returned HTTP 200. Historical Canvas-token rotation remains the only immediate
operator follow-up from this release.

## Environment and safety boundary

- Backend baseline: Phase 5 commit `a440c0b`, branch `codex/phase6-security-assurance`.
- Dashboard baseline: Phase 5 commit `9d47b57`, branch `codex/phase6-security-assurance`.
- Published assurance commits: backend `be7d2ec`; dashboard `bf9c948`.
- Node/npx are available. Docker, Render CLI, an installed Render connector, and a proven
  dedicated non-production database/credential set are not available on this machine.
- The repository CI now defines an isolated PostgreSQL 17 service with synthetic credentials,
  applies every checked-in migration, and runs the bounded adversarial suite. That workflow must
  pass on GitHub before the branch can satisfy the ephemeral-database gate; it passed before merge.
- A network-reachable hosted staging deployment was **not** created. Doing so without a proven
  isolated database and synthetic secrets could accidentally cross the production boundary.
- The release branches were reviewed through backend PR #17 and dashboard PR #2. GitHub's remote
  PostgreSQL migration/assurance job and the dashboard validate/browser jobs passed before merge.
- CSP remains report-only under the separate Phase 5 rollout gate. Gate 3A passed and the additive
  Phase 3/4 schema/runtime release is active; destructive backfill/retention remains separately gated.

## Assurance matrix

| Boundary | Result | Evidence |
| --- | --- | --- |
| Telegram webhook spoofing, missing/wrong secret, retired route | Pass | Fastify injection rejects before the handler with opaque 404 responses. |
| Malformed and oversized Telegram webhook bodies | Pass | JSON parse failure and Fastify's body limit reject before the bot handler. |
| Telegram duplicate delivery/replay | Pass at update layer | `ProcessedTelegramUpdate` claims use a unique update id and `skipDuplicates`; duplicate work does not proceed. |
| Dashboard JWT issuer, audience, expiry, subject, lifetime, signature | Pass | Synthetic Ed25519 tokens fail closed on every tested invalid claim. |
| Dashboard JWT JTI replay | **Remediated and active** | Mutation JTIs are atomically consumed in shared PostgreSQL storage using hashed fingerprints. |
| Personal/group/Study/Beacon authorization and membership changes | Pass for covered boundaries | Signed identity is server-derived; personal records are owner-scoped; Telegram group authority is freshly checked before privileged mutations; Study/Beacon checks fail closed. |
| BFF workspace, route/method allowlist, origin/CSRF, JSON/body/response bounds | Pass | Extracted pure security helpers and adversarial allowlist tests cover wrong/missing origins, traversal/unsupported paths, malformed JSON, and size boundaries. |
| Markdown links/images and raw HTML | Pass | Raw HTML is skipped; executable/embedded link schemes are rejected; remote images require explicit consent; embedded/insecure images are blocked. |
| Mermaid XSS/resource exhaustion | Pass for local bounded renderer | Configuration directives and character/line/statement exhaustion are rejected; render work is serialized, timed out, strict-security rendered, and SVG-sanitized. |
| Canvas/NUSMods/transit/OAuth/media SSRF review | **Remediated and active** | Canvas credential-bearing requests now fail closed outside the configured API boundary and never auto-follow redirects. |
| Queue leases, duplicate delivery, concurrency, interrupted recovery | Pass for covered synthetic cases | File courier, voice transcription, task imports, Study analysis, Canvas sync recovery, and note/capture exact-once tests pass. |
| Application-level rate limiting/resource abuse | **Remediated and active** | Shared hashed-principal route-class buckets now cover dashboard, Telegram webhook, and remaining HTTP ingress. |
| Secret scan, dependency audit, type/static/build checks | Pass locally | Both tracked-file scans pass; complete and production npm audits report zero vulnerabilities; TypeScript, lint where configured, builds, and full tests pass. |
| Browser security/responsive smoke | Pass | Five Chromium desktop/mobile tests pass; one desktop-only palette check is intentionally skipped on mobile. |
| Hosted synthetic staging and safe production headers | Blocked/not run | No isolated hosted database/secret set or deployment connector is available; production verification requires separate approval. |

## Findings — historical evidence and implemented remediation

### F-01 — High: Canvas pagination can forward the Canvas bearer token to another origin

`src/services/studyCanvas.ts` extracts any URL from a Canvas `Link` header and supplies it directly
to `canvasFetch`. That fetch attaches `Authorization: Bearer <Canvas token>` to the supplied URL.
A compromised/misconfigured Canvas endpoint, malicious reverse proxy, or unexpected pagination
response could therefore redirect the next page to an attacker-controlled HTTPS origin and receive
the Canvas access token.

Recommended remediation: parse every pagination URL, require HTTPS, and require its origin to equal
the configured canonical `CANVAS_BASE_URL` origin before the request is made. Reject userinfo,
fragments, and cross-origin links. Add tests for same-origin absolute/relative links, alternate
ports, encoded host tricks, credentials in URLs, and cross-origin redirects. Do not merely strip
the header after following the link; fail closed before fetch.

Implemented: `requireCanvasApiUrl` enforces exact origin and API-path containment before fetch,
rejects userinfo/path escapes, and `fetchCanvasApiResponse` uses `redirect: "manual"` and rejects
all redirects. Hostile URL and redirect regressions are active rather than TODOs.

### F-02 — Medium: dashboard service JWT JTI is validated but not replay-consumed

`src/dashboard/auth.ts` requires a bounded JTI and a maximum 120-second token age, but verification
has no replay store. A captured BFF-to-backend bearer token can be reused until it expires, including
for the same mutation. The browser never receives this service token and TLS plus the short lifetime
substantially reduce exposure, so this is not equivalent to a reusable user session leak.

Recommended decision before implementation: choose an explicit replay model. A durable one-time
JTI store is strongest but adds a database write to every API call; a bounded in-memory cache is not
safe across multiple instances/restarts; binding signed claims to method/path/body limits cross-route
replay but does not make an identical mutation one-time. Prefer durable one-time enforcement for
mutations and idempotency keys for naturally repeatable operations, then measure latency.

Implemented: mutation JTIs are consumed through the additive `DashboardRequestReplay` table. Only
SHA-256 token/principal fingerprints, operation class, and short expiry metadata are retained.
Reads are not consumed; duplicate mutations fail with a stable `409` before route work.

### F-03 — Medium availability/cost gap: no HTTP principal/route rate-limit gate

The Fastify server has request-body limits, bounded provider work, leases, cooldowns, and queue
deduplication, but no application-level per-principal/per-route rate limiter. A valid dashboard
session or authenticated webhook source can still generate sustained request load; AI, sync, and
search routes have different cost profiles and should not share one coarse threshold.

Recommended remediation: add conservative route-class limits keyed by verified principal (and a
separate webhook policy after secret validation), return `429` with bounded retry guidance, keep
health and OAuth callbacks independently protected, and test proxy/IP trust configuration. Avoid
an unbounded in-memory key map.

Implemented: the additive `SharedRateLimitBucket` table provides atomic shared counters and indexed
expiry. Dashboard cost classes, authenticated Telegram actors, and remaining server route classes
have independent conservative budgets; raw principal identifiers and raw paths are not stored.

## Validation evidence

- Backend focused assurance: **15 files, 136 passed, 2 explicit TODO findings**.
- Backend full suite: **117 files, 886 passed, 6 intentional skips, 2 TODO findings**.
- Dashboard focused assurance: **9 files, 52 passed**.
- Dashboard full suite: **27 files, 118 passed**.
- Dashboard browser: **5 passed, 1 intentional mobile skip**.
- Backend and dashboard tracked-file secret scans passed (**379** and **148** files respectively).
- Backend and dashboard production/full dependency audits: **0 vulnerabilities**.
- Backend TypeScript, build, and Prisma validation passed.
- Dashboard TypeScript, ESLint, and optimized production build passed. A locked generated
  `.next/trace` and Playwright `.last-run.json` marker required deletion and clean regeneration;
  no source or user file was removed.

## What changed in Phase 6 before findings review

- Added explicit backend and dashboard `security:assurance` commands.
- Added backend tracked-file secret scanning and dependency audit commands.
- Hardened backend CI with pinned checkout/setup actions, an ephemeral PostgreSQL service,
  migration application, secret/dependency checks, and the focused assurance matrix.
- Added the dashboard assurance matrix to existing security CI.
- Extracted behavior-preserving dashboard proxy/link security helpers so hostile cases can be
  tested directly; runtime policies are unchanged.
- Added adversarial tests for webhook parsing/size, browser sessions, proxy origin/body/allowlist,
  Markdown protocols, and Mermaid exhaustion/timeouts.
- Recorded F-01 and F-02 as explicit TODO tests rather than silently changing security behavior.

## Exact next safe action

1. Rotate the Canvas access token now that the fixed backend is live; update Render without exposing
   the token, then confirm Canvas sync with the least-privilege replacement.
2. Keep CSP report-only until its separate clean preview evidence window supports enforcement.
3. Do not run destructive privacy backfill or retention until its runbook acknowledgements and
   rollback controls are independently approved.

Recommended model for interpreting and remediating these security boundaries: GPT-5.6 Sol high.
Ultra is not required.
