# Private Codex Mode

Telegram Codex mode is a side project for the owner. It is not part of the Threadwise product. It
reuses the bot and the Render process. This guide was moved out of the README on 2026-11-09.

Related documents:

- [PRIVATE_CODEX_IMPLEMENTATION_NOTES.md](PRIVATE_CODEX_IMPLEMENTATION_NOTES.md): what was built and audited.
- [TELEGRAM_REMOTE_OPERATOR.md](TELEGRAM_REMOTE_OPERATOR.md): access profiles, publishing and repair.
- [OWNER_FILE_COURIER.md](OWNER_FILE_COURIER.md): the separate `/files` surface that shares the worker.

## Ideas Intelligence (Gemini)

- Develops an individual idea through the official local Gemini CLI with owner-only Telegram buttons for Develop, Challenge, Next steps, and Task plan. Gemini runs read-only on the laptop worker; suggested tasks are not saved automatically.

## Setup and use

Private Codex mode is a two-part integration:

1. The Render service receives the owner's Telegram prompts, persists jobs, and delivers final reports.
2. A local Windows worker uses the official `@openai/codex-sdk` package and the laptop's existing Codex authentication. Render never receives Codex credentials and never needs direct access to local project folders.

The mode is disabled unless all of these Render values are configured:

```text
CODEX_OWNER_TELEGRAM_ID=YOUR_TELEGRAM_USER_ID
CODEX_TELEGRAM_CHAT_ID=YOUR_TWO_MEMBER_GROUP_ID
CODEX_WORKER_TOKEN=A_LONG_RANDOM_SHARED_SECRET
CODEX_JOB_LEASE_SECONDS=3600
```

Private Codex mode does not require `BOT_ALLOWED_TELEGRAM_IDS`. Leave that global setting unchanged unless the entire Threadwise bot—not merely Codex mode—should be restricted. Codex has its own exact owner-and-chat gate.

The handler checks both the exact user id and exact chat id on every prompt and callback. Unauthorized `/codex` attempts are ignored without a response. The command is intentionally absent from the public command/help menus. Before showing any Codex UI or report, Threadwise verifies that the configured owner is still an active member and that the group contains only that owner and the bot. If either check fails, group delivery fails closed and a completed report is sent to the owner's private bot chat instead. Telegram may expose older group history to someone added later, depending on the group's history setting, so keep the group private and hide history from new members if the reports must remain owner-only.

After deploying the migration and Render configuration, create an ignored `.env.codex-worker` file on the Windows computer:

```text
THREADWISE_CODEX_URL=https://threadwise-90du.onrender.com
THREADWISE_CODEX_WORKER_TOKEN=THE_SAME_LONG_RANDOM_SHARED_SECRET
CODEX_WORKER_ID=my-laptop
CODEX_WORKER_POLL_MS=3000
CODEX_WORKER_SYNC_MS=300000
CODEX_WORKER_HEARTBEAT_MS=30000
CODEX_WORKER_NETWORK_ACCESS=false
CODEX_WORKER_MAX_ATTACHMENT_BYTES=26214400
THREADWISE_CODEX_ADDITIONAL_ROOTS=
CODEX_WORKER_CREDENTIAL_ENV_ALLOWLIST=
THREADWISE_DEPLOY_TARGETS=
GEMINI_WORKER_MODEL=auto
```

If the worker is not inheriting the same Codex home as the desktop app, also set:

```text
CODEX_HOME=D:\CodexData\home
```

Start the worker from this repository:

```powershell
npm install
npm run codex:worker
```

The same local process can handle the legacy owner-only Ideas Intelligence actions.
For that optional feature, install the official Gemini CLI on the laptop:

```powershell
npm install -g @google/gemini-cli@latest
```

This CLI path is separate from Study module analysis. Study analysis runs on the
deployed backend with the existing `OPENAI_API_KEY`, `OPENAI_MODEL`, and bounded
OpenAI fallback chain; the secret never reaches Telegram or the dashboard browser.
`STUDY_ANALYSIS_*` timeout, lease, poll, and output-token bounds are documented in
`.env.example`. No laptop process or Gemini API key is required for Study analysis.

Verify the local headless path before starting Threadwise:

```powershell
gemini --version
gemini --model auto --approval-mode plan -e none --output-format json -p "Reply with READY only."
```

