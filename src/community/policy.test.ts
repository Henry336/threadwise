import { describe, expect, it } from "vitest";
import {
  findPolicyMatches,
  highestSeverityMatch,
  inferTriggerMatchType,
  normalizeCommunityText,
  safeModeratorDefaults,
  triggerMatches
} from "./policy";

describe("Beacon policy normalization", () => {
  it("normalizes spacing, case, punctuation, and Myanmar digits", () => {
    expect(normalizeCommunityText("  GUARANTEED\u200B   Admission ၁၂ ")).toBe("guaranteed admission 12");
  });

  it("converts Zawgyi text to Unicode before matching", () => {
    expect(normalizeCommunityText("ျမန္မာစာ")).toBe("မြန်မာစာ");
  });

  it("infers safe trigger types", () => {
    expect(inferTriggerMatchType("scam")).toBe("WORD");
    expect(inferTriggerMatchType("guaranteed admission")).toBe("PHRASE");
    expect(inferTriggerMatchType("bad.example.com")).toBe("DOMAIN");
  });

  it("does not match a word inside another word", () => {
    expect(triggerMatches("this is classical", { normalizedPattern: "ass", matchType: "WORD" })).toBe(false);
    expect(triggerMatches("this is ass", { normalizedPattern: "ass", matchType: "WORD" })).toBe(true);
  });

  it("chooses the strictest matching trigger", () => {
    const matches = findPolicyMatches("guaranteed admission from bad.example.com", [
      trigger("phrase", "guaranteed admission", "PHRASE", "WARN"),
      trigger("domain", "bad.example.com", "DOMAIN", "BAN")
    ]);
    expect(matches).toHaveLength(2);
    expect(highestSeverityMatch(matches)?.id).toBe("domain");
  });

  it("keeps the recommended moderator preset useful but non-destructive", () => {
    expect(safeModeratorDefaults).toEqual({
      canWarnDelete: true,
      canMute: true,
      canBan: false,
      canEditRules: false,
      canChangeAutomaticActions: false,
      canManageTrustedMembers: false,
      canLockdown: false
    });
  });
});

function trigger(id: string, pattern: string, matchType: "WORD" | "PHRASE" | "DOMAIN", action: "REVIEW" | "WARN" | "MUTE" | "BAN") {
  return {
    id,
    pattern,
    normalizedPattern: pattern,
    matchType,
    triggerGroup: {
      id: `${id}-group`,
      name: id,
      action,
      deleteMessage: action !== "REVIEW",
      muteDurationMinutes: action === "MUTE" ? 60 : null,
      notifyModerators: true,
      enabled: true
    }
  };
}
