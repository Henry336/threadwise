import type { Context } from "grammy";
import { describe, expect, it, vi } from "vitest";
import { showMainMenu } from "./menu";

const mocks = vi.hoisted(() => ({
  cancelTransientInteractions: vi.fn().mockResolvedValue({})
}));

vi.mock("./interactions", () => ({
  cancelTransientInteractions: mocks.cancelTransientInteractions
}));

describe("private control menu", () => {
  it("re-anchors a fresh inline control card and retires the previous card", async () => {
    const reply = vi.fn()
      .mockResolvedValueOnce({ message_id: 101 })
      .mockResolvedValueOnce({ message_id: 102 });
    const editMessageReplyMarkup = vi.fn().mockResolvedValue(true);
    const ctx = {
      chat: { id: 77, type: "private" },
      reply,
      api: { editMessageReplyMarkup }
    } as unknown as Context;

    await showMainMenu(ctx, "Asia/Singapore");
    await showMainMenu(ctx, "Asia/Singapore");

    expect(reply.mock.calls[1]?.[1]?.reply_markup.inline_keyboard.flat()).toContainEqual({
      text: "📋 Tasks",
      callback_data: "menu:tasks"
    });
    expect(editMessageReplyMarkup).toHaveBeenCalledWith(77, 101, {
      reply_markup: { inline_keyboard: [] }
    });
  });

  it("abandons a pending button prompt when Menu re-anchors", async () => {
    const reply = vi.fn().mockResolvedValue({ message_id: 201 });
    const ctx = {
      chat: { id: 88, type: "private" },
      reply,
      api: { editMessageReplyMarkup: vi.fn().mockResolvedValue(true) }
    } as unknown as Context;

    await showMainMenu(ctx, "Asia/Singapore", "user-88", 880);

    expect(reply).toHaveBeenCalledTimes(1);
    expect(mocks.cancelTransientInteractions).toHaveBeenCalledWith("user-88", 880);
  });
});
