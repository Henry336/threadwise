# Private Codex Mode: Implementation and Audit Notes

Date audited: 2026-07-29

## 2026-08-04 Remote Operator hardening

- Added `code`, `internet`, `publish`, `deploy`, `browser`, `files`, and `full`
  per-request access profiles. Code remains the default; expansive capabilities
  persist as owner/chat-scoped approvals and cannot be claimed before the exact
  owner taps **Approve once** in the exact private Codex group.
- Added worker-detected permission handoffs. A network, browser, or extra-root
  boundary pauses the durable job, preserves its Codex task id, and resumes only
  after approval instead of failing or silently escalating.
- Added `/codex doctor` with worker heartbeat, persistent desktop Codex state,
  GitHub authentication, browser/network/file/deploy capability, credential
  broker names, and per-project Git readiness. Secret values are never rendered.
- Added disposable `origin/main` worktrees for trusted publish jobs. Existing
  desktop checkout changes are not copied, staged, committed, or overwritten.
- Added up to two local/CI repair passes in the same Codex task and PR. Failed
  GitHub logs are bounded and redacted before being returned to the model;
  repair commits use the same `agent/*` branch without force-push.
- Added explicit Git-connected deployment targets and merged-commit health
  verification, with a separate `DEPLOY` audit event.
- Replaced inherited worker environments with a sanitized Codex/Gemini child
  environment. Worker, Telegram, database, GitHub, Render, and Vercel secrets
  are withheld; Git credential helpers and interactive prompts are disabled.
  Explicit plugin credential variables use Codex shell-environment exclusions.
- Updated Windows startup to import the latest User-scope configuration on every
  launch, require persistent `CODEX_HOME`, and provide a secret-safe local doctor
  script. A reboot is not required after re-running the installer.

## Intended private deployment

- Telegram owner user: deployment-only configuration
- Dedicated Telegram group: deployment-only configuration
- Global bot allowlist: independent of Codex mode; leave unchanged unless all of Threadwise should be owner-only
- Required private-mode values:
  - `CODEX_OWNER_TELEGRAM_ID=<owner user id>`
  - `CODEX_TELEGRAM_CHAT_ID=<dedicated two-member group id>`
  - `CODEX_WORKER_TOKEN=<a unique random value of at least 24 characters>`

The IDs remain deployment configuration rather than source-code constants. The mode is completely disabled unless the owner id, group id, and worker token are all present.

## What was implemented

- A private Telegram Codex mode backed by the official `@openai/codex-sdk`.
- Owner-and-chat scoped project registry, chat state, job queue, task/thread relationships, attachments, and report-message mappings in PostgreSQL.
- Local project discovery from Codex `session_meta` records. It lists unique, existing Git repositories, ignores missing/non-Git folders, and excludes Codex-managed worktrees.
- `/codex projects` provides a paginated, tap-to-select list of aliases and full local paths.
- The worker uses the official local Codex app-server `thread/list` interface to sync desktop task names and ids for every discovered project.
- Tapping a project opens a paginated task picker. `/codex tasks <alias>` opens it directly.
- Tapping a task makes that exact Codex thread active. Plain text resumes the checked task; **New task** clears it.
- `/codex use task "<title>"` selects by title, while `in <alias> task "<title>": <prompt>` directly targets any unique task.
- Plain text uses the selected project/task. `in <project-alias> <prompt>` explicitly targets another project.
- Replying to a completion report resumes that exact Codex thread and project. `continue <task-id> <prompt>` provides the same behavior without locating the report.
- `new <prompt>` deliberately starts a fresh thread.
- Per-task `--model <model-id>` and `--reasoning minimal|low|medium|high|xhigh` controls.
- Owner-only trusted publishing phrases hand the completed sandbox diff to the laptop worker for validation, an `agent/*` commit, PR creation against `main`, GitHub checks, and optional auto-merge.
- Telegram photos and image documents are passed to Codex as native `local_image` inputs.
- Other documents are downloaded into a unique temporary directory, provided as an additional readable directory, named in the prompt, and removed after the turn.
- Every completion/failure report identifies project, Codex task title/id, separate request id, folder, model, reasoning level, and current report page.
- Long reports are kept intact and shown through Previous/Next controls that edit one Telegram message, preserving reply-to-task routing.

## Privacy and authorization safeguards

- Prompt and project controls require both the exact configured Telegram user id and exact configured group id.
- Unauthorized `/codex` attempts are silent, and Codex is absent from general command/help menus.
- Before any private-mode interaction, Threadwise asks Telegram to prove:
  - the exact owner is an active member; and
  - the group member count is exactly two (owner plus bot).
