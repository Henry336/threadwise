import { describe, expect, it } from "vitest";
import {
  canOpenBeaconSafety,
  canSubmitTriggerPrivately,
  canUseOwnerMutation,
  canUseReportAction,
  hasBeaconOperationalHistory,
  isBeaconOwnerOnlyControl,
  isBeaconPublicGroupControl
} from "./controlAccess";
import type { CommunityAccess } from "./store";

describe("Beacon control-plane authorization", () => {
  it("keeps the public group surface limited to rules and reporting help", () => {
    expect(isBeaconPublicGroupControl("bc:public")).toBe(true);
    expect(isBeaconPublicGroupControl("bc:rules")).toBe(true);
    expect(isBeaconPublicGroupControl("bc:reporthelp")).toBe(true);
    expect(isBeaconPublicGroupControl("bc:policy")).toBe(false);
    expect(isBeaconPublicGroupControl("bc:lib")).toBe(false);
  });

  it.each([
    "bc:lib", "bc:libsearch", "bc:libpage:2", "bc:tr:crafted", "bc:trdelok",
    "bc:cats", "bc:cat:crafted", "bc:catdelok", "bc:actok", "bc:scores",
    "bc:score:CRITICAL", "bc:threshold:BAN", "bc:mods", "bc:modrmok",
    "bc:pending", "bc:audits"
  ])("classifies stale or crafted owner-only callback %s before rendering", (data) => {
    expect(isBeaconOwnerOnlyControl(data)).toBe(true);
  });

  it("allows trigger submissions only in private chat and only with permission", () => {
    expect(canSubmitTriggerPrivately(access({ canAddTriggers: true }), "private")).toBe(true);
    expect(canSubmitTriggerPrivately(access({ canAddTriggers: true }), "supergroup")).toBe(false);
    expect(canSubmitTriggerPrivately(access(), "private")).toBe(false);
  });

  it("reveals report actions only when granted", () => {
    const moderator = access({ moderator: {} as CommunityAccess["moderator"], canWarn: true, canMute: true });
    expect(canUseReportAction(moderator, "d")).toBe(true);
    expect(canUseReportAction(moderator, "w")).toBe(true);
    expect(canUseReportAction(moderator, "m")).toBe(true);
    expect(canUseReportAction(moderator, "x")).toBe(false);
    expect(canUseReportAction(moderator, "b")).toBe(false);
    expect(canUseReportAction(moderator, "score")).toBe(true);
  });

  it("keeps safety and history destinations permission-aware", () => {
    expect(canOpenBeaconSafety(access())).toBe(false);
    expect(canOpenBeaconSafety(access({ canLockdown: true }))).toBe(true);
    expect(hasBeaconOperationalHistory(access())).toBe(false);
    expect(hasBeaconOperationalHistory(access({ canDelete: true }))).toBe(true);
    expect(canOpenBeaconSafety(access({ owner: true }))).toBe(true);
  });

  it("reserves score policy, pardons, permanent bans, and purge for the immutable owner", () => {
    expect(canUseOwnerMutation(access({ moderator: {} as CommunityAccess["moderator"], canBan: true, canLockdown: true }))).toBe(false);
    expect(canUseOwnerMutation(access({ owner: true }))).toBe(true);
  });
});

function access(overrides: Partial<CommunityAccess> = {}): CommunityAccess {
  return {
    owner: false,
    canWarn: false,
    canDelete: false,
    canMute: false,
    canBan: false,
    canEditRules: false,
    canAddTriggers: false,
    canRemoveTriggers: false,
    canChangeTriggerSeverity: false,
    canManageTriggerGroups: false,
    canChangeAutomaticActions: false,
    canManageTrustedMembers: false,
    canLockdown: false,
    ...overrides
  };
}
