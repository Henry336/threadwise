import { existsSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { resolve } from "node:path";
import { discoverCodexProjects } from "./services/codexDiscovery";
import { discoverCodexThreads } from "./services/codexThreadDiscovery";
import {
  CODEX_TASK_SYNC_PATH,
  signCodexTaskSyncRequest
} from "./services/codexTaskSyncAuth";

type SyncConfig = {
  serviceUrl: string;
  privateKey: Buffer;
  workerId: string;
  syncMs: number;
};

loadLocalSyncEnv();

const config = syncConfig();
let stopping = false;

process.once("SIGINT", () => {
  stopping = true;
});
process.once("SIGTERM", () => {
  stopping = true;
});

void run().catch((error) => {
  console.error(`[codex-task-sync] Fatal: ${errorMessage(error)}`);
  process.exitCode = 1;
});

async function run(): Promise<void> {
  console.log(`[codex-task-sync] Starting ${config.workerId}.`);
  console.log(`[codex-task-sync] Relay: ${config.serviceUrl}`);

  while (!stopping) {
    try {
      await syncCatalog();
    } catch (error) {
      console.error(`[codex-task-sync] Sync failed: ${errorMessage(error)}`);
    }
    if (!stopping) await delay(config.syncMs);
  }

  console.log("[codex-task-sync] Stopped.");
}

async function syncCatalog(): Promise<void> {
  const projects = await discoverCodexProjects();
  if (projects.length === 0) {
    console.warn("[codex-task-sync] Discovery returned no projects; keeping the server registry unchanged.");
    return;
  }

  const threads = await discoverCodexThreads(projects.map((project) => project.path));
  const body = { workerId: config.workerId, projects, threads };
  const timestamp = String(Date.now());
  const signature = signCodexTaskSyncRequest(config.privateKey, {
    timestamp,
    method: "POST",
    path: CODEX_TASK_SYNC_PATH,
    workerId: config.workerId,
    body
  });
  const response = await fetch(`${config.serviceUrl}${CODEX_TASK_SYNC_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-threadwise-worker-id": config.workerId,
      "x-threadwise-sync-timestamp": timestamp,
      "x-threadwise-sync-signature": signature
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${await safeResponseText(response)}`);
  }
  const result = await response.json() as {
    projects?: unknown[];
    threadCount?: number;
  };
  console.log(
    `[codex-task-sync] Synced ${result.projects?.length ?? projects.length} projects and `
    + `${result.threadCount ?? threads.length} Codex tasks.`
  );
}

function syncConfig(): SyncConfig {
  const rawUrl = requiredEnv("THREADWISE_CODEX_URL").replace(/\/+$/, "");
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) {
    throw new Error("THREADWISE_CODEX_URL must use HTTPS unless it points to localhost.");
  }

  const privateKeyPath = resolve(requiredEnv("CODEX_TASK_SYNC_PRIVATE_KEY_PATH"));
  const privateKey = readFileSync(privateKeyPath);
  // Validate once at startup, before the first discovery pass.
  signCodexTaskSyncRequest(privateKey, {
    timestamp: "0000000000000",
    method: "POST",
    path: CODEX_TASK_SYNC_PATH,
    workerId: "startup-key-check",
    body: null
  });

  return {
    serviceUrl: rawUrl,
    privateKey,
    workerId: process.env.CODEX_WORKER_ID?.trim() || hostname(),
    syncMs: positiveInteger(process.env.CODEX_WORKER_SYNC_MS, 300_000, 30_000)
  };
}

function loadLocalSyncEnv(): void {
  const file = resolve(process.cwd(), ".env.codex-task-sync");
  if (!existsSync(file) || typeof process.loadEnvFile !== "function") return;
  process.loadEnvFile(file);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
}

function positiveInteger(value: string | undefined, fallback: number, minimum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : fallback;
}

async function safeResponseText(response: Response): Promise<string> {
  const text = await response.text();
  return text.slice(0, 1_000) || response.statusText;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
