import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  addedDiffContainsSensitiveValue,
  captureTrustedGitSnapshot,
  detectTrustedPublishIntent,
  isAllowedPublishBranch,
  parseGithubRemote,
  publishTrustedCodexChanges,
  redactCommandOutput,
  runCommand,
  sensitivePublishPaths,
  type CommandRunner,
  type TrustedPublishEvent
} from "./trustedGitPublisher";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })
  ));
});

describe("trusted Telegram publishing intent", () => {
  it("recognizes the phone-friendly publish and auto-merge request", () => {
    expect(detectTrustedPublishIntent(
      "Implement this, verify it, publish it, and auto-merge when CI passes."
    )).toEqual({ requested: true, autoMerge: true });
    expect(detectTrustedPublishIntent("Fix it and publish a PR")).toEqual({
      requested: true,
      autoMerge: false
    });
    expect(detectTrustedPublishIntent("Implement and verify it")).toEqual({
      requested: false,
      autoMerge: false
    });
  }, 15_000);
});

describe("trusted publishing policies", () => {
  it("allows only well-formed agent branches", () => {
    expect(isAllowedPublishBranch("agent/fix-reminders-a1b2c3d4")).toBe(true);
    expect(isAllowedPublishBranch("main")).toBe(false);
    expect(isAllowedPublishBranch("feature/fix")).toBe(false);
    expect(isAllowedPublishBranch("agent/../main")).toBe(false);
    expect(isAllowedPublishBranch("agent//fix")).toBe(false);
  });

  it("accepts only GitHub HTTPS or SSH origins", () => {
    expect(parseGithubRemote("https://github.com/Henry336/threadwise.git")).toBe("Henry336/threadwise");
    expect(parseGithubRemote("git@github.com:Henry336/threadwise.git")).toBe("Henry336/threadwise");
    expect(parseGithubRemote("https://gitlab.com/Henry336/threadwise.git")).toBeUndefined();
  });

  it("blocks credential files and added secret values", () => {
    expect(sensitivePublishPaths([
      "src/main.ts",
      ".env",
      "keys/deploy.pem",
      ".env.example",
      ".threadwise/publish.json"
    ])).toEqual([".env", "keys/deploy.pem", ".threadwise/publish.json"]);
    expect(addedDiffContainsSensitiveValue("+const value = \"safe\";")).toBe(false);
    expect(addedDiffContainsSensitiveValue(
      `+${["BEGIN", "PRIVATE", "KEY"].join(" ")}`
    )).toBe(true);
    expect(addedDiffContainsSensitiveValue(
      `+CODEX_WORKER_TOKEN=${"x".repeat(32)}`
    )).toBe(true);
  });

  it("redacts secrets from host check logs before audit or repair prompts", () => {
    const redacted = redactCommandOutput(
      `TOKEN=${"x".repeat(32)} DATABASE_URL=postgresql://user:password@example.test/db`
    );
    expect(redacted).not.toContain("x".repeat(32));
    expect(redacted).not.toContain(":password@");
    expect(redacted).toContain("[REDACTED]");
  }, 15_000);
});

