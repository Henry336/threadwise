import { StudyCaptureBatchStatus, type StudyWorkspace } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const client: Record<string, any> = {
    studyModule: { count: vi.fn() },
    studyPendingCapture: {
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
    },
    studyPendingCaptureBatch: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
  client.$transaction = vi.fn(async (operation: unknown) => (
    typeof operation === "function"
      ? (operation as (tx: typeof client) => unknown)(client)
      : Promise.all(operation as Promise<unknown>[])
  ));
  return client;
});

vi.mock("../db/prisma", () => ({ prisma: db }));

import {
  processStudyCaptureBatches,
  registerStudyImageCapture,
  STUDY_CAPTURE_BATCH_TTL_MS,
} from "./studyCaptureBatches";

const workspace = { id: "workspace-1", ownerUserId: "user-1" } as StudyWorkspace;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-13T08:00:00Z"));
  db.$transaction.mockImplementation(async (operation: unknown) => (
    typeof operation === "function"
      ? (operation as (tx: typeof db) => unknown)(db)
      : Promise.all(operation as Promise<unknown>[])
  ));
  db.studyModule.count.mockResolvedValue(1);
  db.studyPendingCapture.findFirst.mockResolvedValue(null);
  db.studyPendingCaptureBatch.findUnique.mockResolvedValue(null);
  db.studyPendingCapture.count.mockResolvedValue(0);
  db.studyPendingCaptureBatch.deleteMany.mockResolvedValue({ count: 0 });
  db.studyPendingCaptureBatch.updateMany.mockResolvedValue({ count: 0 });
  db.studyPendingCapture.deleteMany.mockResolvedValue({ count: 0 });
  db.studyPendingCapture.updateMany.mockResolvedValue({ count: 0 });
});

describe("durable Study image batches", () => {
  it("persists the album and each image with one five-minute expiry", async () => {
    const batch = {
      id: "batch-1",
      token: "batch-token",
      workspaceId: workspace.id,
      telegramMediaGroupId: "album-1",
      status: StudyCaptureBatchStatus.COLLECTING,
    };
    db.studyPendingCaptureBatch.upsert.mockResolvedValue(batch);
    db.studyPendingCapture.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "capture-1", ...data, batch }));

    const result = await registerStudyImageCapture(workspace, {
      moduleId: "module-1",
      telegramMediaGroupId: "album-1",
      chatId: "-222",
      telegramFileId: "file-1",
      telegramUniqueId: "unique-1",
      mediaKind: "photo",
      mimeType: "image/jpeg",
      sourceMessageId: 41,
    });

    expect(result.duplicate).toBe(false);
    expect(db.studyPendingCaptureBatch.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        workspaceId: workspace.id,
        telegramMediaGroupId: "album-1",
        chatId: "-222",
        expiresAt: new Date(Date.now() + STUDY_CAPTURE_BATCH_TTL_MS),
      }),
    }));
    expect(db.studyPendingCapture.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        batchId: "batch-1",
        telegramUniqueId: "unique-1",
        expiresAt: new Date(Date.now() + STUDY_CAPTURE_BATCH_TTL_MS),
      }),
      include: { batch: true },
    });
  });

  it("returns the existing persisted capture when Telegram redelivers an update", async () => {
    const duplicate = { id: "capture-1", batch: { id: "batch-1", token: "batch-token" } };
    db.studyPendingCapture.findFirst.mockResolvedValue(duplicate);

    const result = await registerStudyImageCapture(workspace, {
      chatId: "-222",
      telegramFileId: "file-1",
      telegramUniqueId: "unique-1",
      mediaKind: "photo",
      sourceMessageId: 41,
    });

    expect(result).toEqual({ batch: duplicate.batch, capture: duplicate, duplicate: true });
    expect(db.studyPendingCaptureBatch.upsert).not.toHaveBeenCalled();
    expect(db.studyPendingCapture.create).not.toHaveBeenCalled();
  });

  it("does not reopen a completed batch when Telegram redelivers an old album item", async () => {
    const completed = { id: "batch-1", token: "batch-token", status: StudyCaptureBatchStatus.COMPLETED };
    db.studyPendingCaptureBatch.findUnique.mockResolvedValue(completed);

    const result = await registerStudyImageCapture(workspace, {
      telegramMediaGroupId: "album-1",
      chatId: "-222",
      telegramFileId: "file-1",
      telegramUniqueId: "unique-1",
      mediaKind: "photo",
      sourceMessageId: 41,
    });

    expect(result).toEqual({ batch: completed, capture: null, duplicate: true });
    expect(db.studyPendingCaptureBatch.upsert).not.toHaveBeenCalled();
    expect(db.studyPendingCapture.create).not.toHaveBeenCalled();
  });

  it("publishes one review menu and stores its message id", async () => {
    const now = new Date();
    const candidate = {
      id: "batch-1",
      token: "batch-token",
      chatId: "-222",
      status: StudyCaptureBatchStatus.COLLECTING,
      readyAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    };
    db.studyPendingCaptureBatch.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([candidate]);
    db.studyPendingCaptureBatch.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    db.studyPendingCaptureBatch.findUnique.mockResolvedValue({
      ...candidate,
      captures: [{ token: "capture-token" }, { token: "capture-token-2" }],
      module: { code: "CS2100" },
      sharedCaption: null,
    });
    const bot = {
      api: {
        getChatMemberCount: vi.fn().mockResolvedValue(2),
        sendMessage: vi.fn().mockResolvedValue({ message_id: 900 }),
        deleteMessage: vi.fn(),
      },
    } as any;

    await processStudyCaptureBatches(bot, now);

    expect(bot.api.sendMessage).toHaveBeenCalledTimes(1);
    expect(bot.api.sendMessage).toHaveBeenCalledWith("-222", expect.stringContaining("2 image captures"), expect.objectContaining({
      reply_markup: expect.objectContaining({ inline_keyboard: expect.any(Array) }),
    }));
    expect(db.studyPendingCaptureBatch.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: StudyCaptureBatchStatus.REVIEW, reviewMessageId: 900 }),
    }));
  });

  it("deletes an expired review menu and removes its pending items", async () => {
    const now = new Date();
    const expired = {
      id: "batch-1",
      chatId: "-222",
      reviewMessageId: 900,
      status: StudyCaptureBatchStatus.REVIEW,
      expiresAt: new Date(now.getTime() - 1),
    };
    db.studyPendingCaptureBatch.findMany.mockResolvedValueOnce([expired]).mockResolvedValueOnce([]);
    db.studyPendingCaptureBatch.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    const bot = {
      api: {
        deleteMessage: vi.fn().mockResolvedValue(true),
        getChatMemberCount: vi.fn(),
        sendMessage: vi.fn(),
      },
    } as any;

    await processStudyCaptureBatches(bot, now);

    expect(bot.api.deleteMessage).toHaveBeenCalledWith("-222", 900);
    expect(db.studyPendingCapture.deleteMany).toHaveBeenCalledWith({ where: { batchId: "batch-1" } });
  });
});
