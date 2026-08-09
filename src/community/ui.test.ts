import type { CommunityGroup, CommunityReport } from "@prisma/client";
import type { InlineKeyboard } from "grammy";
import { describe, expect, it } from "vitest";
import type { CommunityAccess } from "./store";
import {
  beaconMoreKeyboard,
  beaconPolicyKeyboard,
  groupBeaconHomeKeyboard,
  privateBeaconHomeKeyboard,
  publicBeaconKeyboard,
  reportActionKeyboard,
  reportCardKeyboard,
  reportCardText,
  safetyKeyboard
} from "./ui";

describe("Beacon progressive-disclosure menus", () => {
  it("renders exactly two public member actions and no private control link", () => {
    const keyboard = publicBeaconKeyboard();
    expect(labels(keyboard)).toEqual(["Rules", "How to report"]);
    expect(dataValues(keyboard)).toEqual(["bc:rules", "bc:reporthelp"]);
  });

  it("adds a private deep link only when one is explicitly supplied", () => {
    expect(labels(groupBeaconHomeKeyboard())).toEqual(["Rules", "How to report"]);
    expect(labels(groupBeaconHomeKeyboard("https://t.me/beacon?start=manage_group")))
      .toEqual(["Rules", "How to report", "Private controls"]);
  });

  it("keeps the owner home to four destinations and surfaces the queue count", () => {
    expect(labels(privateBeaconHomeKeyboard(access({ owner: true }), 3))).toEqual([
      "Review queue · 3", "Members & offences", "Policy", "More"
    ]);
  });

  it("renders a moderator home from granted capabilities", () => {
    const withSubmission = privateBeaconHomeKeyboard(access({ moderator: moderator(), canAddTriggers: true }), 0);
    expect(labels(withSubmission)).toEqual(["Review queue", "Submit trigger", "Rules", "More"]);
    const withoutSubmission = privateBeaconHomeKeyboard(access({ moderator: moderator() }), 0);
    expect(labels(withoutSubmission)).toEqual(["Review queue", "Rules", "More"]);
    expect(labels(withoutSubmission)).not.toContain("Policy");
  });

  it("keeps owner policy configuration focused and nested", () => {
    expect(labels(beaconPolicyKeyboard(2))).toEqual([
      "Rules", "Trigger library", "Offence scoring", "Automatic actions",
      "Trigger submissions · 2", "‹ Home"
    ]);
  });

  it("hides inaccessible More and Safety actions at render time", () => {
    const limited = access({ moderator: moderator(), canWarn: true });
    expect(labels(beaconMoreKeyboard(limited))).toEqual(["Recent actions", "Rules", "Switch community", "‹ Home"]);
    expect(labels(safetyKeyboard(group(), limited))).toEqual(["‹ More"]);

    const lockdown = access({ moderator: moderator(), canLockdown: true });
    expect(labels(beaconMoreKeyboard(lockdown))).toContain("Safety");
    expect(labels(safetyKeyboard(group(), lockdown))).toEqual([
      "Pause new members", "Emergency lockdown", "‹ More"
    ]);
  });
});

describe("Beacon report-card disclosure", () => {
  it("keeps the initial report card to three immediate actions", () => {
    const keyboard = reportCardKeyboard(report());
    expect(labels(keyboard)).toEqual(["Dismiss", "Take action", "Offence history"]);
    expect(keyboard.inline_keyboard).toHaveLength(2);
    expect(Math.max(...keyboard.inline_keyboard.map((row) => row.length))).toBeLessThanOrEqual(2);
  });

  it("reveals only authorized actions and provides one Back destination", () => {
    const limited = reportActionKeyboard(report(), access({ moderator: moderator(), canWarn: true, canMute: true }));
    expect(labels(limited)).toEqual(["Warn", "Temporary mute", "Propose offence score", "‹ Report"]);
    expect(labels(limited)).not.toContain("Delete");
    expect(labels(limited)).not.toContain("Permanent ban");

    const owner = reportActionKeyboard(report(), access({ owner: true, canWarn: true, canDelete: true, canMute: true, canBan: true }));
    expect(labels(owner)).toEqual([
      "Warn", "Delete", "Temporary mute", "Propose offence score", "Permanent ban", "‹ Report"
    ]);
  });

  it("preserves bounded evidence and the operational report context", () => {
    const text = reportCardText(report({ evidenceText: "x".repeat(2_000) }), 7);
    expect(text).toContain("2 reports");
    expect(text).toContain("User ID: <code>12345</code>");
    expect(text).toContain("Active offence score: <b>7</b>");
    expect(text).toContain("Topic: Admissions");
    expect(text.length).toBeLessThan(1_800);
  });
});

function labels(keyboard: InlineKeyboard): string[] {
  return keyboard.inline_keyboard.flatMap((row) => row.map((button) => "text" in button ? button.text : ""));
}

function dataValues(keyboard: InlineKeyboard): string[] {
  return keyboard.inline_keyboard.flatMap((row) => row.map((button) => "callback_data" in button ? button.callback_data : ""));
}

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

function moderator(): NonNullable<CommunityAccess["moderator"]> {
  return {} as NonNullable<CommunityAccess["moderator"]>;
}

function group(): CommunityGroup {
  return {
    id: "group-1",
    observeMode: true,
    lockdownMode: false,
    pauseNewMemberPosting: false,
    newMemberPauseHours: 24,
    floodMessageLimit: 6,
    floodWindowSeconds: 10,
    duplicateMessageLimit: 3,
    duplicateWindowSeconds: 30,
    massMentionLimit: 5
  } as unknown as CommunityGroup;
}

function report(overrides: Partial<CommunityReport> = {}): CommunityReport {
  return {
    id: "report-1",
    groupId: "group-1",
    sourceChatId: "-100123456",
    sourceMessageId: 42,
    sourceMessageThreadId: 7,
    sourceTopicName: "Admissions",
    reporterTelegramId: "999",
    reportedTelegramId: "12345",
    reportedUsername: "member",
    reportedDisplayName: "Member",
    evidenceText: "Flagged evidence",
    reason: "Member report",
    reportCount: 2
  } as unknown as CommunityReport;
}
