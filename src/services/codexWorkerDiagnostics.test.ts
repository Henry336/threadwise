import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { diagnoseCodexProject } from "./codexWorkerDiagnostics";
import type { CommandRunner } from "./trustedGitPublisher";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Codex project diagnostics", () => {
  it("reports publish readiness and dirty state without changing the repository", async () => {
    const path = await mkdtemp(join(tmpdir(), "threadwise-project-doctor-"));
    temporaryDirectories.push(path);
    const runner: CommandRunner = async (_executable, args) => {
      const command = args.join(" ");
      if (command === "rev-parse --is-inside-work-tree") return ok("true\n");
      if (command === "rev-parse --show-toplevel") return ok(`${resolve(path)}\n`);
      if (command === "branch --show-current") return ok("main\n");
      if (command === "rev-parse HEAD") return ok(`${"a".repeat(40)}\n`);
      if (command === "rev-parse --verify origin/main") return ok(`${"b".repeat(40)}\n`);
      if (command.startsWith("status ")) return ok("?? personal.txt\n");
      if (command === "remote get-url origin") return ok("https://github.com/Henry336/threadwise.git\n");
      return { exitCode: 1, stdout: "", stderr: "unexpected command" };
    };
    await expect(diagnoseCodexProject(path, runner)).resolves.toMatchObject({
      gitRepository: true,
      gitBranch: "main",
      gitClean: false,
      gitReady: true
    });
  });
});

function ok(stdout: string) {
  return { exitCode: 0, stdout, stderr: "" };
}
