import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteDashboardPersonalNoteDraft,
  getDashboardPersonalNoteDraft,
  saveDashboardPersonalNoteDraft,
} from "./personalNoteDrafts";
import { personalNoteDraftSaveSchema } from "./schemas";

const mocks = {
  user: { findUnique: vi.fn() },
  note: { findFirst: vi.fn() },
  personalNoteDraft: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
};
const database = mocks as unknown as PrismaClient;
const user = { id: "user-1", telegramId: "123456789", settings: { timezone: "Asia/Singapore" } };
const noteUpdatedAt = new Date("2026-08-31T00:00:00.000Z");
const baseDraft = {
  id: "draft-1",
  userId: user.id,
  draftKey: "new",
  noteId: null,
  noteUpdatedAt: null,
  title: "Draft",
  body: "Body",
  revision: 1,
  expiresAt: new Date("2026-09-07T00:00:00.000Z"),
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.findUnique.mockResolvedValue(user);
  mocks.note.findFirst.mockResolvedValue({ id: "note-1", userId: user.id, updatedAt: noteUpdatedAt });
  mocks.personalNoteDraft.deleteMany.mockResolvedValue({ count: 0 });
});

describe("cross-device Personal note drafts", () => {
  it("loads only the owner's current unexpired draft", async () => {
    mocks.personalNoteDraft.findFirst.mockResolvedValue(baseDraft);

    await expect(getDashboardPersonalNoteDraft(user.telegramId, {}, database)).resolves.toEqual(baseDraft);
    expect(mocks.personalNoteDraft.findFirst).toHaveBeenCalledWith({ where: {
      userId: user.id,
      draftKey: "new",
      expiresAt: { gt: expect.any(Date) },
    } });
  });

  it("creates revision zero once and updates only the expected revision", async () => {
    mocks.personalNoteDraft.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(baseDraft);
    mocks.personalNoteDraft.create.mockResolvedValue(baseDraft);
    mocks.personalNoteDraft.updateMany.mockResolvedValue({ count: 1 });
    mocks.personalNoteDraft.findUniqueOrThrow.mockResolvedValue({ ...baseDraft, body: "After", revision: 2 });

    await expect(saveDashboardPersonalNoteDraft(user.telegramId, {
      title: "Draft", body: "Body", expectedRevision: 0,
    }, database)).resolves.toEqual(baseDraft);
    await expect(saveDashboardPersonalNoteDraft(user.telegramId, {
      title: "Draft", body: "After", expectedRevision: 1,
    }, database)).resolves.toMatchObject({ body: "After", revision: 2 });
    expect(mocks.personalNoteDraft.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: user.id, revision: 1 }),
      data: expect.objectContaining({ revision: { increment: 1 } }),
    }));
  });

  it("rejects stale saved notes and cross-owner draft deletion", async () => {
    await expect(saveDashboardPersonalNoteDraft(user.telegramId, {
      noteId: "note-1",
      noteUpdatedAt: "2026-08-30T00:00:00.000Z",
      title: "Old",
      body: "Old",
      expectedRevision: 0,
    }, database)).rejects.toMatchObject({ name: "DashboardConflictError" });

    mocks.personalNoteDraft.deleteMany.mockResolvedValue({ count: 0 });
    await expect(deleteDashboardPersonalNoteDraft(user.telegramId, "someone-elses-draft", database))
      .rejects.toMatchObject({ name: "DashboardItemNotFoundError" });
  });

  it("requires the saved note revision and caps unfinished content", () => {
    expect(() => personalNoteDraftSaveSchema.parse({
      noteId: "0c68a350-c061-4a86-a63f-842c132dc77d",
      title: "Draft",
      body: "Body",
      expectedRevision: 0,
    })).toThrow();
    expect(() => personalNoteDraftSaveSchema.parse({
      title: "Draft",
      body: "x".repeat(100_001),
      expectedRevision: 0,
    })).toThrow();
  });
});