- Restricted owners are accepted only when Telegram explicitly says they are still a member.
- Membership lookup failures fail closed.
- If the group is no longer private, reports are not posted there. Delivery falls back to the owner's private bot chat.
- Report pagination in fallback direct messages is usable only by the owner. Prompting remains restricted to the configured group.
- Job execution endpoints require the shared secret, compare it using a timing-safe equality check, and scope every claim, attachment, heartbeat, completion, and failure operation to the configured owner and group.
- Project/task catalog sync also accepts a dedicated Ed25519 signature from the local metadata sidecar. The signed request binds its method, exact path, worker id, and canonical body and expires after two minutes. This public-key path is accepted only by `POST /codex/worker/sync`; it cannot claim or complete jobs, fetch attachments, or authenticate any other route.
- The signing private key is stored only on the laptop with protected Windows ACLs for the owner, SYSTEM, and administrators. Render contains only the non-secret public key. Its SHA-256 public-key fingerprint is `1a336d43e8866f2d2e967bfe16165a3af7e6f787cc1436e1593de2c71ad65730`.
- The worker never receives the Telegram bot token.
- Sandboxed Codex turns do not receive GitHub credentials and are instructed not to run commit, push, PR, or merge commands. Those operations run afterward in the trusted Windows worker.
- Pre-existing staged changes, overlap with pre-existing dirty files, sensitive paths/content, a moved `main`, failed checks, conflicts, unsupported remotes, and GitHub authentication failures stop publishing without force-pushing or touching `main`.
- Every successful commit, push, PR, check gate, auto-merge request, and merge is recorded in an owner/chat/job-scoped audit table.
- Codex privacy does not depend on the global Threadwise allowlist. The exact owner/chat and two-member-group checks protect Codex mode without hiding ordinary Threadwise features from other users.

## Reliability and correctness fixes from the audit

- Added renewable job leases and worker heartbeats so long Codex turns do not become claimable merely because the initial lease elapsed.
- Separated Codex execution failures from completion-relay failures. A successful Codex result can no longer be mislabeled as failed because of a temporary network or Telegram problem.
- Terminal completion/failure callbacks retry with bounded exponential backoff until accepted by the server.
- Completed-but-undelivered reports are retried independently by the bot service.
- Added delivery deduplication using the persisted report-message mapping.
- Made worker terminal callbacks idempotent when the database already contains a terminal result.
- Prevented an empty or temporarily unreadable discovery pass from erasing the server's known project registry.
- Excluded `.codex/worktrees` regardless of which valid `CODEX_HOME` path spelling produced the session.
- Added immediate 25 MB upload rejection, server-side metadata checks, content-length checks, and streaming byte limits. This avoids buffering an unbounded response before checking its size.
- Added filename sanitization and unique temporary directories to prevent attachment path traversal or collisions.
- Added safe cleanup handling so a temporary-directory cleanup problem does not rewrite a successful task outcome.
- Corrected incomplete `in <project>` and `continue <task-id>` commands so they request a prompt instead of submitting the command text itself.
- Explicit `in <project> ...` targeting now wins over an incidental reply to an older report.
- A continuation without a resumable thread is rejected with actionable guidance instead of silently creating an unrelated thread.
- Report page splitting is Unicode-code-point safe and reassembles to the exact original response.

## Verification performed

This section is the historical verification snapshot for the original private-Codex release, not the current repository-wide baseline. Use the root README for the latest complete gate.

- TypeScript typecheck: passed.
- Production TypeScript build: passed.
- Prisma schema validation: passed.
- Focused Codex tests: 22 passed.
- Ed25519 signing/tamper/freshness tests: 8 passed.
- Entire Threadwise test suite: 64 files and 579 tests passed.
- Real local project-discovery smoke test: 25 usable Git projects found.
- Real Codex app-server task-discovery smoke test: the three Threadwise desktop task titles and ids matched the Codex sidebar.
- Official SDK smoke test with explicit model/reasoning controls: passed and returned a real Codex thread id.
- Production dependency audit:
  - Safe non-breaking updates were applied, including patched `fast-uri` and `find-my-way`.
  - At this release snapshot, nine reported findings remained in the old archive/glob chain transitively required by `exceljs@4.4.0`; the unsafe `npm audit --force` downgrade was not applied.
  - Later compatible dependency overrides and patches cleared the known production advisories. Run `npm audit` again for the current network-backed result rather than treating either historical snapshot as permanent.

## Live operational setup

1. The migration and exact-task-selection service are deployed on Render.
2. The token-authenticated local worker remains responsible for claims, attachments, Codex execution, heartbeats, and terminal reports.
3. The `npm run codex:task-sync` sidecar refreshes only projects and desktop Codex task metadata using its dedicated signing key.
4. Keep both local processes running while remote task execution and newly created desktop-task discovery are expected.
5. In Telegram, run `/codex projects`, tap a project, and choose an existing Codex task or **New task**.
6. Keep the Telegram group at exactly the owner and Threadwise bot. Disable group history for newly added members if old reports must never become visible later.

No default project path needs to be configured. The active project is chosen in Telegram and persisted. The earlier `RemoteCodex` folder is not treated as a Codex project merely because that folder exists; it will appear only after it is an actual Git project represented in local Codex session metadata.

## Residual operational constraints

- The laptop and local worker must be on for Codex to execute a queued task.
- A bot can use the private-message privacy fallback only after Telegram permits that bot to message the owner; opening the bot's direct chat once is recommended.
- Telegram group-history behavior is controlled by Telegram, not Threadwise.
- Delivery is effectively deduplicated once the Telegram message mapping is persisted. As with any external API, a process crash in the tiny interval after Telegram accepts a message but before its message id is committed could produce one duplicate on retry.
- The signed catalog sidecar is deliberately not a replacement for the token-authenticated execution worker.
- Codex CLI 0.145.0 on Windows fails sandbox setup when a whole volume is passed as
  a writable `--add-dir`. Threadwise therefore treats configured volume roots as
  authorization boundaries and derives exact quoted prompt paths for each approved
  turn.
- Windows redirected folders may have different logical and physical paths. Trusted
  publishing canonicalizes both the selected project and Git's reported top level
  before enforcing the repository-root invariant.
