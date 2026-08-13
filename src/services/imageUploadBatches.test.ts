import { ImageUploadBatchStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ nextPublicId: vi.fn() }));
const db = vi.hoisted(() => {
  const client: Record<string, any> = {
    user: { findUnique: vi.fn() },
    pendingImageUpload: {
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    pendingImageUploadBatch: {
      count: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    storedImage: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  };
  client.$transaction = vi.fn(async (operation: unknown) => (
    typeof operation === "function"
      ? (operation as (tx: typeof client) => unknown)(client)
      : Promise.all(operation as Promise<unknown>[])
  ));
  return client;
});

vi.mock("../db/prisma", () => ({ prisma: db }));
vi.mock("./publicIds", () => ({ nextPublicId: mocks.nextPublicId }));

import {
  applyPendingImageUploadBatchCaption,
  hasOpenGroupImageUploadBatch,
  IMAGE_UPLOAD_BATCH_TTL_MS,
  processImageUploadBatches,
  registerImageUploadBatchItem,
  saveImageUploadBatch,
} from "./imageUploadBatches";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-14T01:00:00Z"));
  db.$transaction.mockImplementation(async (operation: unknown) => (
    typeof operation === "function"
      ? (operation as (tx: typeof db) => unknown)(db)
      : Promise.all(operation as Promise<unknown>[])
  ));
  db.pendingImageUpload.findFirst.mockResolvedValue(null);
  db.user.findUnique.mockResolvedValue(null);
  db.pendingImageUploadBatch.count.mockResolvedValue(0);
  db.pendingImageUploadBatch.findUnique.mockResolvedValue(null);
  db.pendingImageUploadBatch.updateMany.mockResolvedValue({ count: 0 });
  db.pendingImageUploadBatch.deleteMany.mockResolvedValue({ count: 0 });
  db.pendingImageUpload.updateMany.mockResolvedValue({ count: 0 });
  db.pendingImageUpload.deleteMany.mockResolvedValue({ count: 0 });
});

