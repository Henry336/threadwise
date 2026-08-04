import {
  FileCourierJobKind,
  FileCourierJobStatus,
  Prisma
} from "@prisma/client";
import { prisma } from "../db/prisma";
import { FILE_COURIER_RESULT_LIMIT } from "./fileCourierPolicy";

const FILE_COURIER_RESULT_ORDER: Prisma.FileCourierResultOrderByWithRelationInput[] = [
  { modifiedAt: "desc" },
  { fileName: "asc" },
  { parentPath: "asc" },
  { id: "asc" }
];

export type FileCourierScope = {
  ownerTelegramId: string;
  telegramChatId: string;
};

export type FileCourierResultInput = {
  absolutePath: string;
  fileName: string;
  parentPath: string;
  sizeBytes: number;
  modifiedAt: string;
  identityKey: string;
  mimeType?: string;
  fileType: string;
};

export type FileCourierJobWithResults = Prisma.FileCourierJobGetPayload<{
  include: { results: true };
}>;

export function isFileCourierActor(
  actor: { telegramUserId?: string; telegramChatId?: string },
  scope: FileCourierScope
): boolean {
  return actor.telegramUserId === scope.ownerTelegramId
    && actor.telegramChatId === scope.telegramChatId;
}

export function fileCourierJobCanBeClaimed(
  status: FileCourierJobStatus,
  leaseExpiresAt: Date | null,
  now = new Date()
): boolean {
  return status === FileCourierJobStatus.PENDING
    || (
      status === FileCourierJobStatus.RUNNING
      && Boolean(leaseExpiresAt && leaseExpiresAt.getTime() < now.getTime())
    );
}

export async function queueFileCourierLookup(input: {
  scope: FileCourierScope;
  requesterTelegramId: string;
  telegramRequestMessageId?: number;
  kind: "SEARCH" | "RECENT" | "LOOKUP";
  query?: string;
  sortLatest?: boolean;
}): Promise<FileCourierJobWithResults> {
  const query = cleanOptional(input.query, 2_000);
  if (input.kind !== "RECENT" && !query) {
    throw new Error("A file search or lookup requires a query.");
  }
  const job = await prisma.fileCourierJob.create({
    data: {
      ...input.scope,
      requesterTelegramId: input.requesterTelegramId,
      telegramRequestMessageId: input.telegramRequestMessageId,
      kind: FileCourierJobKind[input.kind],
      query,
      sortLatest: Boolean(input.sortLatest)
    },
    include: { results: true }
  });
  await recordFileCourierAudit(job.id, "QUEUED", "PENDING", {
    kind: input.kind,
    sortLatest: Boolean(input.sortLatest)
  });
  return job;
}

export async function queueFileCourierSend(input: {
  scope: FileCourierScope;
  requesterTelegramId: string;
  resultId: string;
  telegramRequestMessageId?: number;
}): Promise<FileCourierJobWithResults | undefined> {
  return (await prisma.$transaction(async (tx) => {
    const result = await tx.fileCourierResult.findFirst({
      where: {
        id: input.resultId,
        job: {
          ...input.scope,
          requesterTelegramId: input.requesterTelegramId,
          status: FileCourierJobStatus.COMPLETED
        }
      }
    });
    if (!result) return undefined;

    const existing = await tx.fileCourierJob.findFirst({
      where: {
        ...input.scope,
        requesterTelegramId: input.requesterTelegramId,
        kind: FileCourierJobKind.SEND,
        selectedIdentityKey: result.identityKey,
        status: { in: [FileCourierJobStatus.PENDING, FileCourierJobStatus.RUNNING] }
      },
      include: { results: true }
    });
    if (existing) return existing;

    const job = await tx.fileCourierJob.create({
      data: {
        ...input.scope,
        requesterTelegramId: input.requesterTelegramId,
        telegramRequestMessageId: input.telegramRequestMessageId,
        kind: FileCourierJobKind.SEND,
        selectedPath: result.absolutePath,
        selectedFileName: result.fileName,
        selectedParentPath: result.parentPath,
        selectedSizeBytes: result.sizeBytes,
        selectedModifiedAt: result.modifiedAt,
        selectedIdentityKey: result.identityKey,
        selectedMimeType: result.mimeType,
        selectedFileType: result.fileType
      },
      include: { results: true }
    });
    await tx.fileCourierAudit.create({
      data: {
        jobId: job.id,
        action: "SEND_REQUESTED",
        status: "PENDING",
        details: { sourceResultId: result.id }
      }
    });
    return job;
  })) ?? undefined;
}

