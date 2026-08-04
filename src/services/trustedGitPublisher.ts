import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { spawn } from "node:child_process";

export type TrustedPublishStatus =
  | "BLOCKED"
  | "PR_OPEN"
  | "AUTO_MERGE_ENABLED"
  | "MERGED";

export type TrustedPublishResult = {
  status: TrustedPublishStatus;
  branch?: string;
  commitSha?: string;
  prNumber?: number;
  prUrl?: string;
  checks?: string;
  mergeCommitSha?: string;
  blocker?: string;
  repairStage?: "LOCAL_CHECKS" | "CI";
  repairPrompt?: string;
};

export type TrustedPublishEvent = {
  eventKey: string;
  action: "COMMIT" | "PUSH" | "PR" | "CHECKS" | "AUTO_MERGE" | "MERGE" | "DEPLOY" | "BLOCKED";
  status: string;
  branch?: string;
  commitSha?: string;
  prNumber?: number;
  prUrl?: string;
  details?: Record<string, unknown>;
};

type FileState = { fingerprint: string };

export type TrustedGitSnapshot = {
  root: string;
  headSha: string;
  branch: string;
  originMainSha?: string;
  changed: Map<string, FileState>;
  staged: string[];
};

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CommandRunner = (
  executable: string,
  args: string[],
  options: { cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv }
) => Promise<CommandResult>;

type PublishInput = {
  cwd: string;
  jobId: string;
  title: string;
  autoMerge: boolean;
  snapshot: TrustedGitSnapshot;
  report: (event: TrustedPublishEvent) => Promise<void>;
  checkTimeoutMs?: number;
  githubTimeoutMs?: number;
  runner?: CommandRunner;
  eventPrefix?: string;
};

type RepairPublishInput = {
  cwd: string;
  jobId: string;
  title: string;
  autoMerge: boolean;
  branch: string;
  commitSha: string;
  prUrl: string;
  report: (event: TrustedPublishEvent) => Promise<void>;
  checkTimeoutMs?: number;
  githubTimeoutMs?: number;
  runner?: CommandRunner;
  eventPrefix?: string;
};

const DEFAULT_CHECK_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_GITHUB_TIMEOUT_MS = 30 * 60_000;
const MAX_COMMAND_OUTPUT = 200_000;

export function detectTrustedPublishIntent(prompt: string): {
  requested: boolean;
  autoMerge: boolean;
} {
  const normalized = prompt.toLowerCase().replace(/\s+/g, " ");
  const publish = /\b(?:publish|push)\b/.test(normalized)
    && /\b(?:pr|pull request|github|merge|publish|push)\b/.test(normalized);
  const autoMerge = publish && (
    /\bauto[\s-]?merge\b/.test(normalized)
    || /\bmerge (?:it |this )?(?:when|after|once)\b/.test(normalized)
    || /\band merge\b/.test(normalized)
  );
  return { requested: publish, autoMerge };
}

export function isAllowedPublishBranch(branch: string): boolean {
  return /^agent\/[A-Za-z0-9][A-Za-z0-9._/-]{0,150}$/.test(branch)
    && !branch.includes("..")
    && !branch.endsWith("/")
    && !branch.includes("//");
}

export function parseGithubRemote(remote: string): string | undefined {
  const value = remote.trim().replace(/\.git$/i, "");
  const https = value.match(/^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)$/i);
  if (https) return `${https[1]}/${https[2]}`;
  const ssh = value.match(/^git@github\.com:([^/\s]+)\/([^/\s]+)$/i);
  return ssh ? `${ssh[1]}/${ssh[2]}` : undefined;
}

export function sensitivePublishPaths(paths: string[]): string[] {
  return paths.filter((path) => {
    const normalized = path.replace(/\\/g, "/").toLowerCase();
    const name = normalized.split("/").pop() ?? normalized;
    return normalized === ".env"
      || (normalized.startsWith(".env.") && !normalized.endsWith(".example"))
      || normalized.startsWith(".git/")
      || normalized.startsWith(".codex/")
      || normalized.startsWith(".threadwise/")
      || normalized.includes("/.ssh/")
      || /(?:^|\/)(?:credentials?|secrets?)(?:\.|\/|$)/.test(normalized)
      || /\.(?:pem|key|p12|pfx|jks|keystore|sqlite|sqlite3|db)$/i.test(name)
      || /^(?:id_rsa|id_ed25519|known_hosts)$/i.test(name);
  });
}

