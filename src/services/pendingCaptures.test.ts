import { beforeEach, describe, expect, it, vi } from "vitest";

const pendingCapture = vi.hoisted(() => ({
  create: vi.fn(),
  findFirst: vi.fn(),
  delete: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock("../db/prisma", () => ({
  prisma: { pendingCapture },
}));

import {
  consumePendingCapture,
  createPendingCapture,
  ignorePendingCapture,
} from "./pendingCaptures";

describe("pending capture ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("binds an ambiguous group capture to the person who sent it", async () => {
    pendingCapture.create.mockResolvedValue({ id: "capture-1" });

    await createPendingCapture("workspace-user", "Maybe later", {
      kind: "noise",
      confidence: 0,
      reason: "needs a choice",
    }, 77);

    expect(pendingCapture.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "workspace-user",
        actorTelegramId: "77",
        sourceText: "Maybe later",
      }),
    });
  });

  it("only consumes captures owned by the callback sender", async () => {
    pendingCapture.findFirst.mockResolvedValue(undefined);

    await expect(consumePendingCapture("workspace-user", "capture-1", 88))
      .resolves.toBeUndefined();

    expect(pendingCapture.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "capture-1",
        userId: "workspace-user",
        OR: [
          { actorTelegramId: null },
          { actorTelegramId: "88" },
        ],
      }),
    });
    expect(pendingCapture.delete).not.toHaveBeenCalled();
  });

  it("scopes Ignore to the same sender as the other capture actions", async () => {
    pendingCapture.deleteMany.mockResolvedValue({ count: 0 });

    await expect(ignorePendingCapture("workspace-user", "capture-1", 88))
      .resolves.toBe(false);

    expect(pendingCapture.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        OR: [
          { actorTelegramId: null },
          { actorTelegramId: "88" },
        ],
      }),
    });
  });
});
