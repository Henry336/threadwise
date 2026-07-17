import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { dashboardRevision } from "./realtime";

function aggregate(count: number, updatedAt: string | null) {
  return vi.fn(async () => ({
    _count: count,
    _max: { updatedAt: updatedAt ? new Date(updatedAt) : null }
  }));
}

describe("dashboard live revision", () => {
  it("changes when any bot-owned collection changes without loading full records", async () => {
    const taskAggregate = aggregate(2, "2026-07-17T10:00:00.000Z");
    const database = {
      user: {
        findUnique: vi.fn(async () => ({
          id: "user-1",
          updatedAt: new Date("2026-07-17T09:00:00.000Z"),
          settings: { updatedAt: new Date("2026-07-17T09:00:00.000Z") },
          gmailConnection: null,
          calendarConnection: null,
          microsoftConnection: null
        }))
      },
      task: { aggregate: taskAggregate },
      note: { aggregate: aggregate(3, "2026-07-17T08:00:00.000Z") },
      idea: { aggregate: aggregate(1, "2026-07-16T08:00:00.000Z") },
      storedImage: { aggregate: aggregate(0, null) },
      expense: { aggregate: aggregate(4, "2026-07-15T08:00:00.000Z") }
    } as unknown as PrismaClient;

    const before = await dashboardRevision("123456789", database);
    taskAggregate.mockResolvedValue({
      _count: 3,
      _max: { updatedAt: new Date("2026-07-17T10:01:00.000Z") }
    });
    const after = await dashboardRevision("123456789", database);

    expect(before).not.toBe(after);
    expect(taskAggregate).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      _count: true,
      _max: { updatedAt: true }
    });
  });
});