export function addedDiffContainsSensitiveValue(diff: string): boolean {
  const additions = diff
    .split(/\r?\n/)
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1));
  const joined = additions.join("\n");
  const privateKeyMarker = ["BEGIN", "PRIVATE", "KEY"].join(" ");
  const githubClassic = ["gh", "p_", ""].join("");
  const githubOauth = ["gh", "o_", ""].join("");
  const openAiPrefix = ["s", "k-", ""].join("");
  return joined.includes(privateKeyMarker)
    || new RegExp(`${githubClassic}[A-Za-z0-9_]{20,}`).test(joined)
    || new RegExp(`${githubOauth}[A-Za-z0-9_]{20,}`).test(joined)
    || new RegExp(`${openAiPrefix}[A-Za-z0-9_-]{20,}`).test(joined)
    || /(?:TELEGRAM_BOT_TOKEN|CODEX_WORKER_TOKEN|THREADWISE_CODEX_WORKER_TOKEN)\s*=\s*[^\s#]{12,}/i.test(joined)
    || /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]{8,}@/i.test(joined);
}

export async function captureTrustedGitSnapshot(
  cwd: string,
  runner: CommandRunner = runCommand
): Promise<TrustedGitSnapshot> {
  const rootResult = await checked(runner, "git", ["rev-parse", "--show-toplevel"], cwd, 30_000);
  const root = resolve(rootResult.stdout.trim());
  if (normalizePath(root) !== normalizePath(resolve(cwd))) {
    throw new Error("Publishing requires the selected project folder to be the Git repository root.");
  }
  const [head, branch, originMain, changed, staged] = await Promise.all([
    checked(runner, "git", ["rev-parse", "HEAD"], root, 30_000),
    checked(runner, "git", ["branch", "--show-current"], root, 30_000),
    runner("git", ["rev-parse", "--verify", "origin/main"], { cwd: root, timeoutMs: 30_000 }),
    changedFiles(root, runner),
    nulPaths(runner, ["diff", "--cached", "--name-only", "-z"], root)
  ]);
  return {
    root,
    headSha: head.stdout.trim(),
    branch: branch.stdout.trim(),
    originMainSha: originMain.exitCode === 0 ? originMain.stdout.trim() : undefined,
    changed,
    staged
  };
}