describe("durable general image upload batches", () => {
  it("continues only the exact open album owned by an ordinary group", async () => {
    db.user.findUnique.mockResolvedValue({ id: "group-user-1" });
    db.pendingImageUploadBatch.count.mockResolvedValue(1);

    await expect(hasOpenGroupImageUploadBatch("-100456", "album-1")).resolves.toBe(true);

    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { telegramId: "chat:-100456" },
      select: { id: true },
    });
    expect(db.pendingImageUploadBatch.count).toHaveBeenCalledWith({
      where: {
        userId: "group-user-1",
        chatId: "-100456",
        telegramMediaGroupId: "album-1",
        status: { in: [ImageUploadBatchStatus.COLLECTING, ImageUploadBatchStatus.REVIEW] },
        expiresAt: { gt: new Date() },
      },
    });
  });

  it("does not create group state for an unaddressed album without an open batch", async () => {
    await expect(hasOpenGroupImageUploadBatch("-100456", "album-1")).resolves.toBe(false);
    expect(db.pendingImageUploadBatch.count).not.toHaveBeenCalled();
  });

  it("groups Telegram album items by owner, chat, and media-group id", async () => {
    const batch = {
      id: "batch-1",
      token: "batch-token",
      userId: "user-1",
      chatId: "100",
      telegramMediaGroupId: "album-1",
      sharedCaption: null,
      status: ImageUploadBatchStatus.COLLECTING,
    };
    db.pendingImageUploadBatch.upsert.mockResolvedValue(batch);
    db.pendingImageUpload.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "upload-1", ...data, batch }));

    const result = await registerImageUploadBatchItem({
      userId: "user-1",
      chatId: "100",
      telegramMediaGroupId: "album-1",
      sourceMessageId: 41,
      telegramFileId: "file-1",
      telegramUniqueId: "unique-1",
      mediaKind: "photo",
      mimeType: "image/jpeg",
    });

    expect(result.duplicate).toBe(false);
    expect(db.pendingImageUploadBatch.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        userId: "user-1",
        chatId: "100",
        telegramMediaGroupId: "album-1",
        expiresAt: new Date(Date.now() + IMAGE_UPLOAD_BATCH_TTL_MS),
      }),
    }));
    expect(db.pendingImageUpload.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ batchId: "batch-1", batchPosition: 41, sourceMessageId: 41 }),
    }));
  });

  it("returns the existing item when Telegram redelivers the same album message", async () => {
    const duplicate = { id: "upload-1", batch: { id: "batch-1", token: "batch-token" } };
    db.pendingImageUpload.findFirst.mockResolvedValue(duplicate);
    const result = await registerImageUploadBatchItem({
      userId: "user-1",
      chatId: "100",
      telegramMediaGroupId: "album-1",
      sourceMessageId: 41,
      telegramFileId: "file-1",
      mediaKind: "photo",
    });
    expect(result).toEqual({ batch: duplicate.batch, upload: duplicate, duplicate: true });
    expect(db.pendingImageUploadBatch.upsert).not.toHaveBeenCalled();
  });

  it("publishes exactly one review surface after the album settles", async () => {
    const now = new Date();
    const candidate = {
      id: "batch-1",
      token: "batch-token",
      chatId: "100",
      status: ImageUploadBatchStatus.COLLECTING,
      readyAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      reviewMessageId: null,
    };
    db.pendingImageUploadBatch.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([candidate]);
    db.pendingImageUploadBatch.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    db.pendingImageUploadBatch.findUnique.mockResolvedValue({
      ...candidate,
      uploads: [{ id: "upload-1" }, { id: "upload-2" }],
      sharedCaption: "Lecture diagrams",
    });
    const bot = {
      api: {
        sendMessage: vi.fn().mockResolvedValue({ message_id: 900 }),
        deleteMessage: vi.fn(),
      },
    } as any;

    await processImageUploadBatches(bot, now);

    expect(bot.api.sendMessage).toHaveBeenCalledTimes(1);
    expect(bot.api.sendMessage).toHaveBeenCalledWith("100", expect.stringContaining("2 images received"), expect.objectContaining({
      reply_markup: expect.objectContaining({ inline_keyboard: expect.any(Array) }),
    }));
    expect(db.pendingImageUploadBatch.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: ImageUploadBatchStatus.REVIEW, reviewMessageId: 900 }),
    }));
  });

  it("applies one shared caption to every pending image", async () => {
    db.pendingImageUploadBatch.findFirst.mockResolvedValue({
      id: "batch-1",
      token: "batch-token",
      userId: "user-1",
      awaitingCaption: true,
      status: ImageUploadBatchStatus.REVIEW,
    });
    db.pendingImageUploadBatch.update.mockResolvedValue({});
    db.pendingImageUploadBatch.findFirst.mockResolvedValueOnce({
      id: "batch-1",
      token: "batch-token",
      userId: "user-1",
      awaitingCaption: true,
      status: ImageUploadBatchStatus.REVIEW,
    }).mockResolvedValueOnce({
      id: "batch-1",
      token: "batch-token",
      sharedCaption: "Week 2 diagrams",
      uploads: [{ id: "upload-1" }, { id: "upload-2" }],
    });

    const result = await applyPendingImageUploadBatchCaption("user-1", "Week 2 diagrams");

    expect(result?.sharedCaption).toBe("Week 2 diagrams");
    expect(db.pendingImageUpload.updateMany).toHaveBeenCalledWith({
      where: { batchId: "batch-1" },
      data: { caption: "Week 2 diagrams" },
    });
  });

  it("saves the entire batch in one transaction and gives every new image the shared caption", async () => {
    db.pendingImageUploadBatch.findFirst.mockResolvedValue({
      id: "batch-1",
      token: "batch-token",
      userId: "user-1",
      status: ImageUploadBatchStatus.REVIEW,
      leaseExpiresAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    db.pendingImageUploadBatch.updateMany.mockResolvedValue({ count: 1 });
    db.pendingImageUploadBatch.findUniqueOrThrow.mockResolvedValue({
      id: "batch-1",
      sharedCaption: "Week 2 diagrams",
      uploads: [
        { id: "upload-1", telegramFileId: "file-1", telegramUniqueId: "unique-1", mediaKind: "photo", mimeType: "image/jpeg", fileName: null, caption: null },
        { id: "upload-2", telegramFileId: "file-2", telegramUniqueId: "unique-2", mediaKind: "photo", mimeType: "image/jpeg", fileName: null, caption: null },
      ],
    });
    db.storedImage.findFirst.mockResolvedValue(null);
    mocks.nextPublicId.mockResolvedValueOnce("IMG-1").mockResolvedValueOnce("IMG-2");
    db.storedImage.create
      .mockResolvedValueOnce({ publicId: "IMG-1", caption: "Week 2 diagrams" })
      .mockResolvedValueOnce({ publicId: "IMG-2", caption: "Week 2 diagrams" });
    db.pendingImageUploadBatch.update.mockResolvedValue({});

    const result = await saveImageUploadBatch("user-1", "batch-token");

    expect(result.images.map((image) => image.publicId)).toEqual(["IMG-1", "IMG-2"]);
    expect(db.storedImage.create).toHaveBeenCalledTimes(2);
    expect(db.storedImage.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({ caption: "Week 2 diagrams" }),
    }));
    expect(db.pendingImageUpload.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-1", batchId: "batch-1" } });
    expect(db.pendingImageUploadBatch.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: ImageUploadBatchStatus.COMPLETED }),
    }));
  });
});
