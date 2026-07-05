import { describe, expect, it } from "vitest";

function buildExpectedBriefShape(text: string) {
  return {
    hasRole: text.includes("You are a senior software engineer"),
    hasGoal: text.includes("Goal:"),
    hasImplementationRequest: text.includes("Implementation request:"),
    protectsSecrets: text.includes("Do not commit secrets"),
    asksForRepo: text.includes("If the repo/location is missing")
  };
}

describe("implementation brief shape", () => {
  it("captures the important sections expected by coding agents", () => {
    const sample = [
      "You are a senior software engineer implementing IDEA-1: Test Idea.",
      "",
      "Goal:",
      "Build the thing.",
      "",
      "Implementation request:",
      "- Inspect the existing repository before editing.",
      "- Do not commit secrets, local .env files, generated credentials, or private tokens.",
      "",
      "If the repo/location is missing, ask me for the target repository before implementing."
    ].join("\n");

    expect(buildExpectedBriefShape(sample)).toEqual({
      hasRole: true,
      hasGoal: true,
      hasImplementationRequest: true,
      protectsSecrets: true,
      asksForRepo: true
    });
  });
});

