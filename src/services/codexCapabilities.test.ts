import { describe, expect, it } from "vitest";
import {
  approvalCapabilities,
  inferCapabilityFromError,
  parseCodexAccess
} from "./codexCapabilities";

describe("Codex task capabilities", () => {
  it("expands profiles without granting duplicate capabilities", () => {
    expect(parseCodexAccess("deploy+files")).toEqual({
      capabilities: ["internet", "publish", "deploy", "files"],
      invalid: []
    });
    expect(parseCodexAccess("full,internet").capabilities).toEqual([
      "internet", "browser", "files"
    ]);
  });

  it("keeps code and publishing host-only while requiring approval for expansive access", () => {
    expect(approvalCapabilities(["publish", "internet", "browser", "files"])).toEqual([
      "internet", "browser", "files"
    ]);
  });

  it("infers a durable approval handoff from common sandbox failures", () => {
    expect(inferCapabilityFromError("Playwright browser executable is unavailable")).toBe("browser");
    expect(inferCapabilityFromError("fetch failed: ENOTFOUND example.com")).toBe("internet");
    expect(inferCapabilityFromError("Path is outside the workspace")).toBe("files");
    expect(inferCapabilityFromError("TypeScript compilation failed")).toBeUndefined();
  });
});
