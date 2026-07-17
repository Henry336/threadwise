import { RecurrenceRule, TaskStatus, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  DashboardUnsupportedMediaError,
  archiveDashboardTask,
  createDashboardTask,
  deleteDashboardAccount,
  disconnectDashboardIntegration,
  exportDashboardData,
  loadDashboardImageContent,
  syncDashboardExcelExpenses,
  updateDashboardImage,
  updateDashboardSettings,
  updateDashboardTask
} from "./data";

const settings = {
  id: "settings-1",
  userId: "user-1",
  reminderIntervalMinutes: 180,
  timezone: "Asia/Singapore",
  quietHoursStart: "22:00",
  quietHoursEnd: "08:00",
  maxRemindersPerDay: 200,
  dueNudgeMinutes: 3,
  reminderMode: "INDIVIDUAL",
  reminderChatId: null,
  expenseCurrency: "SGD",
  ocrLanguages: "eng",
  directNudgesEnabled: false,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z")
} as const;

function userFindUnique() {
  return vi.fn(async () => ({ id: "user-1", telegramId: "123456789", settings }));
}

function storedImage(mimeType = "image/png") {
  return {
    id: "image-1",
    userId: "user-1",
    publicId: "IMG-1",
    telegramFileId: "private-file-id",
    telegramUniqueId: "unique-1",
    mediaKind: "photo",
    mimeType,
    fileName: "photo.png",
    caption: null,
    ocrText: null,
    ocrConfidence: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z")
  };
}