describe("trusted publisher repository isolation", () => {
  it("blocks overlap with changes that existed before the Codex turn", async () => {
    const root = await testRepository();
    await writeFile(join(root, "unrelated.txt"), "user change\n");
    const snapshot = await captureTrustedGitSnapshot(root);
    await writeFile(join(root, "unrelated.txt"), "user change plus Codex overlap\n");
    const events: TrustedPublishEvent[] = [];
    const result = await publishTrustedCodexChanges({
      cwd: root,
      jobId: "12345678-aaaa-bbbb-cccc-dddddddddddd",
      title: "Implement feature",
      autoMerge: true,
      snapshot,
      report: async (event) => {
        events.push(event);
      }
    });
    expect(result.status).toBe("BLOCKED");
    expect(result.blocker).toMatch(/overlapped changes/i);
    expect(events.at(-1)?.action).toBe("BLOCKED");
    expect((await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: root,
      timeoutMs: 30_000
    })).stdout.trim()).toBe("main");
  }, 15_000);

  it("commits only new task files, pushes agent/*, and opens a PR", async () => {
    const root = await testRepository();
    await writeFile(join(root, "unrelated.txt"), "leave me uncommitted\n");
    const snapshot = await captureTrustedGitSnapshot(root);
    await writeFile(join(root, "feature.ts"), "export const ready = true;\n");
    const calls: string[] = [];
    const runner = trustedRunner(calls);
    const events: TrustedPublishEvent[] = [];
    const result = await publishTrustedCodexChanges({
      cwd: root,
      jobId: "12345678-aaaa-bbbb-cccc-dddddddddddd",
      title: "Implement feature",
      autoMerge: false,
      snapshot,
      runner,
      report: async (event) => {
        events.push(event);
      }
    });

    expect(result).toMatchObject({
      status: "PR_OPEN",
      branch: "agent/implement-feature-12345678",
      prNumber: 42,
      prUrl: "https://github.com/Henry336/threadwise/pull/42"
    });
    expect(calls).toContain("git push --set-upstream origin agent/implement-feature-12345678");
    expect(events.map((event) => event.action)).toEqual(["COMMIT", "PUSH", "PR"]);
    const committed = await runCommand("git", ["show", "--name-only", "--format=", "HEAD"], {
      cwd: root,
      timeoutMs: 30_000
    });
    expect(committed.stdout.trim()).toBe("feature.ts");
    const status = await runCommand("git", ["status", "--porcelain"], {
      cwd: root,
      timeoutMs: 30_000
    });
    expect(status.stdout).toContain("unrelated.txt");
  }, 15_000);

  it("stops before committing when a required local check fails", async () => {
    const root = await testRepository();
    const snapshot = await captureTrustedGitSnapshot(root);
    await writeFile(join(root, "feature.ts"), "export const broken = true;\n");
    const calls: string[] = [];
    const base = trustedRunner(calls);
    const runner: CommandRunner = async (executable, args, options) => {
      if (/npm(?:\.cmd)?$/i.test(executable) && args.includes("test")) {
        return { exitCode: 1, stdout: "", stderr: "test failure" };
      }
      return await base(executable, args, options);
    };
    const result = await publishTrustedCodexChanges({
      cwd: root,
      jobId: "abcdef12-aaaa-bbbb-cccc-dddddddddddd",
      title: "Broken feature",
      autoMerge: true,
      snapshot,
      runner,
      report: async () => undefined
    });
    expect(result.status).toBe("BLOCKED");
    expect(result.blocker).toMatch(/local check failed: test/i);
    expect(result.repairStage).toBe("LOCAL_CHECKS");
    expect(result.repairPrompt).toContain("test failure");
    expect(calls.some((call) => call.startsWith("git commit"))).toBe(false);
  }, 15_000);
});

async function testRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "threadwise-publisher-test-"));
  temporaryDirectories.push(root);
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "Threadwise Test"]);
  await git(root, ["config", "user.email", "threadwise@example.test"]);
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "publisher-test",
    private: true,
    scripts: {
      test: "echo tests",
      typecheck: "echo typecheck",
      build: "echo build"
    }
  }));
  await writeFile(join(root, "base.txt"), "base\n");
  await git(root, ["add", "package.json", "base.txt"]);
  await git(root, ["commit", "-m", "Initial"]);
  const head = (await git(root, ["rev-parse", "HEAD"])).stdout.trim();
  await git(root, ["update-ref", "refs/remotes/origin/main", head]);
  return root;
}

function trustedRunner(calls: string[]): CommandRunner {
  return async (executable, args, options) => {
    calls.push(`${executable} ${args.join(" ")}`);
    if (executable === "git" && args[0] === "fetch") {
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (executable === "git" && args[0] === "push") {
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (executable === "git" && args[0] === "remote" && args[1] === "get-url") {
      return {
        exitCode: 0,
        stdout: "https://github.com/Henry336/threadwise.git\n",
        stderr: ""
      };
    }
    if (/npm(?:\.cmd)?$/i.test(executable) || /npx(?:\.cmd)?$/i.test(executable)) {
      return { exitCode: 0, stdout: "passed\n", stderr: "" };
    }
    if (executable === "gh" && args[0] === "auth") {
      return { exitCode: 0, stdout: "authenticated\n", stderr: "" };
    }
    if (executable === "gh" && args[0] === "pr" && args[1] === "create") {
      return {
        exitCode: 0,
        stdout: "https://github.com/Henry336/threadwise/pull/42\n",
        stderr: ""
      };
    }
    return await runCommand(executable, args, options);
  };
}

async function git(cwd: string, args: string[]) {
  const result = await runCommand("git", args, { cwd, timeoutMs: 30_000 });
  if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout);
  return result;
}
