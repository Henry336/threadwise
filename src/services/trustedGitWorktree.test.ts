import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCommand, type CommandRunner } from "./trustedGitPublisher";
import { createTrustedGitWorktree } from "./trustedGitWorktree";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("trusted Git worktrees", () => {
  it("starts publish work on origin/main without touching the user's dirty checkout", async () => {
    const repository = await mkdtemp(join(tmpdir(), "threadwise-worktree-repo-"));
    const worktreeRoot = await mkdtemp(join(tmpdir(), "threadwise-worktree-root-"));
    temporaryDirectories.push(repository, worktreeRoot);
    await git(repository, ["init", "-b", "main"]);
    await git(repository, ["config", "user.name", "Threadwise Test"]);
    await git(repository, ["config", "user.email", "threadwise@example.test"]);
    await writeFile(join(repository, "base.txt"), "base\n");
    await git(repository, ["add", "base.txt"]);
    await git(repository, ["commit", "-m", "Initial"]);
    const head = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();
    await git(repository, ["update-ref", "refs/remotes/origin/main", head]);
    await writeFile(join(repository, "personal.txt"), "unrelated desktop work\n");

    const runner: CommandRunner = async (executable, args, options) => {
      if (executable === "git" && args[0] === "fetch") return { exitCode: 0, stdout: "", stderr: "" };
      if (executable === "git" && args[0] === "remote" && args[1] === "get-url") {
        return { exitCode: 0, stdout: "https://github.com/Henry336/threadwise.git\n", stderr: "" };
      }
      return await runCommand(executable, args, options);
    };

    const worktree = await createTrustedGitWorktree({
      cwd: repository,
      jobId: "12345678-aaaa-bbbb-cccc-dddddddddddd",
      root: worktreeRoot,
      runner
    });
    expect(worktree.snapshot.headSha).toBe(head);
    expect(existsSync(join(repository, "personal.txt"))).toBe(true);
    expect(existsSync(join(worktree.path, "personal.txt"))).toBe(false);
    const path = worktree.path;
    await worktree.cleanup();
    expect(existsSync(path)).toBe(false);
    expect(existsSync(join(repository, "personal.txt"))).toBe(true);
  }, 15_000);
});

async function git(cwd: string, args: string[]) {
  const result = await runCommand("git", args, { cwd, timeoutMs: 30_000 });
  if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout);
  return result;
}