export async function claimFileCourierJob(
  scope: FileCourierScope,
  workerId: string,
  leaseSeconds: number
): Promise<FileCourierJobWithResults | undefined> {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1_000);
  return (await prisma.$transaction(async (tx) => {
    const candidate = await tx.fileCourierJob.findFirst({
      where: {
        ...scope,
        OR: [
          { status: FileCourierJobStatus.PENDING },
          { status: FileCourierJobStatus.RUNNING, leaseExpiresAt: { lt: now } }
        ]
      },
      orderBy: { createdAt: "asc" }
    });
    if (!candidate || !fileCourierJobCanBeClaimed(candidate.status, candidate.leaseExpiresAt, now)) {
      return undefined;
    }

    const claimed = await tx.fileCourierJob.updateMany({
      where: {
        id: candidate.id,
        ...scope,
        OR: [
          { status: FileCourierJobStatus.PENDING },
          { status: FileCourierJobStatus.RUNNING, leaseExpiresAt: { lt: now } }
        ]
      },
      data: {
        status: FileCourierJobStatus.RUNNING,
        workerId,
        claimedAt: now,
        startedAt: candidate.startedAt ?? now,
        leaseExpiresAt,
        error: null
      }
    });
    if (claimed.count === 0) return undefined;
    await tx.fileCourierAudit.create({
      data: {
        jobId: candidate.id,
        action: candidate.startedAt ? "RECLAIMED" : "CLAIMED",
        status: "RUNNING",
        details: { workerId }
      }
    });
    return tx.fileCourierJob.findUnique({
      where: { id: candidate.id },
      include: { results: true }
    });
  })) ?? undefined;
}

export async function completeFileCourierLookup(input: {
  scope: FileCourierScope;
  jobId: string;
  workerId: string;
  results: FileCourierResultInput[];
}): Promise<FileCourierJobWithResults | undefined> {
  const prepared = input.results.slice(0, FILE_COURIER_RESULT_LIMIT).map(normalizeResult);
  return (await prisma.$transaction(async (tx) => {
    const job = await tx.fileCourierJob.findFirst({
      where: {
        id: input.jobId,
        ...input.scope,
        workerId: input.workerId,
        status: FileCourierJobStatus.RUNNING,
        kind: { in: [FileCourierJobKind.SEARCH, FileCourierJobKind.RECENT, FileCourierJobKind.LOOKUP] }
      }
    });
    if (!job) return undefined;
    await tx.fileCourierResult.deleteMany({ where: { jobId: job.id } });
    if (prepared.length) {
      await tx.fileCourierResult.createMany({
        data: prepared.map((result) => ({ jobId: job.id, ...result }))
      });
    }
    await tx.fileCourierJob.update({
      where: { id: job.id },
      data: {
        status: FileCourierJobStatus.COMPLETED,
        completedAt: new Date(),
        leaseExpiresAt: null,
        error: null
      }
    });
    await tx.fileCourierAudit.create({
      data: {
        jobId: job.id,
        action: "LOOKUP_COMPLETED",
        status: "COMPLETED",
        details: { resultCount: prepared.length }
      }
    });
    return tx.fileCourierJob.findUnique({
      where: { id: job.id },
      include: { results: { orderBy: FILE_COURIER_RESULT_ORDER } }
    });
  })) ?? undefined;
}

export async function failFileCourierJob(input: {
  scope: FileCourierScope;
  jobId: string;
  workerId: string;
  error: string;
}): Promise<FileCourierJobWithResults | undefined> {
  const updated = await prisma.fileCourierJob.updateMany({
    where: {
      id: input.jobId,
      ...input.scope,
      workerId: input.workerId,
      status: FileCourierJobStatus.RUNNING
    },
    data: {
      status: FileCourierJobStatus.FAILED,
      error: input.error.slice(0, 8_000),
      completedAt: new Date(),
      leaseExpiresAt: null
    }
  });
  if (updated.count === 0) return terminalFileCourierJobForWorker(
    input.scope,
    input.jobId,
    input.workerId
  );
  await recordFileCourierAudit(input.jobId, "FAILED", "FAILED", {
    error: input.error.slice(0, 1_000)
  });
  return findFileCourierJob(input.scope, input.jobId);
}

export async function renewFileCourierJobLease(input: {
  scope: FileCourierScope;
  jobId: string;
  workerId: string;
  leaseSeconds: number;
}): Promise<boolean> {
  const updated = await prisma.fileCourierJob.updateMany({
    where: {
      id: input.jobId,
      ...input.scope,
      workerId: input.workerId,
      status: FileCourierJobStatus.RUNNING
    },
    data: { leaseExpiresAt: new Date(Date.now() + input.leaseSeconds * 1_000) }
  });
  return updated.count === 1;
}

export async function cancelFileCourierJob(
  scope: FileCourierScope,
  jobId: string,
  requesterTelegramId: string
): Promise<"canceled" | "busy" | "missing"> {
  const job = await prisma.fileCourierJob.findFirst({
    where: { id: jobId, ...scope, requesterTelegramId }
  });
  if (!job) return "missing";
  if (job.status !== FileCourierJobStatus.PENDING) return "busy";
  const updated = await prisma.fileCourierJob.updateMany({
    where: { id: job.id, status: FileCourierJobStatus.PENDING },
    data: {
      status: FileCourierJobStatus.CANCELED,
      completedAt: new Date(),
      leaseExpiresAt: null
    }
  });
  if (!updated.count) return "busy";
  await recordFileCourierAudit(job.id, "CANCELED", "CANCELED");
  return "canceled";
}

