# Telegram Remote Operator

Threadwise's private Codex chat is a controlled remote operator, not a second
unrestricted desktop session.

## Security boundary

- Every command, callback, approval, report, project, and job is scoped to the
  exact configured Telegram owner and the exact two-member Codex group.
- The default task profile is `code`: workspace-write, no outbound network, no
  browser, no additional laptop roots, and no host credentials.
- `internet`, `browser`, `files`, and `deploy` require a durable, one-job
  Telegram approval. Denial cancels the job. A worker-detected capability
  boundary pauses rather than losing the task.
- The Codex subprocess receives a sanitized environment. Threadwise worker
  tokens, Telegram tokens, database URLs, GitHub tokens, Render tokens, and
  Vercel tokens are never forwarded.
- Optional MCP/plugin credentials are explicitly named in
  `CODEX_WORKER_CREDENTIAL_ENV_ALLOWLIST`; the Codex shell environment excludes
  them so the model cannot retrieve them with a command.
- GitHub operations and deployment verification run in the trusted host worker.

## Publishing and repair

Publishing starts in a disposable worktree based on current `origin/main`.
Existing changes in the user's checkout are neither copied nor staged. The host
runs detected locked-package, Prisma, test, typecheck, and build gates; rejects
sensitive files and added secret patterns; commits only to `agent/*`; pushes
without force; creates a PR against `main`; waits for checks; and enables
auto-merge only after passing checks.

A failed local or GitHub check is returned to the same Codex task with bounded
logs. The worker allows at most two automatic repair attempts. Repairs are
committed to the existing PR branch and every commit, push, PR, check, merge,
deployment, and blocker transition is audited.

## Laptop configuration

Persist these Windows User variables, then rerun the startup installer:

```text
THREADWISE_CODEX_URL=https://YOUR-SERVICE.onrender.com
THREADWISE_CODEX_WORKER_TOKEN=existing shared worker secret
CODEX_HOME=D:\CodexData\home
CODEX_WORKER_NETWORK_ACCESS=true
THREADWISE_CODEX_ADDITIONAL_ROOTS=C:\explicit\root;D:\another\explicit\root
CODEX_WORKER_CREDENTIAL_ENV_ALLOWLIST=API_KEY_21ST
THREADWISE_DEPLOY_TARGETS={"threadwise":{"provider":"render","healthUrl":"https://YOUR-SERVICE.onrender.com/health","expectedService":"threadwise"}}
```

`THREADWISE_CODEX_ADDITIONAL_ROOTS` is optional and separate from the `/files`
courier's `THREADWISE_FILE_ROOTS`. Neither setting infers a drive. Full-drive
access must be deliberately entered. On Windows, configured drive roots authorize
paths but are not passed directly to Codex because its workspace sandbox cannot
initialize with a writable volume root. Put the exact absolute path in quotes in
the approved Telegram prompt; Threadwise validates it against the configured roots
and passes only that directory for the turn.

Rapid prompts are serialized by a durable per-task dependency chain. Prompts sent
while a new task is still obtaining its Codex thread ID wait behind that creator,
retain their original project/task selection, and display queue position. If a
creator fails, dependent prompts are blocked with **Retry as new task** and
**Cancel** controls.

Run laptop diagnostics without printing secret values:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\doctor-codex-worker.ps1
```

From Telegram, use `/codex doctor`.
