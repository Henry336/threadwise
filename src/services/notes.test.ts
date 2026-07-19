import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirstOrThrow: vi.fn()
}));

vi.mock("../db/prisma", () => ({
  prisma: {
    note: {
      findFirstOrThrow: mocks.findFirstOrThrow
    }
  }
}));

import { findNote } from "./notes";

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
});