export async function publishTrustedCodexChanges(input: PublishInput): Promise<TrustedPublishResult> {
  const runner = input.runner ?? runCommand;
  const cwd = resolve(input.cwd);
  const checkTimeoutMs = input.checkTimeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;
  const githubTimeoutMs = input.githubTimeoutMs ?? DEFAULT_GITHUB_TIMEOUT_MS;
  let eventSequence = 0;
  let result: TrustedPublishResult = { status: "BLOCKED" };

  const report = async (
    action: TrustedPublishEvent["action"],
    status: string,
    details?: Record<string, unknown>
  ) => {
    eventSequence += 1;
    await input.report({
      eventKey: `${input.eventPrefix ?? ""}${String(eventSequence).padStart(2, "0")}-${action.toLowerCase()}`,
      action,
      status,
      branch: result.branch,
      commitSha: result.commitSha,
      prNumber: result.prNumber,
      prUrl: result.prUrl,
      details
    });
  };

  const block = async (message: string, details?: Record<string, unknown>): Promise<TrustedPublishResult> => {
    result = { ...result, status: "BLOCKED", blocker: message };
    await report("BLOCKED", "BLOCKED", { message, ...details });
    return result;
  };

  try {
    if (normalizePath(input.snapshot.root) !== normalizePath(cwd)) {
      return await block("The selected project path changed before publishing.");
    }
    if (input.snapshot.staged.length > 0) {
      return await block(
        `Publishing stopped because staged changes already existed: ${input.snapshot.staged.join(", ")}.`
      );
    }

    const currentHead = (await checked(runner, "git", ["rev-parse", "HEAD"], cwd, 30_000)).stdout.trim();
    if (currentHead !== input.snapshot.headSha) {
      return await block("Publishing stopped because the Git HEAD changed during the Codex turn.");
    }

    const changed = await changedFiles(cwd, runner);
    const overlap = [...input.snapshot.changed.entries()]
      .filter(([path, state]) => changed.get(path)?.fingerprint !== state.fingerprint)
      .map(([path]) => path);
    if (overlap.length > 0) {
      return await block(
        `Codex overlapped changes that were already present before the task: ${overlap.join(", ")}.`
      );
    }
    const taskPaths = [...changed.keys()].filter((path) => !input.snapshot.changed.has(path)).sort();
    if (taskPaths.length === 0) {
      return await block("Codex completed without producing a publishable working-tree diff.");
    }
    const sensitivePaths = sensitivePublishPaths(taskPaths);
    if (sensitivePaths.length > 0) {
      return await block(`Sensitive files require manual review: ${sensitivePaths.join(", ")}.`);
    }

    await checked(runner, "git", ["fetch", "--no-tags", "origin", "main"], cwd, githubTimeoutMs);
    const originMain = (await checked(runner, "git", ["rev-parse", "origin/main"], cwd, 30_000)).stdout.trim();
    if (originMain !== input.snapshot.headSha) {
      return await block("Remote main changed during the Codex task. Re-run the task on current main.");
    }

    const checks = await detectedLocalChecks(cwd);
    if (checks.length === 0) {
      return await block("No trusted local validation commands were detected for this project.");
    }
    for (const check of checks) {
      const checkResult = await runner(check.executable, check.args, {
        cwd,
        timeoutMs: checkTimeoutMs,
        env: check.env
      });
      if (checkResult.exitCode !== 0) {
        const blocked = await block(`Local check failed: ${check.label}.`, {
          check: check.label,
          output: commandSummary(checkResult)
        });
        return {
          ...blocked,
          repairStage: "LOCAL_CHECKS",
          repairPrompt: repairPromptForCheck("local", check.label, checkResult)
        };
      }
    }
    result.checks = `Local: ${checks.map((check) => check.label).join(", ")}`;

    const afterChecks = await changedFiles(cwd, runner);
    const extraCheckChanges = [...afterChecks.keys()]
      .filter((path) => !changed.has(path) && !input.snapshot.changed.has(path));
    if (extraCheckChanges.length > 0) {
      return await block(`Validation modified tracked files: ${extraCheckChanges.join(", ")}.`);
    }

    const branch = trustedPublishBranch(input.title, input.jobId);
    if (!isAllowedPublishBranch(branch)) {
      return await block("The generated publish branch did not satisfy the agent/* policy.");
    }
    const branchExists = await runner("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
      cwd,
      timeoutMs: 30_000
    });
    if (branchExists.exitCode === 0) {
      return await block(`The safe publish branch already exists: ${branch}.`);
    }
    await checked(runner, "git", ["switch", "-c", branch], cwd, 30_000);
    result.branch = branch;

    await checked(runner, "git", ["add", "--all", "--", ...taskPaths], cwd, 60_000);
    const staged = (await nulPaths(runner, ["diff", "--cached", "--name-only", "-z"], cwd)).sort();
    if (!samePaths(staged, taskPaths)) {
      await runner("git", ["restore", "--staged", "--", ...taskPaths], { cwd, timeoutMs: 30_000 });
      return await block("The staged diff did not exactly match the files produced by this Codex task.");
    }
    const stagedDiff = await checked(
      runner,
      "git",
      ["diff", "--cached", "--no-ext-diff", "--unified=0", "--", ...taskPaths],
      cwd,
      60_000
    );
    if (addedDiffContainsSensitiveValue(stagedDiff.stdout)) {
      await runner("git", ["restore", "--staged", "--", ...taskPaths], { cwd, timeoutMs: 30_000 });
      return await block("The diff appears to contain credentials or private key material.");
    }

    const commitTitle = trustedCommitTitle(input.title);
    await checked(
      runner,
      "git",
      ["-c", "commit.gpgsign=false", "commit", "-m", commitTitle],
      cwd,
      120_000
    );
    result.commitSha = (await checked(runner, "git", ["rev-parse", "HEAD"], cwd, 30_000)).stdout.trim();
    await report("COMMIT", "SUCCEEDED", { files: taskPaths, title: commitTitle });

    if (!result.branch || !isAllowedPublishBranch(result.branch) || result.branch === "main") {
      return await block("Push policy rejected the current branch.");
    }
    await checked(
      runner,
      "git",
      ["push", "--set-upstream", "origin", result.branch],
      cwd,
      githubTimeoutMs
    );
    await report("PUSH", "SUCCEEDED");

    const remote = (await checked(runner, "git", ["remote", "get-url", "origin"], cwd, 30_000)).stdout.trim();
    const repository = parseGithubRemote(remote);
    if (!repository) {
      return await block("The origin remote is not a supported GitHub repository.");
    }
    const auth = await runner("gh", ["auth", "status", "--hostname", "github.com"], {
      cwd,
      timeoutMs: 30_000
    });
    if (auth.exitCode !== 0) {
      return await block("GitHub CLI is not authenticated on the trusted laptop worker.");
    }

    const prBody = [
      "Created by Threadwise trusted publishing.",
      "",
      `Codex request: ${input.jobId}`,
      `Local checks: ${checks.map((check) => check.label).join(", ")}`,
      "",
      "Git operations were performed by the trusted laptop worker after the sandboxed Codex turn."
    ].join("\n");
    const pr = await checked(runner, "gh", [
      "pr", "create",
      "--repo", repository,
      "--base", "main",
      "--head", result.branch,
      "--title", commitTitle,
      "--body", prBody
    ], cwd, githubTimeoutMs);
    result.prUrl = lastUrl(pr.stdout);
    result.prNumber = result.prUrl ? prNumberFromUrl(result.prUrl) : undefined;
    if (!result.prUrl || !result.prNumber) {
      return await block("GitHub created a PR but did not return a usable PR URL.");
    }
    await report("PR", "CREATED");

    if (!input.autoMerge) {
      return { ...result, status: "PR_OPEN" };
    }

    const githubChecks = await runner("gh", [
      "pr", "checks", result.prUrl,
      "--watch",
      "--fail-fast",
      "--interval", "10"
    ], { cwd, timeoutMs: githubTimeoutMs });
    if (githubChecks.exitCode !== 0) {
      const repairDetails = await githubFailedCheckDetails(runner, cwd, result.prUrl, githubTimeoutMs, githubChecks);
      const blocked = await block("GitHub checks failed, timed out, or no checks were configured.", {
        output: commandSummary(repairDetails)
      });
      return {
        ...blocked,
        repairStage: "CI",
        repairPrompt: repairPromptForCheck("GitHub CI", "pull-request checks", repairDetails)
      };
    }
    result.checks = `${result.checks}; GitHub: passed`;
    await report("CHECKS", "PASSED");

    const merge = await runner("gh", [
      "pr", "merge", result.prUrl,
      "--auto",
      "--merge",
      "--match-head-commit", result.commitSha
    ], { cwd, timeoutMs: githubTimeoutMs });
    if (merge.exitCode !== 0) {
      return await block("GitHub could not enable auto-merge.", { output: commandSummary(merge) });
    }
    await report("AUTO_MERGE", "ENABLED");

    const view = await checked(runner, "gh", [
      "pr", "view", result.prUrl,
      "--json", "state,mergeCommit,statusCheckRollup"
    ], cwd, githubTimeoutMs);
    const state = parsePrState(view.stdout);
    if (state.state === "MERGED") {
      result.mergeCommitSha = state.mergeCommitSha;
      result.status = "MERGED";
      await report("MERGE", "SUCCEEDED");
      return result;
    }
    return { ...result, status: "AUTO_MERGE_ENABLED" };
  } catch (error) {
    return await block(errorMessage(error));
  }
}

