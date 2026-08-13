import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { customReminderDeliveryKey, normalizeCustomReminderTimes, replacePendingTaskReminderSchedules } from "./taskReminderSchedules";

describe("custom task reminder schedules", () => {
  const now = new Date("2026-08-13T00:00:00.000Z");

  it("sorts and deduplicates explicit reminder times", () => {
    expect(normalizeCustomReminderTimes([
      "2026-08-17T01:00:00.000Z",
      "2026-08-16T13:00:00.000Z",
      "2026-08-17T01:00:00.000Z",
    ], now).map((value) => value.toISOString())).toEqual([
      "2026-08-16T13:00:00.000Z",
      "2026-08-17T01:00:00.000Z",
    ]);
  });

  it("rejects past or invalid reminder times with a useful message", () => {
    expect(() => normalizeCustomReminderTimes(["2026-08-12T00:00:00.000Z"], now)).toThrow("future");
    expect(() => normalizeCustomReminderTimes(["not-a-time"], now)).toThrow("valid reminder");
  });

  it("uses one stable delivery key per persisted schedule", () => {
    expect(customReminderDeliveryKey("schedule-1")).toBe("task-custom:schedule-1");
  });

  it("replaces only pending schedules and remains duplicate-safe", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const upsert = vi.fn().mockResolvedValue({});
    const database = { taskReminderSchedule: { updateMany, upsert } } as unknown as PrismaClient;
    const times = normalizeCustomReminderTimes([
      "2026-08-16T13:00:00.000Z",
      "2026-08-17T01:00:00.000Z",
    ], now);
    await replacePendingTaskReminderSchedules(database, "user-1", "task-1", times);
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", taskId: "task-1", status: { in: ["PENDING", "PROCESSING"] } },
      data: { status: "CANCELED", leaseExpiresAt: null, taskStateCanceled: false },
    });
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { taskId_scheduledAt: { taskId: "task-1", scheduledAt: times[0] } },
      create: { userId: "user-1", taskId: "task-1", scheduledAt: times[0] },
    }));
  });
});
