import type { Context } from "grammy";
import { describe, expect, it, vi } from "vitest";
import { rememberNewControlCard, replyControlCardHtml } from "./controlCards";

describe("active control cards", () => {
  it("registers a fresh entity card and retires the previous interactive card", async () => {
    const reply = vi.fn().mockResolvedValue({ message_id: 302 });
    const editMessageReplyMarkup = vi.fn().mockResolvedValue(true);
    const ctx = {
      chat: { id: 3020, type: "private" },
      reply,
      api: { editMessageReplyMarkup }
    } as unknown as Context;

    await rememberNewControlCard(ctx, { message_id: 301 });
    await replyControlCardHtml(ctx, "<b>Updated task</b>", { reply_markup: { inline_keyboard: [] } });

    expect(editMessageReplyMarkup).toHaveBeenCalledWith(3020, 301, {
      reply_markup: { inline_keyboard: [] }
    });
  });

  it("does not register group messages as personal control cards", async () => {
    const editMessageReplyMarkup = vi.fn().mockResolvedValue(true);
    const ctx = {
      chat: { id: -450, type: "supergroup" },
      api: { editMessageReplyMarkup }
    } as unknown as Context;

    await rememberNewControlCard(ctx, { message_id: 99 });
    expect(editMessageReplyMarkup).not.toHaveBeenCalled();
  });
});