export async function repairTrustedPublishedChanges(input: RepairPublishInput): Promise<TrustedPublishResult> {
  const runner = input.runner ?? runCommand;
  const cwd = resolve(input.cwd);
  const checkTimeoutMs = input.checkTimeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;
  const githubTimeoutMs = input.githubTimeoutMs ?? DEFAULT_GITHUB_TIMEOUT_MS;
  let result: TrustedPublishResult = {
    status: "BLOCKED",
    branch: input.branch,
    commitSha: input.commitSha,
    prUrl: input.prUrl,
    prNumber: prNumberFromUrl(input.prUrl)
  };
  let eventSequence = 0;
  const report = async (
    action: TrustedPublishEvent["action"],
    status: string,
    details?: Record<string, unknown>
  ) => {
    eventSequence += 1;
    await input.report({
      eventKey: `${input.eventPrefix ?? "repair-"}${String(eventSequence).padStart(2, "0")}-${action.toLowerCase()}`,
      action,
      status,
      branch: result.branch,
      commitSha: result.commitSha,
      prNumber: result.prNumber,
      prUrl: result.prUrl,
      details
    });
  };
  const block = async (message: string, details?: Record<string, unknown>) => {
    result = { ...result, status: "BLOCKED", blocker: message };
    await report("BLOCKED", "BLOCKED", { message, ...details });
    return result;
  };

  try {
    if (!isAllowedPublishBranch(input.branch) || input.branch === "main") {
      return await block("Repair push policy rejected the branch.");
    }
    const currentBranch = (await checked(runner, "git", ["branch", "--show-current"], cwd, 30_000)).stdout.trim();
    if (currentBranch !== input.branch) return await block("The repair worktree is no longer on the PR branch.");
    const currentHead = (await checked(runner, "git", ["rev-parse", "HEAD"], cwd, 30_000)).stdout.trim();
    if (currentHead !== input.commitSha) return await block("The PR branch changed outside this repair loop.");

    const taskPaths = [...(await changedFiles(cwd, runner)).keys()].sort();
    if (taskPaths.length === 0) return await block("Codex did not produce a repair diff.");
    const sensitivePaths = sensitivePublishPaths(taskPaths);
    if (sensitivePaths.length) return await block(`Sensitive repair files require manual review: ${sensitivePaths.join(", ")}.`);

    const checks = await detectedLocalChecks(cwd);
    for (const check of checks) {
      const checkResult = await runner(check.executable, check.args, { cwd, timeoutMs: checkTimeoutMs, env: check.env });
      if (checkResult.exitCode !== 0) {
        const blocked = await block(`Local repair check failed: ${check.label}.`, { output: commandSummary(checkResult) });
        return {
          ...blocked,
          repairStage: "LOCAL_CHECKS",
          repairPrompt: repairPromptForCheck("local", check.label, checkResult)
        };
      }
    }

    await checked(runner, "git", ["add", "--all", "--", ...taskPaths], cwd, 60_000);
    const stagedDiff = await checked(runner, "git", ["diff", "--cached", "--no-ext-diff", "--unified=0", "--", ...taskPaths], cwd, 60_000);
    if (addedDiffContainsSensitiveValue(stagedDiff.stdout)) {
      await runner("git", ["restore", "--staged", "--", ...taskPaths], { cwd, timeoutMs: 30_000 });
      return await block("The repair diff appears to contain credentials or private key material.");
    }
    await checked(runner, "git", ["-c", "commit.gpgsign=false", "commit", "-m", `Fix checks for ${trustedCommitTitle(input.title)}`], cwd, 120_000);
    result.commitSha = (await checked(runner, "git", ["rev-parse", "HEAD"], cwd, 30_000)).stdout.trim();
    await report("COMMIT", "REPAIR_SUCCEEDED", { files: taskPaths });
    await checked(runner, "git", ["push", "origin", input.branch], cwd, githubTimeoutMs);
    await report("PUSH", "REPAIR_SUCCEEDED");

    const githubChecks = await runner("gh", ["pr", "checks", input.prUrl, "--watch", "--fail-fast", "--interval", "10"], {
      cwd,
      timeoutMs: githubTimeoutMs
    });
    if (githubChecks.exitCode !== 0) {
      const repairDetails = await githubFailedCheckDetails(runner, cwd, input.prUrl, githubTimeoutMs, githubChecks);
      const blocked = await block("GitHub checks still fail after the repair.", { output: commandSummary(repairDetails) });
      return {
        ...blocked,
        repairStage: "CI",
        repairPrompt: repairPromptForCheck("GitHub CI", "pull-request checks", repairDetails)
      };
    }
    result.checks = `Local: ${checks.map((check) => check.label).join(", ")}; GitHub: passed`;
    await report("CHECKS", "PASSED");
    if (!input.autoMerge) return { ...result, status: "PR_OPEN" };

    const merge = await runner("gh", ["pr", "merge", input.prUrl, "--auto", "--merge", "--match-head-commit", result.commitSha], {
      cwd,
      timeoutMs: githubTimeoutMs
    });
    if (merge.exitCode !== 0) return await block("GitHub could not enable auto-merge after repair.", { output: commandSummary(merge) });
    await report("AUTO_MERGE", "ENABLED");
    const view = await checked(runner, "gh", ["pr", "view", input.prUrl, "--json", "state,mergeCommit,statusCheckRollup"], cwd, githubTimeoutMs);
    const state = parsePrState(view.stdout);
    if (state.state === "MERGED") {
      result.mergeCommitSha = state.mergeCommitSha;
      result.status = "MERGED";
      await report("MERGE", "SUCCEEDED");
      return result;
    }
    return { ...result, status: "AUTO_MERGE_ENABLED" };
  } catch (error) {
    return await block(errorMessage(error));
  }
}

