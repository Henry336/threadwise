import { PlanningScope } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { countDailyAgendaCompletions, groupAgendaEntries, planDailyAgendaEntry, type AgendaEntry } from "./dailyAgenda";

const entry = (overrides: Partial<AgendaEntry> & Pick<AgendaEntry, "id" | "title">): AgendaEntry => ({
  publicId: `TASK-${overrides.id}`,
  mode: "INDIVIDUAL",
  status: "OPEN",
  ...overrides,
});

describe("daily agenda grouping", () => {
  it("counts completed Personal, assigned Group, and Study work in the user's local day", async () => {
    const taskCount = vi.fn()
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    const studyCount = vi.fn(async () => 3);
    const database = {
      user: { findUnique: vi.fn(async () => ({ id: "user-1" })) },
      groupMembership: { findMany: vi.fn(async () => [{ workspace: { ownerUserId: "group-owner" } }]) },
      studyWorkspace: { findFirst: vi.fn(async () => ({ id: "study-1" })) },
      task: { count: taskCount },
      studyItem: { count: studyCount },
    } as never;
    await expect(countDailyAgendaCompletions("123", "Asia/Singapore", "2026-08-31", database)).resolves.toBe(6);
    expect(taskCount).toHaveBeenNthCalledWith(1, { where: { userId: "user-1", completedAt: {
      gte: new Date("2026-08-30T16:00:00.000Z"),
      lt: new Date("2026-08-31T16:00:00.000Z"),
    } } });
    expect(studyCount).toHaveBeenCalledWith({ where: expect.objectContaining({ workspaceId: "study-1" }) });
  });

  it("derives Today and carryover without duplicating or moving tasks", () => {
    const agenda = groupAgendaEntries([
      entry({ id: "1", title: "Today", plannedFor: "2026-08-31" }),
      entry({ id: "2", title: "Old", plannedFor: "2026-08-29", firstPlannedFor: "2026-08-29" }),
      entry({ id: "3", title: "Later", plannedFor: "2026-09-01" }),
      entry({ id: "4", title: "Someday" }),
    ], PlanningScope.PERSONAL, "Asia/Singapore", "2026-08-31", 3);

    expect(agenda.today.map((item) => item.id)).toEqual(["1"]);
    expect(agenda.carryover.map((item) => item.id)).toEqual(["2"]);
    expect(agenda.carryover[0]?.firstPlannedFor).toBe("2026-08-29");
    expect(agenda.unscheduledCount).toBe(1);
  });

  it("keeps overdue separate from the bounded deadline watch", () => {
    const agenda = groupAgendaEntries([
      entry({ id: "1", title: "Overdue", dueAt: "2026-08-30T12:00:00.000Z" }),
      entry({ id: "2", title: "Soon", dueAt: "2026-09-02T10:00:00.000Z" }),
      entry({ id: "3", title: "Later", dueAt: "2026-09-10T10:00:00.000Z" }),
    ], PlanningScope.PERSONAL, "Asia/Singapore", "2026-08-31", 3);

    expect(agenda.overdue.map((item) => item.id)).toEqual(["1"]);
    expect(agenda.dueSoon.map((item) => item.id)).toEqual(["2"]);
  });

  it("replans one visible carryover item without changing its deadline or first plan", async () => {
    const task = {
      id: "1", userId: "user-1", publicId: "TASK-1", title: "Carry me", plannedFor: new Date("2026-08-29T00:00:00.000Z"),
      firstPlannedFor: new Date("2026-08-29T00:00:00.000Z"), dueAt: new Date("2026-09-04T10:00:00.000Z"), status: "OPEN",
    };
    const update = vi.fn(async () => task);
    const audit = vi.fn(async () => ({}));
    const database = {
      user: { findUnique: vi.fn(async () => ({ id: "user-1", settings: { timezone: "Asia/Singapore" } })) },
      groupMembership: { findMany: vi.fn(async () => []) },
      task: { findMany: vi.fn(async () => [task]), findFirst: vi.fn(async () => task), update },
      studyWorkspace: { findFirst: vi.fn(async () => null) },
      auditLog: { create: audit },
      $transaction: vi.fn(async (callback) => callback(database)),
    } as never;
    const planned = await planDailyAgendaEntry({ principalTelegramId: "123", scope: PlanningScope.PERSONAL }, "1", "2026-08-31", database);
    expect(planned.plannedFor).toBe("2026-08-31");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: {
      plannedFor: new Date("2026-08-31T00:00:00.000Z"),
      firstPlannedFor: new Date("2026-08-29T00:00:00.000Z"),
    } }));
    expect(audit).toHaveBeenCalledWith({ data: expect.objectContaining({
      userId: "user-1",
      action: "task.plan.updated",
      metadata: expect.objectContaining({ source: "today", previousPlannedFor: "2026-08-29T00:00:00.000Z" }),
    }) });
  });
});