describe("dashboard data security", () => {
  it("retries a raced public id allocation and records creation undo in the successful transaction", async () => {
    const publicIds = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ publicId: "TASK-1" }]);
    const taskCreate = vi.fn()
      .mockRejectedValueOnce({ code: "P2002", meta: { target: ["userId", "publicId"] } })
      .mockImplementationOnce(async ({ data }: { data: Record<string, unknown> }) => ({
        ...data,
        id: "task-2",
        publicId: "TASK-2",
        status: TaskStatus.OPEN,
        recurrenceRule: null,
        pinnedAt: null,
        createdAt: new Date("2026-07-17T00:00:00.000Z"),
        updatedAt: new Date("2026-07-17T00:00:00.000Z")
      }));
    const auditCreate = vi.fn(async () => ({}));
    const tx = { task: { findMany: publicIds, create: taskCreate }, auditLog: { create: auditCreate } };
    const transaction = vi.fn(async (work: (client: typeof tx) => unknown) => work(tx));
    const database = {
      user: { findUnique: userFindUnique() },
      $transaction: transaction
    } as unknown as PrismaClient;

    const task = await createDashboardTask("123456789", { title: "Retry safely" }, database);

    expect(task.publicId).toBe("TASK-2");
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(taskCreate).toHaveBeenCalledTimes(2);
    expect(auditCreate).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        action: "undoable:create",
        metadata: expect.objectContaining({ targetId: "task-2", publicId: "TASK-2" })
      })
    });
  });

  it("rolls a recurring task forward when the dashboard completes it and records an undo entry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T00:00:00.000Z"));
    try {
      const task = {
        id: "task-1",
        userId: "user-1",
        publicId: "TASK-1",
        title: "Weekly review",
        description: "Review the week",
        sourceText: "Weekly review",
        status: TaskStatus.OPEN,
        dueAt: new Date("2026-07-18T09:00:00.000Z"),
        timezone: "UTC",
        reminderIntervalMinutes: 180,
        nextReminderAt: new Date("2026-07-18T08:57:00.000Z"),
        snoozedUntil: null,
        completedAt: null,
        lastRemindedAt: null,
        reminderCount: 0,
        embedding: null,
        calendarUrl: null,
        calendarEventId: null,
        calendarEventUrl: null,
        calendarSyncedAt: null,
        assignedTelegramId: null,
        assignedUsername: null,
        assignedDisplayName: null,
        recurrenceRule: RecurrenceRule.WEEKLY,
        recurrenceIntervalDays: null,
        recurrenceDayOfMonth: null,
        pinnedAt: null,
        archivedAt: null,
        archivedReason: null,
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        updatedAt: new Date("2026-07-01T00:00:00.000Z")
      };
      const auditCreate = vi.fn(async () => ({}));
      const taskUpdate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        ...task,
        ...data,
        updatedAt: new Date()
      }));
      const tx = { auditLog: { create: auditCreate }, task: { update: taskUpdate } };
      const database = {
        user: { findUnique: userFindUnique() },
        task: { findFirst: vi.fn(async () => task) },
        $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx))
      } as unknown as PrismaClient;

      const updated = await updateDashboardTask("123456789", "TASK-1", { status: TaskStatus.DONE }, database);

      expect(updated.status).toBe(TaskStatus.OPEN);
      expect(updated.dueAt).toBe("2026-07-25T09:00:00.000Z");
      expect(updated.nextReminderAt).toBe("2026-07-25T09:00:00.000Z");
      expect(taskUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: "task-1" },
        data: expect.objectContaining({
          status: TaskStatus.OPEN,
          dueAt: new Date("2026-07-25T09:00:00.000Z"),
          nextReminderAt: new Date("2026-07-25T09:00:00.000Z")
        })
      }));
      expect(auditCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "user-1",
          action: "undoable:complete-task",
          metadata: expect.objectContaining({ targetId: "task-1", status: TaskStatus.OPEN })
        })
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("archives dashboard tasks with undo metadata without destroying their reminder schedule", async () => {
    const nextReminderAt = new Date("2026-07-18T08:57:00.000Z");
    const task = {
      id: "task-1",
      userId: "user-1",
      publicId: "TASK-1",
      title: "Private task",
      status: TaskStatus.OPEN,
      archivedAt: null,
      archivedReason: null,
      nextReminderAt
    };
    const auditCreate = vi.fn(async () => ({}));
    const taskUpdate = vi.fn(async (_query: { data: Record<string, unknown> }) => task);
    const tx = { auditLog: { create: auditCreate }, task: { update: taskUpdate } };
    const database = {
      user: { findUnique: userFindUnique() },
      task: { findFirst: vi.fn(async () => task) },
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx))
    } as unknown as PrismaClient;

    await archiveDashboardTask("123456789", "TASK-1", database);

    const update = taskUpdate.mock.calls[0]?.[0] as { data?: Record<string, unknown> } | undefined;
    expect(update?.data).toMatchObject({ archivedReason: "removed" });
    expect(update?.data).not.toHaveProperty("nextReminderAt");
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        action: "undoable:archive",
        metadata: expect.objectContaining({ targetId: "task-1", targetKind: "task" })
      })
    });
  });

  it("scopes Telegram image lookup to the authenticated user and returns only safe raster bytes", async () => {
    const imageFindFirst = vi.fn(async () => storedImage());
    const database = {
      user: { findUnique: userFindUnique() },
      storedImage: { findFirst: imageFindFirst }
    } as unknown as PrismaClient;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { file_path: "photos/private image.png" } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      }))
      .mockResolvedValueOnce(new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": "4" }
      }));

    const result = await loadDashboardImageContent("123456789", "IMG-1", "bot-secret", database, fetcher);

    expect(result).toEqual({ bytes: new Uint8Array([137, 80, 78, 71]), contentType: "image/png" });
    expect(imageFindFirst).toHaveBeenCalledWith({
      where: { userId: "user-1", OR: [{ id: "IMG-1" }, { publicId: "IMG-1" }] }
    });
    expect(fetcher.mock.calls[0]?.[0]).toContain("file_id=private-file-id");
    expect(fetcher.mock.calls[1]?.[0]).toContain("photos/private%20image.png");
    expect(fetcher.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(result)).not.toContain("bot-secret");
    expect(JSON.stringify(result)).not.toContain("private-file-id");
  });

  it("records image caption edits with the existing caption undo helper", async () => {
    const original = storedImage();
    const auditCreate = vi.fn(async () => ({}));
    const imageUpdate = vi.fn(async () => ({ ...original, caption: "Updated caption" }));
    const tx = { auditLog: { create: auditCreate }, storedImage: { update: imageUpdate } };
    const database = {
      user: { findUnique: userFindUnique() },
      storedImage: { findFirst: vi.fn(async () => original) },
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx))
    } as unknown as PrismaClient;

    await expect(updateDashboardImage("123456789", "IMG-1", { caption: "Updated caption" }, database))
      .resolves.toMatchObject({ caption: "Updated caption" });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        action: "undoable:image-caption",
        metadata: expect.objectContaining({ targetId: "image-1", previousCaption: null })
      })
    });
  });

  it("rejects SVG and other active document formats even if Telegram labels them as images", async () => {
    const database = {
      user: { findUnique: userFindUnique() },
      storedImage: { findFirst: vi.fn(async () => storedImage("image/svg+xml")) }
    } as unknown as PrismaClient;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { file_path: "documents/a.svg" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response("<svg/>", { status: 200, headers: { "content-type": "image/svg+xml" } }));

    await expect(loadDashboardImageContent("123456789", "IMG-1", "bot-secret", database, fetcher))
      .rejects.toBeInstanceOf(DashboardUnsupportedMediaError);
  });

  it("clears pending OAuth state together with encrypted provider credentials", async () => {
    const pendingDelete = vi.fn(async () => ({ count: 1 }));
    const connectionDelete = vi.fn(async () => ({ count: 1 }));
    const tx = {
      pendingGmailOAuth: { deleteMany: pendingDelete },
      gmailConnection: { deleteMany: connectionDelete }
    };
    const database = {
      user: { findUnique: userFindUnique() },
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx))
    } as unknown as PrismaClient;

    await expect(disconnectDashboardIntegration("123456789", "gmail", database)).resolves.toEqual({
      provider: "gmail",
      disconnected: true
    });
    expect(pendingDelete).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(connectionDelete).toHaveBeenCalledWith({ where: { userId: "user-1" } });
  });

  it("resolves the signed Telegram owner before synchronizing that user's Excel expenses", async () => {
    const database = { user: { findUnique: userFindUnique() } } as unknown as PrismaClient;
    const syncExpenses = vi.fn(async () => 7);

    await expect(syncDashboardExcelExpenses("123456789", database, syncExpenses)).resolves.toEqual({
      provider: "excel",
      synced: 7
    });
    expect(syncExpenses).toHaveBeenCalledWith("user-1", "Asia/Singapore");
  });

  it("preserves per-task reminder intervals when another shared reminder setting changes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T00:00:00.000Z"));
    try {
      const taskUpdate = vi.fn(async (_query: { data: Record<string, unknown> }) => ({}));
      const tx = {
        userSettings: { update: vi.fn(async () => ({ ...settings, timezone: "UTC" })) },
        task: {
          findMany: vi.fn(async () => [{ id: "task-1", dueAt: null, reminderIntervalMinutes: 45 }]),
          update: taskUpdate
        }
      };
      const database = {
        user: { findUnique: userFindUnique() },
        $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx))
      } as unknown as PrismaClient;

      await updateDashboardSettings("123456789", { timezone: "UTC" }, database);

      const update = taskUpdate.mock.calls[0]?.[0] as { data?: Record<string, unknown> } | undefined;
      expect(update?.data).not.toHaveProperty("reminderIntervalMinutes");
      expect(update?.data).toMatchObject({
        timezone: "UTC",
        nextReminderAt: new Date("2026-07-17T00:45:00.000Z")
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("deletes user-linked audit metadata before the cascading account deletion", async () => {
    const auditDelete = vi.fn(async () => ({ count: 3 }));
    const userDelete = vi.fn(async () => ({ count: 1 }));
    const tx = {
      auditLog: { deleteMany: auditDelete },
      user: { deleteMany: userDelete }
    };
    const database = {
      user: { findUnique: userFindUnique() },
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx))
    } as unknown as PrismaClient;

    await deleteDashboardAccount("123456789", database);
    expect(auditDelete).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(userDelete).toHaveBeenCalledWith({ where: { id: "user-1", telegramId: "123456789" } });
    expect(auditDelete.mock.invocationCallOrder[0]).toBeLessThan(userDelete.mock.invocationCallOrder[0] ?? Infinity);
  });

  it("exports user content with explicit selects that omit provider credentials and Telegram file references", async () => {
    const gmailFind = vi.fn(async (_query: unknown) => null);
    const calendarFind = vi.fn(async (_query: unknown) => null);
    const microsoftFind = vi.fn(async (_query: unknown) => null);
    const userSafeFind = vi.fn(async (_query: unknown) => ({
      telegramId: "123456789", username: "henry", firstName: "Henry", lastName: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"), updatedAt: new Date("2026-01-01T00:00:00.000Z")
    }));
    const emptyFind = vi.fn(async (_query: unknown) => []);
    const database = {
      user: { findUnique: userFindUnique(), findUniqueOrThrow: userSafeFind },
      task: { findMany: emptyFind },
      note: { findMany: emptyFind },
      idea: { findMany: emptyFind },
      expense: { findMany: emptyFind },
      storedImage: { findMany: emptyFind },
      reflection: { findMany: emptyFind },
      gmailConnection: { findUnique: gmailFind },
      calendarConnection: { findUnique: calendarFind },
      microsoftConnection: { findUnique: microsoftFind }
    } as unknown as PrismaClient;

    const exported = await exportDashboardData("123456789", database);
    const queryText = JSON.stringify({
      gmail: gmailFind.mock.calls[0]?.[0],
      calendar: calendarFind.mock.calls[0]?.[0],
      microsoft: microsoftFind.mock.calls[0]?.[0],
      image: emptyFind.mock.calls.find((call) => JSON.stringify(call[0]).includes("mediaKind"))?.[0]
    });
    expect(queryText).not.toMatch(/accessToken|refreshToken|telegramFileId|telegramUniqueId|rawText|embedding/);
    expect(JSON.stringify(exported)).not.toMatch(/accessToken|refreshToken|telegramFileId|telegramUniqueId|rawText|embedding/);
  });
});
