import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirstOrThrow: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn()
}));

vi.mock("../db/prisma", () => ({
  prisma: {
    note: {
      findFirstOrThrow: mocks.findFirstOrThrow,
      findFirst: mocks.findFirst,
      findMany: mocks.findMany
    }
  }
}));

import { findNote, findNoteReference, listRecentNotes } from "./notes";

describe("note references", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirstOrThrow.mockResolvedValue({ id: "note-row-1", publicId: "NOTE-1" });
  });

  it("accepts both public note IDs and row UUIDs used by existing Telegram buttons", async () => {
    await findNote("user-1", "note-row-1");

    expect(mocks.findFirstOrThrow).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        archivedAt: null,
        OR: [{ id: "note-row-1" }, { publicId: "NOTE-ROW-1" }]
      }
    });
  });

  it("sorts starred notes first in the query, so a short list cannot drop an old starred note", async () => {
    mocks.findMany.mockResolvedValue([]);

    await listRecentNotes("user-1", 5);

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", archivedAt: null },
      orderBy: [{ pinnedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: 5
    });
  });

  it("loads only the note at a list number instead of every note", async () => {
    mocks.findFirst.mockResolvedValue({ id: "note-row-3", publicId: "NOTE-3" });

    await expect(findNoteReference("user-1", "3")).resolves.toMatchObject({ publicId: "NOTE-3" });
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ skip: 2 }));
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
