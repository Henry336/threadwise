import {
  StudyItemStatus,
  StudyItemType,
  StudyMistakeStatus,
  StudyPriority,
  StudyTrafficLight,
  type StudyWorkspace,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const client: Record<string, any> = {
    user: { upsert: vi.fn() },
    studyWorkspace: { upsert: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    studyModule: { upsert: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    studyWeek: { upsert: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    studyItem: { count: vi.fn(), create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    studySession: { findMany: vi.fn(), findFirst: vi.fn() },
    studyMistake: { updateMany: vi.fn(), findMany: vi.fn() },
    studyScheduleBlock: { findMany: vi.fn() },
    studyConversation: { deleteMany: vi.fn() },
    weeklyReview: { upsert: vi.fn(), findMany: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  client.$transaction = vi.fn(async (operation: unknown) => (
    typeof operation === "function"
      ? (operation as (tx: typeof client) => unknown)(client)
      : Promise.all(operation as Promise<unknown>[])
  ));
  return client;
});

vi.mock("../db/prisma", () => ({ prisma: db }));
vi.mock("../config/env", () => ({
  privateStudyConfig: () => ({ ownerTelegramId: "111", allowedChatId: "-222" }),
}));

import {
  bindStudyWorkspace,
  buildStudyDashboard,
  completeStudyItem,
  createStudyItem,
  findStudyItem,
  listStudyMistakes,
  saveWeeklyReview,
  unbindStudyWorkspace,
  updateStudyMastery,
} from "./study";

const now = new Date("2026-08-10T00:00:00.000Z");
const workspace: StudyWorkspace = {
  id: "workspace-1",
  ownerUserId: "user-1",
  ownerTelegramId: "111",
  boundChatId: "-222",
  semesterName: "AY2026/27 Semester 1",
  semesterStartDate: new Date("2026-08-09T16:00:00.000Z"),
  timezone: "Asia/Singapore",
  active: true,
  weeklyReviewDay: 7,
  weeklyReviewTime: "19:00",
  weeklyPreviewDay: 7,
  weeklyPreviewTime: "19:00",
  canvasSyncEnabled: false,
  activeModuleId: null,
  activeOriginId: null,
  activeOriginUntil: null,
  quietHoursStart: "01:30",
  quietHoursEnd: "09:00",
  maxRemindersPerDay: 4,
  timedPracticeStartWeek: 4,
  studyBlockRemindersEnabled: false,
  createdAt: now,
  updatedAt: now,
};

const module = {
  id: "module-1",
  workspaceId: workspace.id,
  code: "CS2100",
  name: "Computer Organisation",
  active: true,
  displayOrder: 0,
  color: null,
  workloadGroup: null,
  currentMastery: StudyTrafficLight.UNASSESSED,
  masteryReason: null,
  redSince: null,
  lastRedWarningAt: null,
  createdAt: now,
  updatedAt: now,
};

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (operation: unknown) => (
    typeof operation === "function"
      ? (operation as (tx: typeof db) => unknown)(db)
      : Promise.all(operation as Promise<unknown>[])
  ));
  db.auditLog.create.mockResolvedValue({});
  db.studyConversation.deleteMany.mockResolvedValue({ count: 0 });
});

describe("Study Mode persistence boundaries", () => {
  it("binds only the configured owner and exact chat, then seeds the known modules", async () => {
    db.user.upsert.mockResolvedValue({ id: workspace.ownerUserId });
    db.studyWorkspace.upsert.mockResolvedValue(workspace);
    db.studyModule.upsert.mockResolvedValue(module);

    const result = await bindStudyWorkspace({
      from: { id: 111, is_bot: false, first_name: "Henry" },
      chat: { id: -222, type: "group", title: "Study" },
    } as never);

    expect(result).toEqual(workspace);
    expect(db.user.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { telegramId: "111" } }));
    expect(db.studyWorkspace.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { ownerTelegramId: "111" },
      update: expect.objectContaining({ boundChatId: "-222", active: true }),
    }));
    expect(db.studyModule.upsert).toHaveBeenCalledTimes(6);
  });

  it("unbinds while retaining academic records", async () => {
    db.studyWorkspace.findUnique.mockResolvedValue(workspace);
    db.studyWorkspace.update.mockResolvedValue({ ...workspace, active: false, boundChatId: null });

    await unbindStudyWorkspace(workspace.id);

    expect(db.studyConversation.deleteMany).toHaveBeenCalledWith({ where: { workspaceId: workspace.id } });
    expect(db.studyWorkspace.update).toHaveBeenCalledWith({
      where: { id: workspace.id },
      data: { active: false, boundChatId: null },
    });
  });

  it("scopes item lookup to its workspace", async () => {
    db.studyItem.findFirst.mockResolvedValue({ id: "item-1", publicId: "STUDY-1", module, week: null });
    await findStudyItem(workspace.id, "STUDY-1");
    expect(db.studyItem.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ workspaceId: workspace.id }),
    }));
  });
});

