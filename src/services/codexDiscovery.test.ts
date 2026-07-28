import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverCodexProjects } from "./codexDiscovery";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Codex project discovery", () => {
  it("finds live Git projects, deduplicates them, and excludes internal worktrees", async () => {
    const root = await mkdtemp(join(tmpdir(), "threadwise-codex-discovery-"));
    temporaryRoots.push(root);
    const sessions = join(root, "sessions", "2026", "07", "29");
    const project = join(root, "projects", "Threadwise");
    const nonGit = join(root, "projects", "notes");
    const worktree = join(root, "worktrees", "abcd", "Threadwise");
    const alternateHomeWorktree = join(root, "users", ".codex", "worktrees", "efgh", "Threadwise");
    await Promise.all([
      mkdir(sessions, { recursive: true }),
      mkdir(join(project, ".git"), { recursive: true }),
      mkdir(nonGit, { recursive: true }),
      mkdir(join(worktree, ".git"), { recursive: true }),
      mkdir(join(alternateHomeWorktree, ".git"), { recursive: true })
    ]);

    await Promise.all([
      writeSession(join(sessions, "old.jsonl"), project, "2026-07-28T01:00:00.000Z"),
      writeSession(join(sessions, "new.jsonl"), project, "2026-07-29T02:00:00.000Z"),
      writeSession(join(sessions, "non-git.jsonl"), nonGit, "2026-07-29T03:00:00.000Z"),
      writeSession(join(sessions, "worktree.jsonl"), worktree, "2026-07-29T04:00:00.000Z"),
      writeSession(join(sessions, "alternate-worktree.jsonl"), alternateHomeWorktree, "2026-07-29T05:00:00.000Z")
    ]);

    expect(await discoverCodexProjects(root)).toEqual([{
      path: project,
      lastSeenAt: "2026-07-29T02:00:00.000Z"
    }]);
  });
});

async function writeSession(file: string, cwd: string, timestamp: string): Promise<void> {
  await writeFile(file, `${JSON.stringify({
    type: "session_meta",
    timestamp,
    payload: { cwd, timestamp }
  })}\n`, "utf8");
}