For Ideas Intelligence only, Threadwise invokes the official CLI in read-only plan
mode and does not copy or upload its local credentials. After local authentication succeeds, the owner can
open any saved idea in Telegram and tap
**Develop**, **Challenge**, **Next steps**, or **Task plan** from the phone.
There is intentionally no general `/gemini` command, and `/codex` remains exclusively
for Codex projects, tasks, threads, prompts, and status. Sharing one local background
process is an implementation detail and does not combine their Telegram interfaces.

To keep the worker active whenever the laptop owner is signed in, persist
`THREADWISE_CODEX_URL`, `THREADWISE_CODEX_WORKER_TOKEN`, and (when used)
`CODEX_HOME` as Windows user environment variables, then run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-codex-worker-startup.ps1 -StartNow
```

The installer prefers a Scheduled Task that restarts the worker after failures
and runs on battery power. If Windows does not permit Scheduled Task
registration, it falls back to the current user's `Run` registry key. Both
methods write the local worker log to `.local/logs/codex-worker.log` in the
project folder and start at user sign-in rather than before sign-in, so the
worker can access the owner's Codex and Gemini session stores. The runner also
restarts a failed worker after 15 seconds, including when the Run-key fallback is used.

After a worker release is merged, update the dedicated laptop checkout without
resetting or discarding local files:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\update-codex-worker.ps1
```

The updater requires a clean dedicated checkout on `main`, fetches and
fast-forwards only, runs `npm ci`, and restarts the startup task. The runner
publishes a local PID file so updates stop its complete PowerShell/Node process
tree before replacing dependencies; this prevents orphaned `tsx` or esbuild
processes from locking `node_modules`. It stops on a dirty checkout, non-GitHub
origin, divergent branch, dependency failure, or non-fast-forward update.

For installations where the running worker token is intentionally unavailable to
the startup environment, `npm run codex:task-sync` starts a separate,
least-privilege catalog sidecar. Set `THREADWISE_CODEX_URL`,
`CODEX_TASK_SYNC_PRIVATE_KEY_PATH`, `CODEX_WORKER_ID`, and optionally
`CODEX_WORKER_SYNC_MS`. Its pinned Ed25519 key is accepted only by
`POST /codex/worker/sync`; it cannot claim or complete jobs, download Telegram
attachments, or access any other worker endpoint. Requests bind the method,
path, worker id, and canonical body and expire after two minutes.

On startup and every five minutes, the worker discovers project folders from Codex `session_meta` records and asks the local Codex app-server for the task names, ids, sources, and timestamps shown by Codex clients. It registers unique, existing Git repositories; excludes Codex-managed worktrees, missing folders, and non-Git directories; and syncs only the task metadata needed for Telegram selection. Codex credentials and session contents are never uploaded.

Inside the configured Telegram group:

```text
/codex projects
/codex tasks threadwise
/codex use threadwise
/codex use task "Add Telegram Codex mode"
Fix the reminder bug
in subscription-radar Review the renewal calculation
in threadwise task "Add Telegram Codex mode": Continue the implementation
new Start a separate Codex task
continue a1b2c3d4 Add regression tests
in threadwise --model gpt-5.6-sol --reasoning high -- Fix CI
/codex status
/codex doctor
in threadwise --access internet -- verify the current API documentation
in threadwise --access browser -- check the deployed UI
in threadwise --access deploy -- implement, publish, merge, and verify the deployment
```

`/codex projects` shows the current laptop project aliases and paths in paginated cards. Tapping a project opens `/codex tasks <alias>`, which lists the same named Codex tasks stored for that folder. Tap a task to make that exact thread active; plain messages resume it. Tap **New task** to clear the selection and make the next prompt start separately. You can also target a task directly with `in <alias> task "<title>": <prompt>` or `/codex use task "<title>"`. Every queue acknowledgement and report identifies the project, Codex task title/id, and separate Threadwise request id. Replying to a report resumes that exact task even after changing report pages; `continue <request-id> <prompt>` resumes it without locating the report.

Use `--model <model-id>` and `--reasoning minimal|low|medium|high|xhigh` anywhere before the prompt to override one task. Omitted controls inherit the resumed thread or local Codex defaults.

