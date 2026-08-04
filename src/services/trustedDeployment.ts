export type TrustedDeployTarget = {
  provider: "render" | "vercel" | "generic-git";
  healthUrl: string;
  expectedService?: string;
};

export type TrustedDeployResult = {
  status: "VERIFIED" | "BLOCKED";
  target: string;
  provider?: string;
  healthUrl?: string;
  blocker?: string;
};

export function parseTrustedDeployTargets(value: string | undefined): Record<string, TrustedDeployTarget> {
  if (!value?.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const targets: Record<string, TrustedDeployTarget> = {};
  for (const [alias, candidate] of Object.entries(parsed as Record<string, unknown>)) {
    if (!/^[a-z0-9][a-z0-9-]{0,47}$/i.test(alias) || !candidate || typeof candidate !== "object") continue;
    const item = candidate as Record<string, unknown>;
    if (!isProvider(item.provider) || typeof item.healthUrl !== "string") continue;
    try {
      const url = new URL(item.healthUrl);
      if (url.protocol !== "https:" || isLocalHost(url.hostname)) continue;
      targets[alias.toLowerCase()] = {
        provider: item.provider,
        healthUrl: url.toString(),
        expectedService: typeof item.expectedService === "string"
          ? item.expectedService.trim().slice(0, 100) || undefined
          : undefined
      };
    } catch {
      // Invalid targets are omitted and surfaced by /codex doctor.
    }
  }
  return targets;
}

export async function verifyTrustedDeployment(input: {
  alias: string;
  mergeCommitSha: string;
  targets: Record<string, TrustedDeployTarget>;
  timeoutMs?: number;
  pollMs?: number;
  fetcher?: typeof fetch;
}): Promise<TrustedDeployResult> {
  const target = input.targets[input.alias.toLowerCase()];
  if (!target) return { status: "BLOCKED", target: input.alias, blocker: "No trusted deployment target is configured." };
  const fetcher = input.fetcher ?? fetch;
  const timeoutMs = input.timeoutMs ?? 20 * 60_000;
  const pollMs = input.pollMs ?? 15_000;
  const deadline = Date.now() + timeoutMs;
  let lastError = "Deployment health endpoint did not become ready.";
  do {
    try {
      const response = await fetcher(target.healthUrl, {
        headers: { accept: "application/json", "cache-control": "no-cache" },
        signal: AbortSignal.timeout(Math.min(30_000, Math.max(1_000, timeoutMs)))
      });
      if (response.ok) {
        const payload = await response.json() as Record<string, unknown>;
        const serviceMatches = !target.expectedService || payload.service === target.expectedService;
        const commit = typeof payload.commit === "string" ? payload.commit : undefined;
        const commitMatches = !commit || input.mergeCommitSha.startsWith(commit) || commit.startsWith(input.mergeCommitSha.slice(0, 12));
        if (payload.ok === true && serviceMatches && commitMatches) {
          return {
            status: "VERIFIED",
            target: input.alias,
            provider: target.provider,
            healthUrl: target.healthUrl
          };
        }
        lastError = !serviceMatches
          ? "Health endpoint returned the wrong service identity."
          : !commitMatches
            ? "Health endpoint is still serving an older commit."
            : "Health endpoint did not report ok=true.";
      } else {
        lastError = `Health endpoint returned HTTP ${response.status}.`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() < deadline) await delay(Math.min(pollMs, Math.max(0, deadline - Date.now())));
  } while (Date.now() < deadline);
  return {
    status: "BLOCKED",
    target: input.alias,
    provider: target.provider,
    healthUrl: target.healthUrl,
    blocker: lastError.slice(0, 1_000)
  };
}

function isProvider(value: unknown): value is TrustedDeployTarget["provider"] {
  return value === "render" || value === "vercel" || value === "generic-git";
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "::1"
    || hostname.endsWith(".local");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