export async function fileCourierJobForUpload(
  scope: FileCourierScope,
  jobId: string,
  workerId: string
): Promise<FileCourierJobWithResults | undefined> {
  return (await prisma.fileCourierJob.findFirst({
    where: {
      id: jobId,
      ...scope,
      workerId,
      kind: FileCourierJobKind.SEND,
      status: FileCourierJobStatus.RUNNING
    },
    include: { results: true }
  })) ?? undefined;
}

export async function completeFileCourierDelivery(input: {
  scope: FileCourierScope;
  jobId: string;
  workerId: string;
  telegramMessageId: number;
}): Promise<FileCourierJobWithResults | undefined> {
  const updated = await prisma.fileCourierJob.updateMany({
    where: {
      id: input.jobId,
      ...input.scope,
      workerId: input.workerId,
      kind: FileCourierJobKind.SEND,
      status: FileCourierJobStatus.RUNNING
    },
    data: {
      status: FileCourierJobStatus.COMPLETED,
      telegramDeliveryMessageId: input.telegramMessageId,
      completedAt: new Date(),
      deliveredAt: new Date(),
      leaseExpiresAt: null,
      error: null
    }
  });
  if (!updated.count) return undefined;
  await recordFileCourierAudit(input.jobId, "DELIVERED", "COMPLETED", {
    telegramMessageId: input.telegramMessageId
  });
  return findFileCourierJob(input.scope, input.jobId);
}

export async function terminalFileCourierJobForWorker(
  scope: FileCourierScope,
  jobId: string,
  workerId: string
): Promise<FileCourierJobWithResults | undefined> {
  return (await prisma.fileCourierJob.findFirst({
    where: {
      id: jobId,
      ...scope,
      workerId,
      status: {
        in: [
          FileCourierJobStatus.COMPLETED,
          FileCourierJobStatus.FAILED,
          FileCourierJobStatus.CANCELED
        ]
      }
    },
    include: { results: { orderBy: FILE_COURIER_RESULT_ORDER } }
  })) ?? undefined;
}

export async function findFileCourierJob(
  scope: FileCourierScope,
  jobId: string
): Promise<FileCourierJobWithResults | undefined> {
  return (await prisma.fileCourierJob.findFirst({
    where: { id: jobId, ...scope },
    include: { results: { orderBy: FILE_COURIER_RESULT_ORDER } }
  })) ?? undefined;
}

export async function undeliveredFileCourierJobs(
  scope: FileCourierScope,
  completedBefore: Date,
  take = 10
): Promise<FileCourierJobWithResults[]> {
  return prisma.fileCourierJob.findMany({
    where: {
      ...scope,
      status: { in: [FileCourierJobStatus.COMPLETED, FileCourierJobStatus.FAILED] },
      deliveredAt: null,
      completedAt: { lte: completedBefore },
      OR: [
        { kind: { not: FileCourierJobKind.SEND } },
        { kind: FileCourierJobKind.SEND, status: FileCourierJobStatus.FAILED }
      ]
    },
    include: { results: { orderBy: FILE_COURIER_RESULT_ORDER } },
    orderBy: { completedAt: "asc" },
    take
  });
}

export async function markFileCourierJobDelivered(
  scope: FileCourierScope,
  jobId: string,
  telegramMessageId: number
): Promise<void> {
  await prisma.fileCourierJob.updateMany({
    where: { id: jobId, ...scope, deliveredAt: null },
    data: { deliveredAt: new Date(), telegramDeliveryMessageId: telegramMessageId }
  });
}

export async function recordFileCourierAudit(
  jobId: string,
  action: string,
  status: string,
  details?: Record<string, unknown>
): Promise<void> {
  await prisma.fileCourierAudit.create({
    data: {
      jobId,
      action: action.slice(0, 100),
      status: status.slice(0, 80),
      details: details as Prisma.InputJsonValue | undefined
    }
  });
}

function normalizeResult(input: FileCourierResultInput) {
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0) {
    throw new Error("File result size is invalid.");
  }
  const modifiedAt = new Date(input.modifiedAt);
  if (!Number.isFinite(modifiedAt.getTime())) {
    throw new Error("File result timestamp is invalid.");
  }
  const absolutePath = bounded(input.absolutePath, 2_000, "path");
  const fileName = bounded(input.fileName, 500, "filename");
  const parentPath = bounded(input.parentPath, 2_000, "parent path");
  const identityKey = bounded(input.identityKey, 500, "identity");
  const fileType = bounded(input.fileType, 100, "file type");
  return {
    absolutePath,
    fileName,
    parentPath,
    sizeBytes: BigInt(input.sizeBytes),
    modifiedAt,
    identityKey,
    mimeType: cleanOptional(input.mimeType, 200),
    fileType
  };
}

function bounded(value: string, maximum: number, label: string): string {
  const clean = value.trim();
  if (!clean || clean.length > maximum) throw new Error(`File result ${label} is invalid.`);
  return clean;
}

function cleanOptional(value: string | undefined, maximum: number): string | null {
  const clean = value?.trim();
  return clean ? clean.slice(0, maximum) : null;
}