describe("Study Mode item and mastery lifecycle", () => {
  it("creates and completes a study item without silently changing mastery", async () => {
    db.studyModule.findFirst.mockResolvedValue(module);
    db.studyItem.findMany.mockResolvedValue([]);
    const created = {
      id: "item-1",
      workspaceId: workspace.id,
      moduleId: module.id,
      weekId: null,
      publicId: "STUDY-1",
      type: StudyItemType.REVISION,
      title: "Trace a MIPS example",
      notes: null,
      status: StudyItemStatus.OPEN,
      priority: StudyPriority.HIGH,
      dueAt: null,
      plannedMinutes: 45,
      actualMinutes: 0,
      mastery: StudyTrafficLight.UNASSESSED,
      masteryReason: null,
      processedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      module,
    };
    db.studyItem.create.mockResolvedValue(created);
    db.studyItem.findFirst.mockResolvedValue({ ...created, week: null });
    db.studyItem.update.mockResolvedValue({ ...created, status: StudyItemStatus.DONE, completedAt: now });

    const item = await createStudyItem(workspace, {
      moduleId: module.id,
      type: StudyItemType.REVISION,
      title: created.title,
      priority: StudyPriority.HIGH,
      plannedMinutes: 45,
      weekNumber: 0,
    });
    const completed = await completeStudyItem(workspace, item.publicId);

    expect(item.publicId).toBe("STUDY-1");
    expect(completed.status).toBe(StudyItemStatus.DONE);
    expect(db.studyItem.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ mastery: expect.anything() }),
    }));
  });

  it("persists explicit mastery transitions with their reason", async () => {
    db.studyModule.findFirst.mockResolvedValue(module);
    db.studyModule.update.mockResolvedValue({ ...module, currentMastery: StudyTrafficLight.RED, masteryReason: "MIPS tracing unclear" });

    await updateStudyMastery(workspace, "CS2100", StudyTrafficLight.RED, "MIPS tracing unclear");

    expect(db.studyModule.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: module.id },
      data: expect.objectContaining({ currentMastery: StudyTrafficLight.RED, masteryReason: "MIPS tracing unclear" }),
    }));
  });
});

