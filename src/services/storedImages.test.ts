import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  storedImage: { findFirst: vi.fn(), findFirstOrThrow: vi.fn(), update: vi.fn((args: unknown) => args), delete: vi.fn() },
  pendingImageUpload: { findFirstOrThrow: vi.fn(), delete: vi.fn((args: unknown) => args) },
  $transaction: vi.fn(async (operations: unknown[]) => [{ id: "img-1", publicId: "IMG-1", archivedAt: null }, operations[1]]),
}));
vi.mock("../db/prisma", () => ({ prisma: db }));

import { deleteStoredImage, savePendingImageUpload } from "./storedImages";

describe("stored image deletion", () => {
  beforeEach(() => vi.clearAllMocks());

  it("archives instead of deleting, so the IMG id is never reused", async () => {
    db.storedImage.findFirstOrThrow.mockResolvedValue({ id: "img-1", publicId: "IMG-1" });

    await deleteStoredImage("user-1", "img-1");

    expect(db.storedImage.findFirstOrThrow).toHaveBeenCalledWith({ where: { id: "img-1", userId: "user-1", archivedAt: null } });
    expect(db.storedImage.update).toHaveBeenCalledWith({ where: { id: "img-1" }, data: { archivedAt: expect.any(Date) } });
    expect(db.storedImage.delete).not.toHaveBeenCalled();
  });

  it("ignores a deleted copy when the same file is sent again, so the new save is not swallowed", async () => {
    db.pendingImageUpload.findFirstOrThrow.mockResolvedValue({ id: "pending-1", telegramUniqueId: "uniq-1" });
    db.storedImage.findFirst.mockResolvedValue(null);

    await savePendingImageUpload("user-1", "pending-1").catch(() => undefined);

    expect(db.storedImage.findFirst).toHaveBeenCalledWith({ where: { userId: "user-1", telegramUniqueId: "uniq-1", archivedAt: null } });
    expect(db.storedImage.update).not.toHaveBeenCalled();
  });
});
