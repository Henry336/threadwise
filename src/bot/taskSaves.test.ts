import type { Context } from "grammy";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pendingCaptureCreate: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "capture-1", ...data })),
  createTask: vi.fn(async () => ({ id: "t1", publicId: "TASK-9", title: "buy milk" })),
  recordGroupTaskCreatedFromContext: vi.fn(),
  replyQuietAcknowledgementHtml: vi.fn(),
  editOrReplyQuietAcknowledgementHtml: vi.fn(),
}));

vi.mock("../db/prisma", () => ({ prisma: { pendingCapture: { create: mocks.pendingCaptureCreate } } }));
vi.mock("../services/tasks", () => ({
  createTask: mocks.createTask,
  formatTaskSavedAcknowledgement: () => "Saved TASK-9",
}));
vi.mock("../services/groupCollaboration", () => ({ recordGroupTaskCreatedFromContext: mocks.recordGroupTaskCreatedFromContext }));
vi.mock("./quietAcknowledgements", () => ({
  replyQuietAcknowledgementHtml: mocks.replyQuietAcknowledgementHtml,
  editOrReplyQuietAcknowledgementHtml: mocks.editOrReplyQuietAcknowledgementHtml,
}));

import { createPendingCapture, pendingCaptureTaskOptions } from "../services/pendingCaptures";
import { saveTaskFromTelegram } from "./taskSaves";
import { taskCreationOptionsFromContext } from "./taskMentions";

const user = { id: "chat-owner", settings: { timezone: "Asia/Singapore" } };
const text = "Alex buy milk";
// A group message whose "Alex" is a text_mention: a member without a username, picked from Telegram's list.
const messageCtx = {
  me: { id: 1 },
  chat: { id: -100, type: "group" },
  message: { text, entities: [{ type: "text_mention", offset: 0, length: 4, user: { id: 42, is_bot: false, first_name: "Alex" } }] },
} as unknown as Context;
// The later review-card tap: a callback update with no message entities of its own.
const buttonCtx = { me: { id: 1 }, chat: { id: -100, type: "group" }, callbackQuery: { id: "q" } } as unknown as Context;

describe("saving a task from Telegram", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps a text-mention assignee when the task is saved from the review card", async () => {
    const pending = await createPendingCapture(user.id, text, { kind: "noise", confidence: 0, reason: "choose" }, 7, -100, taskCreationOptionsFromContext(messageCtx, text).mentions);
    const options = pendingCaptureTaskOptions(pending as never);

    await saveTaskFromTelegram(buttonCtx, user, pending.sourceText as string, { options, edit: true });

    expect(mocks.createTask).toHaveBeenCalledWith("chat-owner", text, {
      mentions: [{ offset: 0, length: 4, telegramId: "42", displayName: "Alex", username: undefined }],
    });
    expect(mocks.recordGroupTaskCreatedFromContext).toHaveBeenCalledWith(buttonCtx, "chat-owner", expect.objectContaining({ publicId: "TASK-9" }));
    expect(mocks.editOrReplyQuietAcknowledgementHtml).toHaveBeenCalledWith(buttonCtx, "Saved TASK-9");
  });

  it("saves a reminder by passing the due time with the options, and replies instead of editing", async () => {
    const dueAt = new Date("2026-11-10T01:00:00Z");
    await saveTaskFromTelegram(messageCtx, user, text, { dueAt, options: { mentions: [] } });
    expect(mocks.createTask).toHaveBeenCalledWith("chat-owner", text, { mentions: [], dueAt });
    expect(mocks.replyQuietAcknowledgementHtml).toHaveBeenCalledWith(messageCtx, "Saved TASK-9");
  });

  it("reads no options from a payload without stored mentions or with malformed ones", () => {
    expect(pendingCaptureTaskOptions({ payload: { kind: "noise" } })).toEqual({});
    expect(pendingCaptureTaskOptions({ payload: { mentions: [{ offset: "0" }, null, 3] } })).toEqual({});
    expect(pendingCaptureTaskOptions({ payload: null })).toEqual({});
  });
});
