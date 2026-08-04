import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, rm } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  captureTrustedGitSnapshot,
  parseGithubRemote,
  runCommand,
  type CommandRunner,
  type TrustedGitSnapshot
} from "./trustedGitPublisher";

export type TrustedGitWorktree = {
  originalRoot: string;
  path: string;
  snapshot: TrustedGitSnapshot;
  cleanup: () => Promise<void>;
};

export async function createTrustedGitWorktree(input: {
  cwd: string;
  jobId: string;
  root?: string;
  runner?: CommandRunner;
  timeoutMs?: number;
}): Promise<TrustedGitWorktree> {
  const runner = input.runner ?? runCommand;
  const timeoutMs = input.timeoutMs ?? 120_000;
  const originalRoot = await canonicalPath(input.cwd);
  const rootResult = await checked(runner, "git", ["rev-parse", "--show-toplevel"], originalRoot, timeoutMs);
  const reportedRoot = await canonicalPath(rootResult.stdout.trim());
  if (normalize(reportedRoot) !== normalize(originalRoot)) {
    throw new Error("Publishing requires the selected project folder to be the Git repository root.");
  }
  const remote = await checked(runner, "git", ["remote", "get-url", "origin"], originalRoot, timeoutMs);
  if (!parseGithubRemote(remote.stdout)) throw new Error("Origin is not a supported GitHub repository.");
  await checked(runner, "git", ["fetch", "--no-tags", "origin", "main"], originalRoot, timeoutMs);

  const worktreeRoot = resolve(input.root || join(tmpdir(), "threadwise-codex-worktrees"));
  await mkdir(worktreeRoot, { recursive: true });
  const safeName = `${basename(originalRoot).replace(/[^a-z0-9._-]+/gi, "-")}-${input.jobId.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
  const path = resolve(worktreeRoot, safeName);
  assertChild(worktreeRoot, path);
  await checked(runner, "git", ["worktree", "add", "--detach", path, "origin/main"], originalRoot, timeoutMs);

  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    assertChild(worktreeRoot, path);
    await runner("git", ["worktree", "remove", "--force", path], { cwd: originalRoot, timeoutMs });
    await rm(path, { recursive: true, force: true });
    await runner("git", ["worktree", "prune"], { cwd: originalRoot, timeoutMs });
  };

  try {
    await prepareTrustedWorktreeDependencies(path, runner, timeoutMs);
    return {
      originalRoot,
      path,
      snapshot: await captureTrustedGitSnapshot(path, runner),
      cleanup
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

async function prepareTrustedWorktreeDependencies(
  path: string,
  runner: CommandRunner,
  timeoutMs: number
): Promise<void> {
  if (!await fileExists(join(path, "package.json"))) return;
  if (!await fileExists(join(path, "package-lock.json"))) {
    throw new Error("Trusted publishing requires package-lock.json to prepare an isolated npm worktree.");
  }
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  await checked(
    runner,
    npm,
    ["ci", "--no-audit", "--no-fund"],
    path,
    Math.max(timeoutMs, 10 * 60_000)
  );
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile();
  } catch {
    return false;
  }
}

function assertChild(root: string, candidate: string): void {
  if (!isAbsolute(candidate)) throw new Error("Trusted worktree path must be absolute.");
  const child = relative(root, candidate);
  if (!child || child.startsWith("..") || isAbsolute(child)) {
    throw new Error("Trusted worktree escaped its configured root.");
  }
}

async function checked(
  runner: CommandRunner,
  executable: string,
  args: string[],
  cwd: string,
  timeoutMs: number
) {
  const result = await runner(executable, args, { cwd, timeoutMs });
  if (result.exitCode !== 0) {
    throw new Error(`${executable} ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim().slice(0, 1_000)}`);
  }
  return result;
}

function normalize(value: string): string {
  return resolve(value).replace(/\\/g, "/").toLowerCase();
}

async function canonicalPath(value: string): Promise<string> {
  const absolute = resolve(value);
  try {
    return await realpath(absolute);
  } catch {
    return absolute;
  }
}