describe("Study Mode dashboard aggregation", () => {
  it("keeps current-week planned time while counting only open backlog", async () => {
    const dashboardNow = new Date("2026-08-17T00:00:00.000Z");
    const currentWeek = {
      id: "week-2",
      workspaceId: workspace.id,
      number: 2,
      startDate: new Date("2026-08-16T16:00:00.000Z"),
      endDate: new Date("2026-08-23T15:59:59.999Z"),
      overallStatus: StudyTrafficLight.UNASSESSED,
      reviewCompleted: false,
      topPriorities: ["Finish MIPS tracing"],
      reflection: null,
      overloadNotes: null,
      createdAt: dashboardNow,
      updatedAt: dashboardNow,
    };
    const oldWeek = { ...currentWeek, id: "week-1", number: 1 };
    const openBacklog = {
      id: "item-open",
      workspaceId: workspace.id,
      moduleId: module.id,
      weekId: oldWeek.id,
      publicId: "STUDY-1",
      type: StudyItemType.TUTORIAL,
      title: "Revisit control signals",
      status: StudyItemStatus.OPEN,
      priority: StudyPriority.HIGH,
      dueAt: new Date("2026-08-16T12:00:00.000Z"),
      plannedMinutes: 30,
      mastery: StudyTrafficLight.AMBER,
      week: oldWeek,
    };
    const completedPlan = {
      ...openBacklog,
      id: "item-done",
      publicId: "STUDY-2",
      weekId: currentWeek.id,
      title: "Process lecture",
      status: StudyItemStatus.DONE,
      dueAt: null,
      plannedMinutes: 90,
      week: currentWeek,
    };
    const dueMistake = {
      id: "mistake-1",
      workspaceId: workspace.id,
      moduleId: module.id,
      status: StudyMistakeStatus.REATTEMPT_DUE,
      revisitAt: dashboardNow,
      module,
    };

    db.studyWeek.upsert.mockResolvedValue(currentWeek);
    db.studyModule.findMany.mockResolvedValue([module]);
    db.studyItem.findMany.mockResolvedValue([openBacklog, completedPlan]);
    db.studySession.findMany.mockResolvedValue([{ moduleId: module.id, durationMinutes: 45, timed: false }]);
    db.studySession.findFirst.mockResolvedValue({
      id: "session-open",
      method: "Timed tracing",
      startedAt: dashboardNow,
      module: { code: "CS2100" },
      item: { id: openBacklog.id, publicId: openBacklog.publicId, title: openBacklog.title },
    });
    db.studyMistake.updateMany.mockResolvedValue({ count: 0 });
    db.studyMistake.findMany.mockResolvedValue([dueMistake]);
    db.studyScheduleBlock.findMany.mockResolvedValue([]);
    db.weeklyReview.findMany.mockResolvedValue([]);

    const dashboard = await buildStudyDashboard(workspace, dashboardNow);

    expect(dashboard.weekNumber).toBe(2);
    expect(dashboard.topPriorities).toEqual(["Finish MIPS tracing"]);
    expect(dashboard.modules[0]).toMatchObject({
      code: "CS2100",
      status: StudyTrafficLight.RED,
      open: 1,
      overdue: 1,
      unprocessed: 1,
      plannedMinutes: 90,
      actualMinutes: 45,
      mistakesDue: 1,
    });
    expect(dashboard.openSession).toEqual({
      id: "session-open",
      moduleCode: "CS2100",
      method: "Timed tracing",
      startedAt: dashboardNow,
      item: { id: "item-open", publicId: "STUDY-1", title: "Revisit control signals" },
    });
  });
});

describe("Study Mode reviews and mistakes", () => {
  it("promotes due mistakes into the reattempt queue", async () => {
    db.studyMistake.updateMany.mockResolvedValue({ count: 1 });
    db.studyMistake.findMany.mockResolvedValue([{ id: "mistake-1", status: StudyMistakeStatus.REATTEMPT_DUE }]);

    const rows = await listStudyMistakes(workspace.id, now);

    expect(rows).toHaveLength(1);
    expect(db.studyMistake.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: workspace.id, status: StudyMistakeStatus.OPEN, revisitAt: { lte: now } },
      data: { status: StudyMistakeStatus.REATTEMPT_DUE },
    });
  });

  it("saves a structured weekly review and marks the week complete", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const week = {
      id: "week-1",
      workspaceId: workspace.id,
      number: 1,
      startDate: new Date("2026-08-09T16:00:00.000Z"),
      endDate: new Date("2026-08-16T15:59:59.999Z"),
      overallStatus: StudyTrafficLight.UNASSESSED,
      reviewCompleted: false,
      topPriorities: [],
      reflection: null,
      overloadNotes: null,
      createdAt: now,
      updatedAt: now,
    };
    db.studyWeek.upsert.mockResolvedValue(week);
    db.studyModule.findMany.mockResolvedValue([module]);
    db.studyModule.update.mockResolvedValue({ ...module, currentMastery: StudyTrafficLight.AMBER });
    db.weeklyReview.upsert.mockResolvedValue({ id: "review-1", weekId: week.id, summary: "Review saved" });
    db.studyWeek.update.mockResolvedValue({ ...week, reviewCompleted: true, overallStatus: StudyTrafficLight.AMBER });

    try {
      const review = await saveWeeklyReview(workspace, {
        moduleStatuses: [{ moduleId: module.id, code: module.code, status: StudyTrafficLight.AMBER, unclear: "Control signals" }],
        wins: ["Kept current"],
        unresolvedTopics: ["Control signals"],
        nextWeekPriorities: ["Trace datapath questions"],
        lostTimeCauses: ["Context switching"],
        workloadCompatible: true,
        protectedOverflowBlock: "Thursday evening",
      });

      expect(review.id).toBe("review-1");
      expect(db.weeklyReview.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { weekId: week.id } }));
      expect(db.studyWeek.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: week.id },
        data: expect.objectContaining({ reviewCompleted: true, overallStatus: StudyTrafficLight.AMBER }),
      }));
    } finally {
      vi.useRealTimers();
    }
  });
});
