import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import type { DashboardPrincipal } from "../dashboard/auth";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const MAX_OPERATION_LENGTH = 128;

type ReplayDatabase = Pick<typeof prisma, "dashboardRequestReplay">;

export class DashboardRequestReplayError extends Error {
  constructor() {
    super("This dashboard request has already been processed.");
    this.name = "DashboardRequestReplayError";
  }
}

export async function consumeDashboardMutationToken(
  principal: DashboardPrincipal,
  method: string,
  operation: string,
  database: ReplayDatabase = prisma,
  now = new Date(),
): Promise<void> {
  if (!UNSAFE_METHODS.has(method.toUpperCase())) return;

  const fingerprint = digest(`${principal.telegramId}\0${principal.tokenId}`);
  const principalFingerprint = digest(principal.telegramId);
  try {
    await database.dashboardRequestReplay.create({
      data: {
        fingerprint,
        principalFingerprint,
        operation: operation.slice(0, MAX_OPERATION_LENGTH),
        expiresAt: principal.expiresAt,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new DashboardRequestReplayError();
    throw error;
  }

  // Deterministic sampling keeps the short-lived replay table bounded without adding a cleanup
  // query to every mutation. The expiry index makes the sampled deletion cheap.
  if ((Number.parseInt(fingerprint.slice(0, 2), 16) & 31) === 0) {
    await database.dashboardRequestReplay.deleteMany({ where: { expiresAt: { lte: now } } });
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