function repairPromptForCheck(source: string, label: string, result: CommandResult): string {
  const details = redactCommandOutput(`${result.stderr}\n${result.stdout}`.trim());
  return [
    `The trusted host ran ${source} validation and ${label} failed.`,
    "Fix only the failure in the current working tree. Preserve the requested implementation and unrelated files.",
    "Do not commit, push, open a PR, or merge; the trusted host will rerun validation.",
    "",
    (details || `exit ${result.exitCode}`).slice(-12_000)
  ].join("\n");
}

async function githubFailedCheckDetails(
  runner: CommandRunner,
  cwd: string,
  prUrl: string,
  timeoutMs: number,
  fallback: CommandResult
): Promise<CommandResult> {
  const checks = await runner("gh", ["pr", "checks", prUrl, "--json", "name,state,link"], {
    cwd,
    timeoutMs: Math.min(timeoutMs, 120_000)
  });
  const runIds = checks.stdout.match(/\/actions\/runs\/(\d+)/g)
    ?.map((value) => value.match(/\d+$/)?.[0])
    .filter((value): value is string => Boolean(value)) ?? [];
  const uniqueRunIds = [...new Set(runIds)].slice(0, 3);
  if (!uniqueRunIds.length) return fallback;
  const logs: string[] = [fallback.stderr, fallback.stdout, checks.stdout].filter(Boolean);
  for (const runId of uniqueRunIds) {
    const result = await runner("gh", ["run", "view", runId, "--log-failed"], {
      cwd,
      timeoutMs: Math.min(timeoutMs, 180_000)
    });
    logs.push(result.stderr, result.stdout);
  }
  return { exitCode: fallback.exitCode, stdout: logs.join("\n").slice(-MAX_COMMAND_OUTPUT), stderr: "" };
}

