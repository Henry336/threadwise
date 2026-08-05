import {
  StudyItemStatus,
  StudyPriority,
  StudyReminderKind,
  StudyTrafficLight,
} from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("../config/env", () => ({
  privateStudyConfig: () => ({ ownerTelegramId: "111", allowedChatId: "-222" }),
}));
import {
  academicWeekNumber,
  deriveModuleBacklogStatus,
  deriveOverallStatus,
  isStudyScopeAuthorized,
  isTimedPracticeMissing,
  toCsv,
} from "./study";
import { buildStudyReminderDedupeKey, studyReminderGate } from "./studyReminders";

describe("private Study Mode rules", () => {
  const config = { ownerTelegramId: "111", allowedChatId: "-222" };

  it("requires the configured owner, exact numeric group, and group chat type", () => {
    expect(isStudyScopeAuthorized(config, "111", "-222", "group")).toBe(true);
    expect(isStudyScopeAuthorized(config, "111", "-222", "supergroup")).toBe(true);
    expect(isStudyScopeAuthorized(config, "999", "-222", "group")).toBe(false);
    expect(isStudyScopeAuthorized(config, "111", "-999", "group")).toBe(false);
    expect(isStudyScopeAuthorized(config, "111", "-222", "private")).toBe(false);
    expect(isStudyScopeAuthorized(undefined, "111", "-222", "group")).toBe(false);
  });
});

describe("Study Mode academic rules", () => {
  it("calculates academic weeks at Singapore-local boundaries", () => {
    const workspace = {
      semesterStartDate: new Date("2026-08-09T16:00:00.000Z"),
      timezone: "Asia/Singapore",
    };
    expect(academicWeekNumber(workspace, new Date("2026-08-09T15:59:59.000Z"))).toBe(0);
    expect(academicWeekNumber(workspace, new Date("2026-08-09T16:00:00.000Z"))).toBe(1);
    expect(academicWeekNumber(workspace, new Date("2026-08-16T16:00:00.000Z"))).toBe(2);
  });

  it("aggregates traffic lights without treating unassessed work as mastery", () => {
    expect(deriveOverallStatus([StudyTrafficLight.GREEN, StudyTrafficLight.AMBER])).toBe(StudyTrafficLight.AMBER);
    expect(deriveOverallStatus([StudyTrafficLight.GREEN, StudyTrafficLight.RED])).toBe(StudyTrafficLight.RED);
    expect(deriveOverallStatus([StudyTrafficLight.UNASSESSED])).toBe(StudyTrafficLight.UNASSESSED);
  });

  it("marks a module red when important work is overdue or more than one week behind", () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    const base = {
      status: StudyItemStatus.OPEN,
      priority: StudyPriority.NORMAL,
      dueAt: null,
      weekId: "week-1",
      week: { number: 1 },
      mastery: StudyTrafficLight.UNASSESSED,
    };
    expect(deriveModuleBacklogStatus({ currentMastery: StudyTrafficLight.GREEN }, [base], 3, now)).toBe(StudyTrafficLight.RED);
    expect(deriveModuleBacklogStatus({ currentMastery: StudyTrafficLight.GREEN }, [{
      ...base,
      week: { number: 3 },
      priority: StudyPriority.HIGH,
      dueAt: new Date("2026-08-24T10:00:00.000Z"),
    }], 3, now)).toBe(StudyTrafficLight.RED);
  });

  it("tracks timed practice only for the configured technical modules and start week", () => {
    expect(isTimedPracticeMissing("CS2100", 4, 4, [])).toBe(true);
    expect(isTimedPracticeMissing("CS2102", 4, 4, [{ timed: true }])).toBe(false);
    expect(isTimedPracticeMissing("CS2100", 3, 4, [])).toBe(false);
    expect(isTimedPracticeMissing("CS2103T", 6, 4, [])).toBe(false);
  });
});

describe("Study Mode reminders and exports", () => {
  const reminderWorkspace = {
    timezone: "Asia/Singapore",
    quietHoursStart: "01:30",
    quietHoursEnd: "09:00",
    maxRemindersPerDay: 4,
  };

  it("respects quiet hours and the daily cap", () => {
    expect(studyReminderGate(reminderWorkspace, new Date("2026-08-03T18:00:00.000Z"), 0)).toBe("quiet");
    expect(studyReminderGate(reminderWorkspace, new Date("2026-08-04T04:00:00.000Z"), 4)).toBe("capped");
    expect(studyReminderGate(reminderWorkspace, new Date("2026-08-04T04:00:00.000Z"), 3)).toBe("send");
  });

  it("builds the same daily dedupe key across repeated polling", () => {
    const scheduledFor = new Date("2026-08-04T10:00:00.000Z");
    const first = buildStudyReminderDedupeKey("workspace", StudyReminderKind.MISTAKE_REATTEMPT, "mistake", scheduledFor, "Asia/Singapore");
    const second = buildStudyReminderDedupeKey("workspace", StudyReminderKind.MISTAKE_REATTEMPT, "mistake", new Date(scheduledFor), "Asia/Singapore");
    expect(first).toBe(second);
    expect(first).toContain("2026-08-04");
  });

  it("escapes commas, quotes, and newlines for spreadsheet imports", () => {
    const csv = toCsv(["title", "notes"], [["SQL, joins", "He said \"retry\"\nthen fixed it"]]);
    expect(csv).toContain('"SQL, joins"');
    expect(csv).toContain('"He said ""retry""\nthen fixed it"');
    expect(csv.startsWith("\uFEFF")).toBe(true);
  });
});
