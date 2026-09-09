import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock("../db/prisma", () => ({
  prisma: {
    studyReminderDelivery: {
      findMany: mocks.findMany,
    },
  },
}));

import { loadExistingStudyReminderDeliveries } from "./studyReminders";

describe("Study reminder delivery preflight", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads known dedupe keys in one bounded query and removes duplicate inputs", async () => {
    const existing = {
      dedupeKey: "workspace:ITEM_OVERDUE:item:2026-09-09",
      createdAt: new Date("2026-09-09T00:00:00.000Z"),
      sentAt: new Date("2026-09-09T00:00:01.000Z"),
    };
    mocks.findMany.mockResolvedValue([existing]);

    const result = await loadExistingStudyReminderDeliveries([
      existing.dedupeKey,
      existing.dedupeKey,
      "workspace:DEADLINE_APPROACHING:other:2026-09-09",
    ]);

    expect(mocks.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { dedupeKey: { in: [existing.dedupeKey, "workspace:DEADLINE_APPROACHING:other:2026-09-09"] } },
      select: { dedupeKey: true, createdAt: true, sentAt: true },
    });
    expect(result.get(existing.dedupeKey)).toEqual(existing);
  });

  it("avoids a database round trip when there are no candidates", async () => {
    await expect(loadExistingStudyReminderDeliveries([])).resolves.toEqual(new Map());
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
