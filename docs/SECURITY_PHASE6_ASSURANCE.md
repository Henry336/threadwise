# Phase 6 active security assurance

Date: 2026-08-17 SGT  
Status: **findings review — assurance infrastructure and local synthetic checks complete; remediation and hosted staging not started**

This report contains no credentials, private payloads, production records, or provider
responses. Phase 6 used synthetic identities, chats, workspaces, tokens, bodies, provider
responses, and mocked persistence. Production was not probed, mutated, deployed, or used as a
staging substitute.

## Environment and safety boundary

- Backend baseline: Phase 5 commit `a440c0b`, branch `codex/phase6-security-assurance`.
- Dashboard baseline: Phase 5 commit `9d47b57`, branch `codex/phase6-security-assurance`.
- Published assurance commits: backend `be7d2ec`; dashboard `bf9c948`.
- Node/npx are available. Docker, Render CLI, an installed Render connector, and a proven
  dedicated non-production database/credential set are not available on this machine.
- The repository CI now defines an isolated PostgreSQL 17 service with synthetic credentials,
  applies every checked-in migration, and runs the bounded adversarial suite. That workflow must
  pass on GitHub before the branch can satisfy the ephemeral-database gate.
- A network-reachable hosted staging deployment was **not** created. Doing so without a proven
  isolated database and synthetic secrets could accidentally cross the production boundary.
- Both guarded branches are pushed. Manual workflow dispatch is available, but the local `gh`
  session is expired, so the remote ephemeral PostgreSQL job has not been dispatched or claimed
  as passing. No pull request was opened merely to trigger it.
- CSP remains report-only under the separate Phase 5 rollout gate. Phase 3 production activation
  remains blocked at Gate 3A.

## Assurance matrix

| Boundary | Result | Evidence |
| --- | --- | --- |
| Telegram webhook spoofing, missing/wrong secret, retired route | Pass | Fastify injection rejects before the handler with opaque 404 responses. |
| Malformed and oversized Telegram webhook bodies | Pass | JSON parse failure and Fastify's body limit reject before the bot handler. |
| Telegram duplicate delivery/replay | Pass at update layer | `ProcessedTelegramUpdate` claims use a unique update id and `skipDuplicates`; duplicate work does not proceed. |
| Dashboard JWT issuer, audience, expiry, subject, lifetime, signature | Pass | Synthetic Ed25519 tokens fail closed on every tested invalid claim. |
| Dashboard JWT JTI replay | **Finding F-02** | JTI shape is checked, but successful JTIs are not consumed. |
| Personal/group/Study/Beacon authorization and membership changes | Pass for covered boundaries | Signed identity is server-derived; personal records are owner-scoped; Telegram group authority is freshly checked before privileged mutations; Study/Beacon checks fail closed. |
| BFF workspace, route/method allowlist, origin/CSRF, JSON/body/response bounds | Pass | Extracted pure security helpers and adversarial allowlist tests cover wrong/missing origins, traversal/unsupported paths, malformed JSON, and size boundaries. |
| Markdown links/images and raw HTML | Pass | Raw HTML is skipped; executable/embedded link schemes are rejected; remote images require explicit consent; embedded/insecure images are blocked. |
| Mermaid XSS/resource exhaustion | Pass for local bounded renderer | Configuration directives and character/line/statement exhaustion are rejected; render work is serialized, timed out, strict-security rendered, and SVG-sanitized. |
| Canvas/NUSMods/transit/OAuth/media SSRF review | **Finding F-01** | Fixed-provider surfaces are constrained, but Canvas pagination accepts a cross-origin next link while retaining the bearer token. |
| Queue leases, duplicate delivery, concurrency, interrupted recovery | Pass for covered synthetic cases | File courier, voice transcription, task imports, Study analysis, Canvas sync recovery, and note/capture exact-once tests pass. |
| Application-level rate limiting/resource abuse | **Gap F-03** | Body, queue, timeout, and provider cooldown bounds exist, but the HTTP server has no principal/route rate-limit gate. |
| Secret scan, dependency audit, type/static/build checks | Pass locally | Both tracked-file scans pass; complete and production npm audits report zero vulnerabilities; TypeScript, lint where configured, builds, and full tests pass. |
| Browser security/responsive smoke | Pass | Five Chromium desktop/mobile tests pass; one desktop-only palette check is intentionally skipped on mobile. |
| Hosted synthetic staging and safe production headers | Blocked/not run | No isolated hosted database/secret set or deployment connector is available; production verification requires separate approval. |

## Findings — review before remediation

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

### F-03 — Medium availability/cost gap: no HTTP principal/route rate-limit gate

The Fastify server has request-body limits, bounded provider work, leases, cooldowns, and queue
deduplication, but no application-level per-principal/per-route rate limiter. A valid dashboard
session or authenticated webhook source can still generate sustained request load; AI, sync, and
search routes have different cost profiles and should not share one coarse threshold.

Recommended remediation: add conservative route-class limits keyed by verified principal (and a
separate webhook policy after secret validation), return `429` with bounded retry guidance, keep
health and OAuth callbacks independently protected, and test proxy/IP trust configuration. Avoid
an unbounded in-memory key map.

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

1. Review F-01 through F-03 and authorize a bounded Phase 6 remediation subphase if accepted.
2. Fix F-01 first and rotate the Canvas token after deployment because token confidentiality cannot
   be proven historically from code inspection alone.
3. Decide the JTI replay and rate-limit storage/latency architecture before implementing F-02/F-03.
4. Re-authenticate GitHub CLI or open a reviewed pull request, then run the pushed ephemeral
   PostgreSQL/migration CI gate.
5. Provision a dedicated hosted staging database and synthetic secret set; never clone production
   credentials or private data into it.
6. Only after hosted staging passes, request separate approval for safe production header/config
   verification with dedicated test identities.

Recommended model for interpreting and remediating these security boundaries: GPT-5.6 Sol high.
Ultra is not required.
