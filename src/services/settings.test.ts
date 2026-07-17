import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const userSettingsUpdate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    reminderIntervalMinutes: 180,
    dueNudgeMinutes: 3,
    timezone: "Asia/Singapore",
    ...data
  }));
  const tx = {
    userSettings: { update: userSettingsUpdate },
    task: { findMany: vi.fn(async () => []), update: vi.fn(async () => ({})) }
  };
  const transaction = vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx));
  return { transaction, userSettingsUpdate, tx };
});

vi.mock("../db/prisma", () => ({
  prisma: { $transaction: mocks.transaction }
}));

vi.mock("./reminders", () => ({
  nextReminderAfterSettingChange: vi.fn()
}));

import { updateSetting } from "./settings";

describe("settings updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores custom quiet hours in canonical HH:mm form", async () => {
    await expect(updateSetting("user-1", ["quiet", "3:00", "6:00"]))
      .resolves.toMatchObject({ message: expect.stringContaining("03:00-06:00") });

    expect(mocks.userSettingsUpdate).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      data: { quietHoursStart: "03:00", quietHoursEnd: "06:00" }
    });
  });
});