export async function runCommand(
  executable: string,
  args: string[],
  options: { cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv }
): Promise<CommandResult> {
  return await new Promise((resolveCommand) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill();
      settled = true;
      resolveCommand({ exitCode: 124, stdout, stderr: `${stderr}\nCommand timed out.`.trim() });
    }, options.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk.toString("utf8"));
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveCommand({ exitCode: 127, stdout, stderr: error.message });
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveCommand({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

function trustedPublishBranch(title: string, jobId: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 54) || "codex-task";
  return `agent/${slug}-${jobId.replace(/-/g, "").slice(0, 8)}`;
}

function trustedCommitTitle(title: string): string {
  const oneLine = title.replace(/\s+/g, " ").trim();
  return (oneLine || "Publish Codex task changes").slice(0, 100);
}

async function changedFiles(cwd: string, runner: CommandRunner): Promise<Map<string, FileState>> {
  const tracked = await nulPaths(runner, ["diff", "--name-only", "-z", "HEAD"], cwd);
  const untracked = await nulPaths(runner, ["ls-files", "--others", "--exclude-standard", "-z"], cwd);
  const paths = [...new Set([...tracked, ...untracked])].sort();
  const states = await Promise.all(paths.map(async (path) => [path, { fingerprint: await fingerprint(cwd, path) }] as const));
  return new Map(states);
}

async function fingerprint(cwd: string, path: string): Promise<string> {
  const absolute = resolve(cwd, path);
  try {
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) {
      return `link:${await readlink(absolute)}`;
    }
    if (!info.isFile()) return `other:${info.mode}:${info.size}`;
    const content = await readFile(absolute);
    return `file:${info.size}:${createHash("sha256").update(content).digest("hex")}`;
  } catch {
    return "missing";
  }
}

