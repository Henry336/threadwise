import type { Context } from "grammy";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("../db/prisma", () => ({
  prisma: {
    taskControlSurface: {
      findUnique: mocks.findUnique,
      upsert: mocks.upsert,
    },
  },
}));

import { convergeTaskControlSurface } from "./taskControlSurfaces";

function context(messageId: number, options: { deleteFails?: boolean } = {}) {
  return {
    chat: { id: -100123 },
    callbackQuery: { message: { message_id: messageId } },
    api: {
      deleteMessage: options.deleteFails ? vi.fn().mockRejectedValue(new Error("too old")) : vi.fn().mockResolvedValue(true),
      editMessageText: vi.fn().mockResolvedValue(true),
    },
  } as unknown as Context;
}

describe("canonical task control surface", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists the first completed-task list without deleting it", async () => {
    mocks.findUnique.mockResolvedValue(null);
    const ctx = context(41);
    await convergeTaskControlSurface(ctx, "user-1");
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_chatId: { userId: "user-1", chatId: "-100123" } },
      update: { messageId: "41" },
    }));
    expect(ctx.api.deleteMessage).not.toHaveBeenCalled();
  });

  it("deletes the previous list after a different completion becomes canonical", async () => {
    mocks.findUnique.mockResolvedValue({ messageId: "41" });
    const ctx = context(52);
    await convergeTaskControlSurface(ctx, "user-1");
    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(-100123, 41);
  });

  it("tracks a newly sent fallback list instead of the original callback message", async () => {
    mocks.findUnique.mockResolvedValue({ messageId: "41" });
    const ctx = context(52);
    await convergeTaskControlSurface(ctx, "user-1", 77);
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { messageId: "77" },
    }));
    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(-100123, 41);
  });

  it("retires the old controls when Telegram no longer allows deletion", async () => {
    mocks.findUnique.mockResolvedValue({ messageId: "41" });
    const ctx = context(52, { deleteFails: true });
    await convergeTaskControlSurface(ctx, "user-1");
    expect(ctx.api.editMessageText).toHaveBeenCalledWith(
      -100123,
      41,
      expect.stringContaining("Task controls moved"),
      expect.objectContaining({ reply_markup: { inline_keyboard: [] } }),
    );
  });
});
