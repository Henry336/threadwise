import { PlanningScope, TaskCaptureDraftItemStatus, TaskCaptureDraftStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  commitTaskCaptureDraft,
  createTaskCaptureDraft,
  expireTaskCaptureDrafts,
  findActiveTaskCaptureDraft,
  getTaskCaptureDraft,
} from "./taskCaptureDrafts";

const scope = {
  ownerUserId: "user-1",
  principalTelegramId: "123456789",
  scope: PlanningScope.PERSONAL,
  timezone: "Asia/Singapore",
};

describe("task capture drafts", () => {
  it("claims expired owner drafts once before their Telegram cards are replaced", async () => {
    const findMany = vi.fn(async () => [{ id: "draft-expired", telegramChatId: "123", telegramReviewMessageId: 77 }]);
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const expired = await expireTaskCaptureDrafts("123456789", new Date("2026-08-31T02:00:00.000Z"), {
      taskCaptureDraft: { findMany, updateMany },
    } as never);
    expect(expired).toEqual([{ id: "draft-expired", telegramChatId: "123", telegramReviewMessageId: 77 }]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      principalTelegramId: "123456789",
      status: { in: [TaskCaptureDraftStatus.COLLECTING, TaskCaptureDraftStatus.REVIEWING] },
    }) }));
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: TaskCaptureDraftStatus.EXPIRED } }));
  });

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

  it("resumes Add more from durable state after a process restart", async () => {
    const persisted = {
      id: "draft-persisted",
      principalTelegramId: "123456789",
      scope: PlanningScope.PERSONAL,
      status: TaskCaptureDraftStatus.COLLECTING,
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-31T02:00:00.000Z"),
      items: [{ id: "item-1", position: 1 }],
    };
    const findFirst = vi.fn(async () => persisted);
    const resumed = await findActiveTaskCaptureDraft(scope, { taskCaptureDraft: { findFirst } } as never);
    expect(resumed).toEqual(persisted);
    expect(findFirst).toHaveBeenCalledTimes(2);
    expect(findFirst).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ principalTelegramId: "123456789", scope: PlanningScope.PERSONAL }),
      orderBy: { updatedAt: "desc" },
    }));
  });

  it("requires a module before a new Study draft can be committed", async () => {
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "draft-study", ...data, items: [] }));
    const database = {
      $transaction: vi.fn(async (work: (tx: unknown) => unknown) => work({ taskCaptureDraft: { updateMany: vi.fn(), create } })),
    } as never;
    await createTaskCaptureDraft({
      ownerUserId: "user-1",
      principalTelegramId: "123456789",
      scope: PlanningScope.STUDY,
      timezone: "Asia/Singapore",
      studyWorkspaceId: "study-1",
    }, "Prepare tutorial tomorrow", {}, database);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        items: { create: [expect.objectContaining({
          warnings: ["STUDY_MODULE_REQUIRED"],
          status: TaskCaptureDraftItemStatus.NEEDS_REVIEW,
        })] },
      }),
    }));
  });

  it("links an exact Canvas match during Study capture and keeps the provider deadline", async () => {
    const canvasDeadline = new Date("2026-10-13T15:59:00.000Z");
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "draft-study", ...data, items: [] }));
    const findMany = vi.fn(async () => [{
      id: "study-item-1",
      moduleId: "module-1",
      title: "Combinational Circuits Quiz 1/2",
      dueAt: canvasDeadline,
    }]);
    const database = {
      $transaction: vi.fn(async (work: (tx: unknown) => unknown) => work({
        taskCaptureDraft: { updateMany: vi.fn(), create },
        studyItem: { findMany },
      })),
    } as never;

    await createTaskCaptureDraft({
      ownerUserId: "user-1",
      principalTelegramId: "123456789",
      scope: PlanningScope.STUDY,
      timezone: "Asia/Singapore",
      studyWorkspaceId: "study-1",
    }, "Combinational Circuits Quiz 1/2", {
      moduleId: "module-1",
      now: new Date("2026-08-31T02:00:00.000Z"),
    }, database);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ workspaceId: "study-1", moduleId: { in: ["module-1"] }, source: "CANVAS" }),
    }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ items: { create: [expect.objectContaining({
        linkedStudyItemId: "study-item-1",
        dueAt: canvasDeadline,
      })] } }),
    }));
  });

  it("refuses an all-or-nothing commit while any included item needs review", async () => {
    const draft = {
      id: "draft-1",
      principalTelegramId: "123456789",
      status: TaskCaptureDraftStatus.REVIEWING,
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      items: [
        { id: "item-1", included: true, status: TaskCaptureDraftItemStatus.READY, warnings: [] },
        { id: "item-2", included: true, status: TaskCaptureDraftItemStatus.NEEDS_REVIEW, warnings: ["AMBIGUOUS_BARE_DATE"] },
      ],
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

  it("rejects a replayed save callback after the draft is already committed", async () => {
    const draft = {
      id: "draft-1",
      principalTelegramId: "123456789",
      status: TaskCaptureDraftStatus.COMMITTED,
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      items: [],
    };
    const transaction = vi.fn();
    await expect(commitTaskCaptureDraft("draft-1", "123456789", {
      taskCaptureDraft: { findFirst: vi.fn(async () => draft) },
      $transaction: transaction,
    } as never)).rejects.toEqual(expect.objectContaining({ code: "conflict" }));
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
        sourceText: "Buy vegetables\nReason: prepare dinner",
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
        description: "Reason: prepare dinner",
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

  it("plans a matching Canvas-backed Study item without duplicating it or changing its deadline", async () => {
    const canvasDeadline = new Date("2026-10-13T15:59:00.000Z");
    const draft = {
      id: "draft-study",
      ownerUserId: "user-1",
      principalTelegramId: "123456789",
      scope: PlanningScope.STUDY,
      groupWorkspaceId: null,
      studyWorkspaceId: "study-1",
      timezone: "Asia/Singapore",
      status: TaskCaptureDraftStatus.REVIEWING,
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      items: [{
        id: "item-1",
        title: "Canvas quiz",
        sourceText: "Canvas quiz",
        plannedFor: new Date("2026-08-31T00:00:00.000Z"),
        dueAt: canvasDeadline,
        moduleId: "module-1",
        studyItemType: null,
        assignees: [],
        teamOwnerLabel: null,
        linkedTaskId: null,
        linkedStudyItemId: "study-item-1",
        included: true,
        status: TaskCaptureDraftItemStatus.READY,
        warnings: [],
      }],
    };
    const existing = {
      id: "study-item-1",
      publicId: "STUDY-1",
      workspaceId: "study-1",
      dueAt: canvasDeadline,
      firstPlannedFor: null,
    };
    const studyUpdate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...existing, ...data }));
    const studyCreate = vi.fn();
    const tx = {
      taskCaptureDraft: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(async () => ({ ...draft, status: TaskCaptureDraftStatus.COMMITTED })),
      },
      studyWorkspace: { findFirst: vi.fn(async () => ({ id: "study-1", ownerUserId: "user-1", active: true })) },
      studyItem: {
        findMany: vi.fn(async () => [{ publicId: "STUDY-1" }]),
        findFirst: vi.fn(async () => existing),
        update: studyUpdate,
        create: studyCreate,
      },
      taskCaptureDraftItem: { update: vi.fn(async () => ({})) },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    const database = {
      taskCaptureDraft: { findFirst: vi.fn(async () => draft) },
      $transaction: vi.fn(async (work: (client: unknown) => unknown) => work(tx)),
    } as never;

    await commitTaskCaptureDraft("draft-study", "123456789", database);

    expect(studyCreate).not.toHaveBeenCalled();
    expect(studyUpdate).toHaveBeenCalledWith({
      where: { id: "study-item-1" },
      data: {
        plannedFor: new Date("2026-08-31T00:00:00.000Z"),
        firstPlannedFor: new Date("2026-08-31T00:00:00.000Z"),
      },
    });
    expect(existing.dueAt).toEqual(canvasDeadline);
  });
});
