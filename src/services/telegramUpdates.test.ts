import { beforeEach, describe, expect, it, vi } from "vitest";

const processedTelegramUpdate = vi.hoisted(() => ({
  createMany: vi.fn(),
  deleteMany: vi.fn()
}));

vi.mock("../db/prisma", () => ({
  prisma: {
    processedTelegramUpdate
  }
}));

import { claimTelegramUpdate } from "./telegramUpdates";

describe("claimTelegramUpdate", () => {
  beforeEach(() => {
    processedTelegramUpdate.createMany.mockReset();
    processedTelegramUpdate.deleteMany.mockReset();
  });

  it("claims new Telegram updates with skipDuplicates", async () => {
    processedTelegramUpdate.createMany.mockResolvedValue({ count: 1 });

    await expect(claimTelegramUpdate(210083600)).resolves.toBe(true);

    expect(processedTelegramUpdate.createMany).toHaveBeenCalledWith({
      data: [{ updateId: 210083600 }],
      skipDuplicates: true
    });
    expect(processedTelegramUpdate.deleteMany).toHaveBeenCalledOnce();
  });

  it("returns false for duplicate Telegram updates without throwing", async () => {
    processedTelegramUpdate.createMany.mockResolvedValue({ count: 0 });

    await expect(claimTelegramUpdate(210083597)).resolves.toBe(false);
  });
});
