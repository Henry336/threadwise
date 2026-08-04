export const CODEX_CAPABILITIES = [
  "internet",
  "publish",
  "deploy",
  "browser",
  "files"
] as const;

export type CodexCapability = typeof CODEX_CAPABILITIES[number];

export const CODEX_ACCESS_PROFILES = {
  code: [],
  standard: [],
  internet: ["internet"],
  publish: ["publish"],
  deploy: ["internet", "publish", "deploy"],
  browser: ["internet", "browser"],
  full: ["internet", "browser", "files"]
} as const satisfies Record<string, readonly CodexCapability[]>;

export type CodexAccessProfile = keyof typeof CODEX_ACCESS_PROFILES;

export const APPROVAL_REQUIRED_CAPABILITIES: readonly CodexCapability[] = [
  "internet",
  "deploy",
  "browser",
  "files"
];

export function isCodexCapability(value: string): value is CodexCapability {
  return (CODEX_CAPABILITIES as readonly string[]).includes(value.toLowerCase());
}

export function parseCodexAccess(value: string | undefined): {
  capabilities: CodexCapability[];
  invalid: string[];
} {
  if (!value?.trim()) return { capabilities: [], invalid: [] };
  const requested = value.split(/[,+]/).map((item) => item.trim().toLowerCase()).filter(Boolean);
  const capabilities = new Set<CodexCapability>();
  const invalid: string[] = [];
  for (const item of requested) {
    if (item in CODEX_ACCESS_PROFILES) {
      for (const capability of CODEX_ACCESS_PROFILES[item as CodexAccessProfile]) {
        capabilities.add(capability);
      }
    } else if (isCodexCapability(item)) {
      capabilities.add(item);
    } else {
      invalid.push(item);
    }
  }
  return { capabilities: [...capabilities], invalid };
}

export function approvalCapabilities(capabilities: readonly string[]): CodexCapability[] {
  return capabilities.filter((capability): capability is CodexCapability =>
    isCodexCapability(capability)
    && APPROVAL_REQUIRED_CAPABILITIES.includes(capability)
  );
}

export function capabilityLabel(capability: string): string {
  if (capability === "internet") return "Internet access";
  if (capability === "publish") return "GitHub publishing";
  if (capability === "deploy") return "trusted deployment";
  if (capability === "browser") return "browser automation";
  if (capability === "files") return "configured laptop files";
  return capability;
}

export function inferCapabilityFromError(error: unknown): CodexCapability | undefined {
  const message = error instanceof Error ? error.message : String(error);
  if (/browser|playwright|chrom(?:e|ium)|computer use/i.test(message)) return "browser";
  if (/network|socket|dns|connect|internet|registry|fetch failed|enotfound|econnrefused/i.test(message)) {
    return "internet";
  }
  if (/outside (?:the )?workspace|additional director|permission denied|access is denied|eacces/i.test(message)) {
    return "files";
  }
  return undefined;
}
