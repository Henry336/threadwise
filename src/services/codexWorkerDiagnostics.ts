import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import type { DiscoveredCodexProject } from "./codex";
import { parseGithubRemote, runCommand, type CommandRunner } from "./trustedGitPublisher";

export async function diagnoseCodexProjects(
  projects: DiscoveredCodexProject[],
  runner: CommandRunner = runCommand
): Promise<DiscoveredCodexProject[]> {
  const results = new Array<DiscoveredCodexProject>(projects.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(4, projects.length) }, async () => {
    while (next < projects.length) {
      const index = next;
      next += 1;
      const project = projects[index]!;
      results[index] = { ...project, ...await diagnoseCodexProject(project.path, runner) };
    }
  });
  await Promise.all(workers);
  return results;
}

export async function diagnoseCodexProject(
  path: string,
  runner: CommandRunner = runCommand
): Promise<Omit<DiscoveredCodexProject, "path" | "lastSeenAt">> {
  const cwd = resolve(path);
  try {
    await access(cwd, constants.R_OK | constants.W_OK);
  } catch {
    return { gitRepository: false, gitReady: false, gitError: "Project folder is not readable and writable." };
  }
  const inside = await runner("git", ["rev-parse", "--is-inside-work-tree"], { cwd, timeoutMs: 15_000 });
  if (inside.exitCode !== 0 || inside.stdout.trim() !== "true") {
    return { gitRepository: false, gitReady: false, gitError: "Not a Git repository." };
  }
  const [root, branch, head, originMain, status, remote] = await Promise.all([
    runner("git", ["rev-parse", "--show-toplevel"], { cwd, timeoutMs: 15_000 }),
    runner("git", ["branch", "--show-current"], { cwd, timeoutMs: 15_000 }),
    runner("git", ["rev-parse", "HEAD"], { cwd, timeoutMs: 15_000 }),
    runner("git", ["rev-parse", "--verify", "origin/main"], { cwd, timeoutMs: 15_000 }),
    runner("git", ["status", "--porcelain=v1", "--untracked-files=normal"], { cwd, timeoutMs: 15_000 }),
    runner("git", ["remote", "get-url", "origin"], { cwd, timeoutMs: 15_000 })
  ]);
  const exactRoot = root.exitCode === 0 && normalize(root.stdout.trim()) === normalize(cwd);
  const githubRemote = remote.exitCode === 0 && Boolean(parseGithubRemote(remote.stdout));
  const gitReady = exactRoot && head.exitCode === 0 && originMain.exitCode === 0 && githubRemote;
  return {
    gitRepository: true,
    gitBranch: clean(branch.stdout),
    gitClean: status.exitCode === 0 ? status.stdout.trim().length === 0 : undefined,
    gitHeadSha: head.exitCode === 0 ? clean(head.stdout) : undefined,
    gitOriginMainSha: originMain.exitCode === 0 ? clean(originMain.stdout) : undefined,
    gitReady,
    gitError: gitReady
      ? undefined
      : !exactRoot
        ? "Selected folder is not the Git repository root."
        : !githubRemote
          ? "Origin is not a supported GitHub remote."
          : "origin/main is unavailable."
  };
}

function normalize(value: string): string {
  return resolve(value).replace(/\\/g, "/").toLowerCase();
}

function clean(value: string): string | undefined {
  return value.trim() || undefined;
}
