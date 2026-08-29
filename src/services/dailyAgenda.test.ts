import { DailyBriefKind, PlanningScope, Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { claimDailyBriefDelivery, countDailyAgendaCompletions, getDailyAgenda, groupAgendaEntries, planDailyAgendaEntry, reorderPersonalDailyAgenda, type AgendaEntry } from "./dailyAgenda";

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

  it("uses the real 25-hour UTC window for a DST fall-back day", async () => {
    const taskCount = vi.fn(async () => 0);
    const database = {
      user: { findUnique: vi.fn(async () => ({ id: "user-1" })) },
      groupMembership: { findMany: vi.fn(async () => []) },
      studyWorkspace: { findFirst: vi.fn(async () => null) },
      task: { count: taskCount },
      studyItem: { count: vi.fn() },
    } as never;
    await expect(countDailyAgendaCompletions("123", "America/New_York", "2026-11-01", database)).resolves.toBe(0);
    expect(taskCount).toHaveBeenCalledWith({ where: { userId: "user-1", completedAt: {
      gte: new Date("2026-11-01T04:00:00.000Z"),
      lt: new Date("2026-11-02T05:00:00.000Z"),
    } } });
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
      dailyAgendaOrderState: { findUnique: vi.fn(async () => null) },
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

  it("treats a duplicate daily delivery claim as an idempotent replay", async () => {
    const existing = { id: "delivery-1", status: "SENT" };
    const create = vi.fn(async () => {
      throw new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" });
    });
    const findUniqueOrThrow = vi.fn(async () => existing);
    const input = {
      userId: "user-1",
      recipientTelegramId: "123",
      localDate: new Date("2026-08-30T16:00:00.000Z"),
      kind: DailyBriefKind.MORNING,
      scope: PlanningScope.PERSONAL,
      scopeKey: "private-cross-mode",
    };
    await expect(claimDailyBriefDelivery(input, {
      dailyBriefDelivery: { create, findUniqueOrThrow },
    } as never)).resolves.toEqual({ claimed: false, delivery: existing });
    expect(findUniqueOrThrow).toHaveBeenCalledWith({
      where: { recipientTelegramId_localDate_kind_scopeKey: {
        recipientTelegramId: "123",
        localDate: input.localDate,
        kind: DailyBriefKind.MORNING,
        scopeKey: "private-cross-mode",
      } },
      select: { id: true, status: true },
    });
  });

  it("cannot plan an item that is outside the authorized agenda scope", async () => {
    const transaction = vi.fn();
    const database = {
      user: { findUnique: vi.fn(async () => ({ id: "user-1", settings: { timezone: "Asia/Singapore" } })) },
      groupMembership: { findMany: vi.fn(async () => []) },
      task: { findMany: vi.fn(async () => []) },
      studyWorkspace: { findFirst: vi.fn(async () => null) },
      dailyAgendaOrderState: { findUnique: vi.fn(async () => null) },
      $transaction: transaction,
    } as never;
    await expect(planDailyAgendaEntry(
      { principalTelegramId: "123", scope: PlanningScope.PERSONAL },
      "task-from-another-workspace",
      "2026-08-31",
      database,
    )).rejects.toEqual(expect.objectContaining({ code: "not_found" }));
    expect(transaction).not.toHaveBeenCalled();
  });

  it("persists a private Personal Today order without changing task records", async () => {
    let state: { id: string; revision: number; items: Array<{ entryId: string; rank: number }> } | null = null;
    const tasks = [
      { id: "task-a", publicId: "TASK-1", title: "Alpha", userId: "user-1", plannedFor: new Date("2026-08-31T00:00:00.000Z"), firstPlannedFor: null, dueAt: null, status: "OPEN", archivedAt: null },
      { id: "task-b", publicId: "TASK-2", title: "Beta", userId: "user-1", plannedFor: new Date("2026-08-31T00:00:00.000Z"), firstPlannedFor: null, dueAt: null, status: "OPEN", archivedAt: null },
    ];
    const database: any = {
      user: { findUnique: vi.fn(async () => ({ id: "user-1", settings: { timezone: "Asia/Singapore" } })) },
      groupMembership: { findMany: vi.fn(async () => []) },
      task: { findMany: vi.fn(async () => tasks) },
      studyWorkspace: { findFirst: vi.fn(async () => null) },
      dailyAgendaOrderState: {
        findUnique: vi.fn(async () => state ? { ...state, items: [...state.items] } : null),
        deleteMany: vi.fn(async () => ({ count: 0 })),
        upsert: vi.fn(async () => {
          state ??= { id: "order-1", revision: 0, items: [] };
          return { ...state, items: [...state.items] };
        }),
        updateMany: vi.fn(async ({ where }: any) => {
          if (!state || state.revision !== where.revision) return { count: 0 };
          state.revision += 1;
          return { count: 1 };
        }),
      },
      dailyAgendaOrderItem: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
        upsert: vi.fn(async ({ where, update, create }: any) => {
          const entryId = where.stateId_entryId.entryId;
          const existing = state!.items.find((item) => item.entryId === entryId);
          if (existing) existing.rank = update.rank;
          else state!.items.push({ entryId, rank: create.rank });
          return {};
        }),
      },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    database.$transaction = vi.fn(async (callback: any) => callback(database));

    const scope = { principalTelegramId: "123", scope: PlanningScope.PERSONAL };
    const reordered = await reorderPersonalDailyAgenda(scope, {
      localDate: "2026-08-31",
      orderedEntryIds: ["task-b", "task-a"],
      movedEntryId: "task-b",
      expectedRevision: 0,
    }, database);

    expect(reordered.today.map((item) => item.id)).toEqual(["task-b", "task-a"]);
    expect(reordered.orderRevision).toBe(1);
    expect(reordered.reorderable).toBe(true);
    expect(database.task.findMany).toHaveBeenCalled();
    expect(database.task.update).toBeUndefined();
    await expect(getDailyAgenda(scope, { localDate: "2026-08-31" }, database)).resolves.toMatchObject({ orderRevision: 1 });
  });

  it("rejects Personal Today reorder requests with a stale revision", async () => {
    const database = {
      user: { findUnique: vi.fn(async () => ({ id: "user-1", settings: { timezone: "Asia/Singapore" } })) },
      groupMembership: { findMany: vi.fn(async () => []) },
      task: { findMany: vi.fn(async () => [{ id: "task-a", publicId: "TASK-1", title: "Alpha", userId: "user-1", plannedFor: new Date("2026-08-31T00:00:00.000Z"), firstPlannedFor: null, dueAt: null, status: "OPEN", archivedAt: null }]) },
      studyWorkspace: { findFirst: vi.fn(async () => null) },
      dailyAgendaOrderState: { findUnique: vi.fn(async () => ({ id: "order-1", revision: 2, items: [] })) },
      $transaction: vi.fn(),
    } as never;

    await expect(reorderPersonalDailyAgenda(
      { principalTelegramId: "123", scope: PlanningScope.PERSONAL },
      { localDate: "2026-08-31", orderedEntryIds: ["task-a"], movedEntryId: "task-a", expectedRevision: 1 },
      database,
    )).rejects.toEqual(expect.objectContaining({ code: "conflict" }));
    expect((database as any).$transaction).not.toHaveBeenCalled();
  });

  it("keeps manual Today ordering unavailable in Group and Study scopes", async () => {
    await expect(reorderPersonalDailyAgenda(
      { principalTelegramId: "123", scope: PlanningScope.GROUP, groupWorkspaceId: "group-1" },
      { localDate: "2026-08-31", orderedEntryIds: ["task-a"], movedEntryId: "task-a", expectedRevision: 0 },
      {} as never,
    )).rejects.toEqual(expect.objectContaining({ code: "forbidden" }));
  });
});
