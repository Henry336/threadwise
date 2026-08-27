import { PlanningScope, TaskCaptureDraftItemStatus, TaskCaptureDraftStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  commitTaskCaptureDraft,
  createTaskCaptureDraft,
  getTaskCaptureDraft,
} from "./taskCaptureDrafts";

const scope = {
  ownerUserId: "user-1",
  principalTelegramId: "123456789",
  scope: PlanningScope.PERSONAL,
  timezone: "Asia/Singapore",
};

describe("task capture drafts", () => {
  it("persists a multi-task review as one durable owner-scoped draft", async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }));
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "draft-1", ...data, items: [] }));
    const database = {
      $transaction: vi.fn(async (work: (tx: unknown) => unknown) => work({ taskCaptureDraft: { updateMany, create } })),
    } as never;

    await createTaskCaptureDraft(
      scope,
      "Start CS2103T increment, Buy vegetables",
      { now: new Date("2026-08-31T02:00:00.000Z") },
      database,
    );

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ principalTelegramId: "123456789", scope: PlanningScope.PERSONAL }),
    }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        ownerUserId: "user-1",
        principalTelegramId: "123456789",
        status: TaskCaptureDraftStatus.REVIEWING,
        items: { create: expect.arrayContaining([
          expect.objectContaining({ title: expect.stringContaining("CS2103T"), plannedFor: new Date("2026-08-31T00:00:00.000Z") }),
          expect.objectContaining({ title: expect.stringContaining("vegetables"), plannedFor: new Date("2026-08-31T00:00:00.000Z") }),
        ]) },
      }),
    }));
  });

  it("always scopes draft reads to the signed Telegram principal", async () => {
    const findFirst = vi.fn(async () => ({
      id: "draft-1",
      principalTelegramId: "123456789",
      status: TaskCaptureDraftStatus.REVIEWING,
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      items: [],
    }));
    await getTaskCaptureDraft("draft-1", "123456789", { taskCaptureDraft: { findFirst } } as never);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "draft-1", principalTelegramId: "123456789" },
    }));
  });

  it("refuses an all-or-nothing commit while any included item needs review", async () => {
    const draft = {
      id: "draft-1",
      principalTelegramId: "123456789",
      status: TaskCaptureDraftStatus.REVIEWING,
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      items: [{
        id: "item-1",
        included: true,
        status: TaskCaptureDraftItemStatus.NEEDS_REVIEW,
        warnings: ["AMBIGUOUS_BARE_DATE"],
      }],
    };
    const transaction = vi.fn();
    const database = {
      taskCaptureDraft: { findFirst: vi.fn(async () => draft) },
      $transaction: transaction,
    } as never;

    await expect(commitTaskCaptureDraft("draft-1", "123456789", database))
      .rejects.toEqual(expect.objectContaining({ code: "conflict" }));
    expect(transaction).not.toHaveBeenCalled();
  });

  it("commits the approved batch atomically without creating implicit reminders", async () => {
    const draft = {
      id: "draft-1",
      ownerUserId: "user-1",
      principalTelegramId: "123456789",
      scope: PlanningScope.PERSONAL,
      groupWorkspaceId: null,
      studyWorkspaceId: null,
      timezone: "Asia/Singapore",
      status: TaskCaptureDraftStatus.REVIEWING,
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      items: [{
        id: "item-1",
        title: "Buy vegetables",
        sourceText: "Buy vegetables",
        plannedFor: new Date("2026-08-31T00:00:00.000Z"),
        dueAt: null,
        assignees: [],
        teamOwnerLabel: null,
        linkedTaskId: null,
        linkedStudyItemId: null,
        included: true,
        status: TaskCaptureDraftItemStatus.READY,
        warnings: [],
      }],
    };
    const createTask = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "task-1", title: data.title, ...data }));
    const tx = {
      taskCaptureDraft: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(async () => ({ ...draft, status: TaskCaptureDraftStatus.COMMITTED })),
      },
      userSettings: { findUnique: vi.fn(async () => ({ reminderIntervalMinutes: 180, dueNudgeMinutes: 30 })) },
      task: { findMany: vi.fn(async () => []), create: createTask },
      taskCaptureDraftItem: { update: vi.fn(async () => ({})) },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    const database = {
      taskCaptureDraft: { findFirst: vi.fn(async () => draft) },
      $transaction: vi.fn(async (work: (client: unknown) => unknown) => work(tx)),
    } as never;

    await commitTaskCaptureDraft("draft-1", "123456789", database);

    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        title: "Buy vegetables",
        plannedFor: new Date("2026-08-31T00:00:00.000Z"),
        dueAt: null,
        nextReminderAt: null,
      }),
    }));
    expect(tx.taskCaptureDraft.updateMany).toHaveBeenCalledOnce();
    expect(tx.taskCaptureDraft.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: TaskCaptureDraftStatus.COMMITTED }),
    }));
  });
});
