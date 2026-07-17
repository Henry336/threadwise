import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardUserNotFoundError, getDashboardSnapshot } from "./snapshot";

const mocks = {
  userFindUnique: vi.fn(),
  taskFindMany: vi.fn(),
  noteFindMany: vi.fn(),
  ideaFindMany: vi.fn(),
  expenseFindMany: vi.fn(),
  imageFindMany: vi.fn(),
  reflectionFindMany: vi.fn()
};

const database = {
  user: { findUnique: mocks.userFindUnique },
  task: { findMany: mocks.taskFindMany },
  note: { findMany: mocks.noteFindMany },
  idea: { findMany: mocks.ideaFindMany },
  expense: { findMany: mocks.expenseFindMany },
  storedImage: { findMany: mocks.imageFindMany },
  reflection: { findMany: mocks.reflectionFindMany }
} as unknown as PrismaClient;

describe("dashboard snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses explicit safe selects and scopes every query to the authenticated personal user", async () => {
    const now = new Date("2026-07-16T10:00:00.000Z");
    mocks.userFindUnique.mockResolvedValue({
      id: "user-uuid",
      telegramId: "123456789",
      username: "henry",
      firstName: "Henry",
      lastName: "Derek",
      settings: {
        timezone: "Asia/Singapore",
        reminderIntervalMinutes: 180,
        quietHoursStart: "22:00",
        quietHoursEnd: "08:00",
        maxRemindersPerDay: 200,
        dueNudgeMinutes: 3,
        reminderMode: "INDIVIDUAL",
        expenseCurrency: "SGD",
        ocrLanguages: "eng",
        directNudgesEnabled: false
      },
      gmailConnection: { scanEnabled: true, lastScanAt: new Date("2026-07-16T09:42:00.000Z") },
      calendarConnection: { createdAt: new Date("2026-07-01T00:00:00.000Z") },
      microsoftConnection: { workbookName: "Expenses.xlsx", createdAt: new Date("2026-07-01T00:00:00.000Z") }
    });
    mocks.taskFindMany
      .mockResolvedValueOnce([
        {
          id: "task-uuid",
          publicId: "TASK-1",
          title: "Ship dashboard",
          description: "Verify the safe API contract",
          dueAt: new Date("2026-07-16T12:00:00.000Z"),
          status: "OPEN",
          recurrenceRule: null,
          pinnedAt: new Date("2026-07-15T00:00:00.000Z"),
          reminderCount: 1,
          assignedUsername: null,
          assignedDisplayName: null,
          createdAt: new Date("2026-07-16T08:00:00.000Z"),
          updatedAt: new Date("2026-07-16T09:00:00.000Z")
        }
      ])
      .mockResolvedValueOnce([
        {
          createdAt: new Date("2026-07-16T08:00:00.000Z"),
          completedAt: new Date("2026-07-16T09:00:00.000Z")
        }
      ]);
    mocks.noteFindMany
      .mockResolvedValueOnce([
        {
          id: "note-uuid",
          publicId: "NOTE-1",
          title: "API plan",
          body: "Only return fields the dashboard renders.",
          summary: "Only return fields the dashboard renders.",
          tags: ["dashboard"],
          createdAt: new Date("2026-07-16T07:00:00.000Z"),
          updatedAt: new Date("2026-07-16T07:30:00.000Z"),
          pinnedAt: null
        }
      ])
      .mockResolvedValueOnce([{ createdAt: new Date("2026-07-16T07:00:00.000Z") }]);
    mocks.ideaFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ createdAt: new Date("2026-07-15T07:00:00.000Z") }]);
    mocks.expenseFindMany
      .mockResolvedValueOnce([
        {
          id: "expense-uuid",
          publicId: "EXP-1",
          merchant: "NUS Co-op",
          description: "Notebook",
          total: 14.9,
          currency: "SGD",
          category: "School",
          transactionAt: new Date("2026-07-15T08:00:00.000Z"),
          paymentMethod: null,
          notes: null,
          createdAt: new Date("2026-07-15T08:00:00.000Z"),
          updatedAt: new Date("2026-07-15T08:00:00.000Z")
        }
      ])
      .mockResolvedValueOnce([{ createdAt: new Date("2026-07-15T08:00:00.000Z") }]);
    mocks.imageFindMany.mockResolvedValue([]);
    mocks.reflectionFindMany.mockResolvedValue([{ createdAt: new Date("2026-07-14T08:00:00.000Z") }]);

    const snapshot = await getDashboardSnapshot("123456789", database, now);

    expect(snapshot.user).toMatchObject({
      telegramId: "123456789",
      firstName: "Henry",
      fullName: "Henry Derek",
      username: "henry",
      timezone: "Asia/Singapore"
    });
    expect(snapshot.tasks[0]).toMatchObject({ publicId: "TASK-1", title: "Ship dashboard", pinned: true });
    expect(snapshot.expenses[0]?.total).toBe(14.9);
    expect(snapshot.activity.reduce((total, day) => total + day.captures, 0)).toBe(5);
    expect(snapshot.activity.reduce((total, day) => total + day.completed, 0)).toBe(1);
    expect(snapshot.integrations).toEqual([
      { name: "Gmail", state: "connected", detail: "Scanned 18 min ago" },
      { name: "Calendar", state: "connected", detail: "Calendar connected" },
      { name: "Excel", state: "connected", detail: "Workbook connected" }
    ]);

    expect(mocks.userFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { telegramId: "123456789" } }));
    for (const findMany of [
      mocks.taskFindMany,
      mocks.noteFindMany,
      mocks.ideaFindMany,
      mocks.expenseFindMany,
      mocks.imageFindMany,
      mocks.reflectionFindMany
    ]) {
      for (const [query] of findMany.mock.calls) {
        expect(query.where.userId).toBe("user-uuid");
      }
    }

    const queryShape = JSON.stringify({
      user: mocks.userFindUnique.mock.calls[0]?.[0],
      tasks: mocks.taskFindMany.mock.calls[0]?.[0],
      notes: mocks.noteFindMany.mock.calls[0]?.[0],
      ideas: mocks.ideaFindMany.mock.calls[0]?.[0],
      expenses: mocks.expenseFindMany.mock.calls[0]?.[0],
      images: mocks.imageFindMany.mock.calls[0]?.[0]
    });
    expect(queryShape).not.toMatch(/accessToken|refreshToken|sourceText|embedding|telegramFileId|receiptFileUniqueId|rawText/);
    expect(JSON.stringify(snapshot)).not.toMatch(/accessToken|refreshToken|sourceText|embedding|telegramFileId|receiptFileUniqueId|rawText/);
  });

  it("rejects synthetic group owners before any database query", async () => {
    await expect(getDashboardSnapshot("chat:-100123", database)).rejects.toBeInstanceOf(DashboardUserNotFoundError);
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
  });
});
