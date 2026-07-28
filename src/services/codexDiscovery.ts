import { createReadStream, existsSync, statSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, normalize, resolve } from "node:path";
import { createInterface } from "node:readline";

export type DiscoveredCodexProject = {
  path: string;
  lastSeenAt: string;
};

export async function discoverCodexProjects(codexHome = configuredCodexHome()): Promise<DiscoveredCodexProject[]> {
  const sessions = join(codexHome, "sessions");
  if (!existsSync(sessions)) return [];
  const files = await jsonlFiles(sessions);
  const projects = new Map<string, DiscoveredCodexProject>();
  const worktreesRoot = normalize(join(codexHome, "worktrees")).toLowerCase();

  for (const file of files) {
    const metadata = await sessionMetadata(file);
    if (!metadata?.cwd || !isAbsolute(metadata.cwd)) continue;
    const projectPath = normalize(resolve(metadata.cwd));
    const key = projectPath.toLowerCase();
    if (isCodexManagedWorktree(key, worktreesRoot)) continue;
    if (!isRunnableProject(projectPath)) continue;

    const lastSeenAt = validIsoDate(metadata.timestamp) ?? (await stat(file)).mtime.toISOString();
    const previous = projects.get(key);
    if (!previous || previous.lastSeenAt < lastSeenAt) {
      projects.set(key, { path: projectPath, lastSeenAt });
    }
  }

  return [...projects.values()].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

function isCodexManagedWorktree(normalizedLowerPath: string, configuredWorktreesRoot: string): boolean {
  const portable = normalizedLowerPath.replace(/\\/g, "/");
  const configured = configuredWorktreesRoot.replace(/\\/g, "/");
  return portable === configured
    || portable.startsWith(`${configured}/`)
    || portable.includes("/.codex/worktrees/");
}

async function sessionMetadata(file: string): Promise<{ cwd?: string; timestamp?: string } | undefined> {
  const input = createReadStream(file, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const record = JSON.parse(line) as {
        type?: string;
        timestamp?: string;
        payload?: { cwd?: string; timestamp?: string };
      };
      if (record.type !== "session_meta") return undefined;
      return {
        cwd: record.payload?.cwd,
        timestamp: record.payload?.timestamp ?? record.timestamp
      };
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    lines.close();
    input.destroy();
  }
}

async function jsonlFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) found.push(path);
    }
  }
  return found;
}

function configuredCodexHome(): string {
  return resolve(process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"));
}

function isRunnableProject(path: string): boolean {
  try {
    return statSync(path).isDirectory() && existsSync(join(path, ".git"));
  } catch {
    return false;
  }
}

function validIsoDate(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