Use `--access code|internet|publish|deploy|browser|files|full` for a single
request. Code-only remains the default. Internet, browser, deploy, and extra-file
access create a durable approval card in the exact owner-only Telegram group;
the worker cannot claim the job until **Approve once** is tapped. If a code-only
turn encounters a capability boundary, the job is paused with the same approval
card and resumes from its saved Codex task after approval. `/codex doctor`
reports the persistent Codex home, GitHub authentication, capability switches,
credential broker names, deployment targets, and Git readiness for the selected
project without printing secret values.

On Windows, configured full-drive Codex roots authorize exact paths but are not
passed directly as sandbox directories. Quote the absolute file or folder path in
the approved prompt; Threadwise grants that path for the turn. Rapid prompts use a
durable per-task dependency chain, so prompts sent before a new task has a thread
ID stay queued in order and show their queue position.

Long final responses are stored intact and shown as one Telegram report card with project, folder, Codex task title/id, request id, model, reasoning, and page indicators. Previous/Next buttons edit the same message, so replying from any displayed page still maps to the same Codex thread.

Owner-only trusted publishing is requested naturally from the private Codex group:

```text
Implement this, verify it, publish it, and auto-merge when CI passes.
```

The sandboxed Codex turn edits a disposable Git worktree created from current
`origin/main`; it never works in the owner's possibly dirty desktop checkout.
The trusted laptop worker prepares locked dependencies, snapshots and reviews
the task's new diff, runs the
repository's detected npm/Prisma checks, rejects sensitive files or overlap with
pre-existing changes, creates a new `agent/*` branch, commits only the task
files, pushes without force, and opens a PR against `main`. Auto-merge is
requested only after the local gate and GitHub PR checks pass. A changed
`main`, failed check, conflict, unauthenticated `gh`, unsupported remote,
sensitive diff, or mixed pre-existing file stops publishing and is reported in
Telegram. The worker never pushes directly to `main`.

Commit, push, PR, check, auto-merge, merge, and blocker events are written to
the owner/chat-scoped `CodexPublishAudit` table as they occur. Completion
reports include the branch, commit, PR URL, check outcome, merge commit, or
exact blocker. GitHub CLI must be authenticated for the Windows user running
the worker (`gh auth login`), and the repository must have a PR check; this
repository supplies `.github/workflows/ci.yml`.

Local validation and failing GitHub checks can be returned to the same Codex
task for up to two bounded repair attempts. Each retry is revalidated, committed
to the same `agent/*` PR branch without force-push, and separately audited. A
sensitive repair diff, changed PR head, conflict, exhausted repair limit, or
failing check remains blocked for manual review.

Git-connected deployments use `THREADWISE_DEPLOY_TARGETS`. After an auto-merged
PR, the trusted worker polls the configured HTTPS health endpoint until it
reports the merged commit. Provider credentials are not given to the Codex
subprocess. Commit, push, PR, checks, merge, deployment, and blocker events all
use the host-side audit path.

Photos and image documents are downloaded by the authenticated worker and passed to the SDK as native `local_image` inputs. Other Telegram documents are downloaded to a unique temporary directory, exposed to that Codex turn as an additional readable directory, and named explicitly in the prompt. Telegram media albums are collected into one Codex job in message order: the album caption becomes the prompt and all items are sent to the same turn. Albums support up to 10 items, with the existing 25 MB per-file limit and a 100 MB combined limit. The temporary files are deleted when the turn finishes. The laptop never receives the Telegram bot token; it downloads each attachment through a worker-authenticated Threadwise endpoint that only serves files belonging to its currently claimed job.

The worker runs Codex with a workspace-write sandbox and no interactive desktop
approval UI. `CODEX_WORKER_NETWORK_ACCESS=true` makes network access available,
but a task still receives it only after its one-task Telegram approval. The SDK
subprocess receives a sanitized environment: worker/database/Telegram/provider
secrets are removed, Git credential helpers are disabled, and GitHub publishing
remains in the host broker. Optional MCP/plugin credential variable names may be
listed in `CODEX_WORKER_CREDENTIAL_ENV_ALLOWLIST`; Codex receives only those
selected values and its shell environment policy excludes their names from
model-run commands. Prompts and final reports are stored in PostgreSQL as part
of the durable job queue. While Codex is running, lease heartbeats prevent a
long task from being claimed twice. Terminal results retry with bounded
exponential backoff until the server accepts them, and the server independently
retries completed-but-undelivered Telegram reports. A completely empty
project-discovery pass preserves the previous registry instead of erasing it.
