import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  DashboardRequestReplayError,
  consumeDashboardMutationToken,
} from "./dashboardRequestReplay";

const principal = {
  telegramId: "123456789",
  tokenId: "request-1",
  expiresAt: new Date("2026-08-18T05:01:00.000Z"),
};

describe("dashboard mutation replay protection", () => {
  it("does not consume a token used for a safe read", async () => {
    const database = replayDatabase();

    await consumeDashboardMutationToken(principal, "GET", "snapshot", database as never);

    expect(database.dashboardRequestReplay.create).not.toHaveBeenCalled();
  });

  it("stores only hashed replay and principal fingerprints for mutations", async () => {
    const database = replayDatabase();

    await consumeDashboardMutationToken(principal, "POST", "create_task", database as never);

    expect(database.dashboardRequestReplay.create).toHaveBeenCalledWith({
      data: {
        fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        principalFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        operation: "create_task",
        expiresAt: principal.expiresAt,
      },
    });
    expect(JSON.stringify(database.dashboardRequestReplay.create.mock.calls)).not.toContain(principal.tokenId);
    expect(JSON.stringify(database.dashboardRequestReplay.create.mock.calls)).not.toContain(principal.telegramId);
  });

  it("rejects a JTI that the shared store reports as already consumed", async () => {
    const database = replayDatabase();
    database.dashboardRequestReplay.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" }),
    );

    await expect(consumeDashboardMutationToken(
      principal,
      "PATCH",
      "update_task",
      database as never,
    )).rejects.toBeInstanceOf(DashboardRequestReplayError);
  });
});

function replayDatabase() {
  return {
    dashboardRequestReplay: {
      create: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
}
