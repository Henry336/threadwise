import { describe, expect, it } from "vitest";
import {
  findPolicyMatches,
  highestSeverityMatch,
  inferTriggerMatchType,
  isBeaconInvocation,
  normalizeCommunityText,
  offencePointOptions,
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
      canAddTriggers: false,
      canRemoveTriggers: false,
      canChangeTriggerSeverity: false,
      canManageTriggerGroups: false,
      canChangeAutomaticActions: false,
      canManageTrustedMembers: false,
      canLockdown: false
    });
  });

  it("opens Beacon only for explicit, convenient calls", () => {
    for (const value of ["Beacon", "beacon", "Hey Beacon", "hey beacon!", "Beacon menu", "menu"]) {
      expect(isBeaconInvocation(value)).toBe(true);
    }
    for (const value of ["beaconing", "the menu is useful", "hey there", "Beacon should ban this"]) {
      expect(isBeaconInvocation(value)).toBe(false);
    }
  });

  it("offers bounded per-offence proposals without changing the owner's severity policy", () => {
    expect(offencePointOptions(3)).toEqual([2, 3, 4, 5]);
    expect(offencePointOptions(0)).toEqual([0, 1, 2]);
    expect(offencePointOptions(100)).toEqual([99, 100]);
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
      enabled: true,
      severity: action === "BAN" ? "CRITICAL" as const : action === "MUTE" ? "SERIOUS" as const : action === "WARN" ? "MODERATE" as const : "MINOR" as const
    }
  };
}
