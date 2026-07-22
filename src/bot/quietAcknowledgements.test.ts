import type { Context } from "grammy";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  editOrReplyQuietAcknowledgementHtml,
  QUIET_ACKNOWLEDGEMENT_TTL_MS,
  replyQuietAcknowledgementHtml,
} from "./quietAcknowledgements";

afterEach(() => {
  vi.useRealTimers();
});

describe("quiet acknowledgements", () => {
  it("removes only the acknowledgement after the short visibility window", async () => {
    vi.useFakeTimers();
    const reply = vi.fn().mockResolvedValue({ message_id: 41, chat: { id: 700 } });
    const deleteMessage = vi.fn().mockResolvedValue(true);
    const ctx = { chat: { id: 700, type: "private" }, reply, api: { deleteMessage } } as unknown as Context;

    await replyQuietAcknowledgementHtml(ctx, "<b>Note saved</b> · Passport");

    expect(deleteMessage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(QUIET_ACKNOWLEDGEMENT_TTL_MS);
    expect(deleteMessage).toHaveBeenCalledWith(700, 41);
  });

  it("removes a completed one-shot callback card without posting another message", async () => {
    vi.useFakeTimers();
    const editMessageText = vi.fn().mockResolvedValue(true);
    const reply = vi.fn();
    const deleteMessage = vi.fn().mockResolvedValue(true);
    const ctx = {
      chat: { id: 701, type: "private" },
      callbackQuery: { message: { message_id: 42, chat: { id: 701, type: "private" }, text: "Save this?" } },
      editMessageText,
      reply,
      api: { deleteMessage },
    } as unknown as Context;

    await editOrReplyQuietAcknowledgementHtml(ctx, "<b>Idea saved</b> · Better search");
    await vi.advanceTimersByTimeAsync(QUIET_ACKNOWLEDGEMENT_TTL_MS);

    expect(editMessageText).toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
    expect(deleteMessage).toHaveBeenCalledWith(701, 42);
  });
});
