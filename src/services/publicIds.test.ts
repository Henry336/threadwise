import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { nextPublicId } from "./publicIds";

function databaseWith(model: "task" | "note" | "idea" | "expense" | "storedImage", publicIds: string[]) {
  return {
    [model]: {
      findMany: vi.fn(async () => publicIds.map((publicId) => ({ publicId })))
    }
  } as unknown as PrismaClient;
}

describe("nextPublicId", () => {
  it("uses the highest numeric suffix so deleting an older row cannot reuse an existing id", async () => {
    const database = databaseWith("task", ["TASK-1", "TASK-3", "TASK-10"]);
    await expect(nextPublicId("user-1", "TASK", database)).resolves.toBe("TASK-11");
    expect(database.task.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", publicId: { startsWith: "TASK-" } },
      select: { publicId: true }
    });
  });

  it("ignores malformed and unrelated ids", async () => {
    const database = databaseWith("expense", ["EXP-2", "EXP-nope", "TASK-99", "EXP-7x"]);
    await expect(nextPublicId("user-1", "EXP", database)).resolves.toBe("EXP-3");
  });

  it("starts at one for a user's first item", async () => {
    const database = databaseWith("storedImage", []);
    await expect(nextPublicId("user-1", "IMG", database)).resolves.toBe("IMG-1");
  });
});
