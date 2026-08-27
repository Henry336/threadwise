import { describe, expect, it, vi } from "vitest";

const expire = vi.hoisted(() => vi.fn());
vi.mock("../services/taskCaptureDrafts", () => ({ expireTaskCaptureDrafts: expire }));
import { expireTaskDraftCards } from "./todayExpiry";

describe("Today draft expiry cards", () => {
  it("replaces the original review card without sending another message", async () => {
    expire.mockResolvedValue([{ id: "draft-1", telegramChatId: "123", telegramReviewMessageId: 45 }]);
    const editMessageText = vi.fn(async () => ({}));
    await expect(expireTaskDraftCards({ api: { editMessageText } } as never, "123")).resolves.toBe(1);
    expect(editMessageText).toHaveBeenCalledWith("123", 45, "Draft expired · Nothing was saved.");
  });
});
