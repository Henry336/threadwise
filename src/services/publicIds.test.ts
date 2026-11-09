import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { fakePrisma } from "../test/builders";
import { createWithPublicId, nextPublicId } from "./publicIds";

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

describe("createWithPublicId", () => {
  it("reads the id inside the transaction and retries once a concurrent create took it", async () => {
    const taken = ["NOTE-1"];
    const tx = { note: { findMany: vi.fn(async () => taken.map((publicId) => ({ publicId }))) } };
    const database = fakePrisma({}, tx) as unknown as PrismaClient;
    const create = vi.fn(async (_tx: unknown, publicId: string) => {
      if (create.mock.calls.length === 1) {
        taken.push("NOTE-2"); // another request committed NOTE-2 first
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002", meta: { target: ["userId", "publicId"] } });
      }
      return publicId;
    });

    await expect(createWithPublicId("user-1", "NOTE", create, database)).resolves.toBe("NOTE-3");
    expect(create.mock.calls.map((call) => call[1])).toEqual(["NOTE-2", "NOTE-3"]);
    expect(create.mock.calls[0]?.[0]).toBe(tx);
  });

  it("does not retry unrelated failures", async () => {
    const database = fakePrisma({}, { note: { findMany: vi.fn(async () => []) } }) as unknown as PrismaClient;
    const create = vi.fn(async () => { throw new Error("database down"); });

    await expect(createWithPublicId("user-1", "NOTE", create, database)).rejects.toThrow("database down");
    expect(create).toHaveBeenCalledTimes(1);
  });
});
