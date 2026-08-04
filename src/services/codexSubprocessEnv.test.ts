import { delimiter } from "node:path";
import { describe, expect, it } from "vitest";
import { codexSubprocessEnvironment, parseCredentialEnvironmentAllowlist } from "./codexSubprocessEnv";

describe("Codex subprocess environment", () => {
  it("keeps desktop Codex state but removes host credentials and GitHub CLI", () => {
    const env = codexSubprocessEnvironment({
      CODEX_HOME: "D:\\CodexData\\home",
      PATH: ["C:\\Program Files\\nodejs", "C:\\Program Files\\GitHub CLI", "C:\\Windows\\System32"].join(delimiter),
      SYSTEMROOT: "C:\\Windows",
      THREADWISE_CODEX_WORKER_TOKEN: "worker-secret",
      DATABASE_URL: "postgresql://secret",
      GEMINI_API_KEY: "gemini-secret",
      RENDER_API_KEY: "render-secret",
      API_KEY_21ST: "plugin-secret"
    }, "C:\\Program Files\\nodejs\\node.exe", ["API_KEY_21ST", "THREADWISE_CODEX_WORKER_TOKEN"]);
    expect(env.CODEX_HOME).toBe("D:\\CodexData\\home");
    expect(env.SYSTEMROOT).toBe("C:\\Windows");
    expect(env.PATH).not.toContain("GitHub CLI");
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(env).not.toHaveProperty("THREADWISE_CODEX_WORKER_TOKEN");
    expect(env).not.toHaveProperty("DATABASE_URL");
    expect(env).not.toHaveProperty("GEMINI_API_KEY");
    expect(env).not.toHaveProperty("RENDER_API_KEY");
    expect(env.API_KEY_21ST).toBe("plugin-secret");
    expect(parseCredentialEnvironmentAllowlist(
      "API_KEY_21ST;GEMINI_API_KEY;THREADWISE_CODEX_WORKER_TOKEN;DATABASE_URL"
    )).toEqual(["API_KEY_21ST", "GEMINI_API_KEY"]);
  });
});
