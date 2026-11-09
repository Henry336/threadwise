/**
 * Stops a captured dashboard service token from being replayed to repeat a write.
 * Called by src/dashboard/route.ts for every POST, PUT, PATCH or DELETE after the token is
 * verified. Each token id (jti) may be used for one mutation; reads are not limited. This closed
 * the JWT replay finding F-02 in docs/SECURITY_PHASE6_ASSURANCE.md.
 */
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

/**
 * Records the token as used by inserting a row keyed by a hash of telegramId and token id.
 * A unique-key conflict (P2002) means the token was already spent, so it throws
 * DashboardRequestReplayError. Only hashes are stored, never the token or the raw Telegram id.
 * The row expires with the token; about 1 in 32 calls also deletes expired rows.
 */
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
  // query to every mutation. Cleanup is best-effort: a maintenance failure must not turn an
  // already-consumed mutation into a false 500 that will replay as a conflict on retry.
  if ((Number.parseInt(fingerprint.slice(0, 2), 16) & 31) === 0) {
    await database.dashboardRequestReplay
      .deleteMany({ where: { expiresAt: { lte: now } } })
      .catch(() => undefined);
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
