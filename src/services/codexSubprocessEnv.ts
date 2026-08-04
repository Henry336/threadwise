import { delimiter, dirname, join } from "node:path";
import { existsSync } from "node:fs";

const SAFE_VARIABLES = [
  "ALLUSERSPROFILE",
  "APPDATA",
  "COMMONPROGRAMFILES",
  "COMMONPROGRAMFILES(X86)",
  "COMMONPROGRAMW6432",
  "COMSPEC",
  "DRIVERDATA",
  "HOMEDRIVE",
  "HOMEPATH",
  "LOCALAPPDATA",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "PATHEXT",
  "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_IDENTIFIER",
  "PROCESSOR_LEVEL",
  "PROCESSOR_REVISION",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMW6432",
  "PROMPT",
  "PSMODULEPATH",
  "PUBLIC",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "USERDOMAIN",
  "USERDOMAIN_ROAMINGPROFILE",
  "USERNAME",
  "USERPROFILE",
  "WINDIR",
  "CODEX_HOME"
] as const;

export function codexSubprocessEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  executablePath = process.execPath,
  credentialAllowlist: string[] = []
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of SAFE_VARIABLES) {
    const value = source[name];
    if (value) env[name] = value;
  }
  for (const name of credentialAllowlist) {
    if (!isAllowedCredentialName(name)) continue;
    const value = source[name];
    if (value) env[name] = value;
  }
  const path = source.PATH || source.Path || source.path || "";
  const safePath = path.split(delimiter).filter((entry) => {
    const normalized = entry.trim().toLowerCase();
    return normalized
      && !normalized.includes("github cli")
      && !normalized.endsWith("\\gh")
      && !existsSync(join(entry, process.platform === "win32" ? "gh.exe" : "gh"));
  });
  const nodeDirectory = dirname(executablePath);
  if (!safePath.some((entry) => entry.toLowerCase() === nodeDirectory.toLowerCase())) {
    safePath.unshift(nodeDirectory);
  }
  env.PATH = safePath.join(delimiter);
  env.Path = env.PATH;
  env.GIT_TERMINAL_PROMPT = "0";
  env.GCM_INTERACTIVE = "Never";
  env.GIT_SSH_COMMAND = process.platform === "win32"
    ? "ssh -o BatchMode=yes -o IdentitiesOnly=yes -o IdentityFile=NUL -o IdentityAgent=none"
    : "ssh -o BatchMode=yes -o IdentitiesOnly=yes -o IdentityFile=/dev/null -o IdentityAgent=none";
  env.GH_CONFIG_DIR = join(env.TEMP || env.TMP || dirname(executablePath), "threadwise-codex-no-gh-auth");
  env.GIT_CONFIG_COUNT = "2";
  env.GIT_CONFIG_KEY_0 = "credential.helper";
  env.GIT_CONFIG_VALUE_0 = "";
  env.GIT_CONFIG_KEY_1 = "core.askPass";
  env.GIT_CONFIG_VALUE_1 = "";
  return env;
}

export function parseCredentialEnvironmentAllowlist(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return [...new Set(value.split(/[;,]/).map((item) => item.trim().toUpperCase()).filter(isAllowedCredentialName))]
    .slice(0, 30);
}

function isAllowedCredentialName(name: string): boolean {
  return /^[A-Z][A-Z0-9_]{1,79}$/.test(name)
    && !/^(?:THREADWISE_|CODEX_WORKER_|DATABASE_URL$|DIRECT_URL$|TELEGRAM_|GH_|GITHUB_|RENDER_|VERCEL_)/.test(name)
    && !/^CODEX_HOME$/.test(name);
}