async function nulPaths(runner: CommandRunner, args: string[], cwd: string): Promise<string[]> {
  const result = await checked(runner, "git", args, cwd, 60_000);
  return result.stdout.split("\0").filter(Boolean).map((path) => path.replace(/\\/g, "/"));
}

async function checked(
  runner: CommandRunner,
  executable: string,
  args: string[],
  cwd: string,
  timeoutMs: number
): Promise<CommandResult> {
  const result = await runner(executable, args, { cwd, timeoutMs });
  if (result.exitCode !== 0) {
    throw new Error(`${basename(executable)} ${args.slice(0, 3).join(" ")} failed: ${commandSummary(result)}`);
  }
  return result;
}

async function detectedLocalChecks(cwd: string): Promise<Array<{
  label: string;
  executable: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
}>> {
  try {
    const parsed = JSON.parse(await readFile(resolve(cwd, "package.json"), "utf8")) as {
      scripts?: Record<string, unknown>;
    };
    const scripts = parsed.scripts ?? {};
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const npx = process.platform === "win32" ? "npx.cmd" : "npx";
    const checks: Array<{ label: string; executable: string; args: string[]; env?: NodeJS.ProcessEnv }> = [];
    if (typeof scripts["db:generate"] === "string") {
      checks.push({ label: "db:generate", executable: npm, args: ["run", "db:generate"] });
    }
    for (const name of ["test", "typecheck", "build"]) {
      if (typeof scripts[name] === "string") {
        checks.push({ label: name, executable: npm, args: name === "test" ? ["test"] : ["run", name] });
      }
    }
    if (await fileExists(resolve(cwd, "prisma", "schema.prisma"))) {
      checks.push({
        label: "prisma validate",
        executable: npx,
        args: ["prisma", "validate"],
        env: {
          ...process.env,
          DATABASE_URL: process.env.DATABASE_URL || "postgresql://user:password@localhost:5432/threadwise"
        }
      });
    }
    return checks;
  } catch {
    return [];
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

function parsePrState(json: string): { state?: string; mergeCommitSha?: string } {
  try {
    const value = JSON.parse(json) as { state?: unknown; mergeCommit?: { oid?: unknown } | null };
    return {
      state: typeof value.state === "string" ? value.state : undefined,
      mergeCommitSha: typeof value.mergeCommit?.oid === "string" ? value.mergeCommit.oid : undefined
    };
  } catch {
    return {};
  }
}

function prNumberFromUrl(url: string): number | undefined {
  const value = Number(url.match(/\/pull\/(\d+)(?:\/|$)/)?.[1]);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function lastUrl(value: string): string | undefined {
  return value.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/g)?.at(-1);
}

function samePaths(left: string[], right: string[]): boolean {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function commandSummary(result: CommandResult): string {
  const value = redactCommandOutput(`${result.stderr}\n${result.stdout}`.trim()).replace(/\s+/g, " ");
  return (value || `exit ${result.exitCode}`).slice(0, 2_000);
}

export function redactCommandOutput(value: string): string {
  return value
    .replace(/\b(?:bearer\s+)[A-Za-z0-9._~+/-]{12,}/gi, "Bearer [REDACTED]")
    .replace(/\b(?:token|api[_-]?key|secret|password)\s*[=:]\s*[^\s,;]+/gi, (match) => `${match.split(/[=:]/, 1)[0]}=[REDACTED]`)
    .replace(/\b(?:gh[pousr]_|sk-)[A-Za-z0-9_-]{16,}/g, "[REDACTED_TOKEN]")
    .replace(/postgres(?:ql)?:\/\/([^:\s]+):[^@\s]+@/gi, "postgresql://$1:[REDACTED]@");
}

function appendBounded(current: string, addition: string): string {
  const combined = current + addition;
  return combined.length <= MAX_COMMAND_OUTPUT ? combined : combined.slice(-MAX_COMMAND_OUTPUT);
}

function normalizePath(path: string): string {
  return resolve(path).replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
