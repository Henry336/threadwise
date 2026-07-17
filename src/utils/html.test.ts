import type { Context } from "grammy";
import { describe, expect, it, vi } from "vitest";
import { editOrReplyHtml, editOrReplyText } from "./html";

describe("callback message editing", () => {
  it("edits the current text message with HTML instead of sending another message", async () => {
    const editMessageText = vi.fn().mockResolvedValue(true);
    const reply = vi.fn();
    const ctx = {
      callbackQuery: { message: { message_id: 12, text: "Before" } },
      editMessageText,
      reply
    } as unknown as Context;

    await editOrReplyHtml(ctx, "<b>After</b>", { reply_markup: { inline_keyboard: [] } });

    expect(editMessageText).toHaveBeenCalledWith("<b>After</b>", expect.objectContaining({ parse_mode: "HTML" }));
    expect(reply).not.toHaveBeenCalled();
  });

  it("edits a media caption when an inline button belongs to a photo", async () => {
    const editMessageCaption = vi.fn().mockResolvedValue(true);
    const reply = vi.fn();
    const ctx = {
      callbackQuery: { message: { message_id: 13, photo: [{}], caption: "Before" } },
      editMessageCaption,
      reply
    } as unknown as Context;

    await editOrReplyText(ctx, "After");

    expect(editMessageCaption).toHaveBeenCalledWith(expect.objectContaining({ caption: "After" }));
    expect(reply).not.toHaveBeenCalled();
  });

  it("falls back to a new reply when there is no callback message to edit", async () => {
    const reply = vi.fn().mockResolvedValue(true);
    const ctx = { reply } as unknown as Context;

    await editOrReplyHtml(ctx, "<b>Fresh message</b>");

    expect(reply).toHaveBeenCalledWith("<b>Fresh message</b>", { parse_mode: "HTML" });
  });

  it("does not duplicate a message when Telegram reports that it is unchanged", async () => {
    const editMessageText = vi.fn().mockRejectedValue(new Error("Bad Request: message is not modified"));
    const reply = vi.fn();
    const ctx = {
      callbackQuery: { message: { message_id: 14, text: "Same" } },
      editMessageText,
      reply
    } as unknown as Context;

    await editOrReplyText(ctx, "Same");

    expect(reply).not.toHaveBeenCalled();
  });
});
