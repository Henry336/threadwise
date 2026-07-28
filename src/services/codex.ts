import { CodexJobStatus, Prisma, type CodexProject } from "@prisma/client";
import { prisma } from "../db/prisma";

export type CodexScope = {
  ownerTelegramId: string;
  telegramChatId: string;
};

export type DiscoveredCodexProject = {
  path: string;
  lastSeenAt?: string;
};

export type CodexJobWithProject = Prisma.CodexJobGetPayload<{
  include: { project: true; attachments: true };
}>;

export type CodexAttachmentInput = {
  kind: "image" | "file";
  telegramFileId: string;
  telegramFileUniqueId?: string;
  fileName: string;
  mimeType?: string;
  fileSize?: number;
};

export function isPrivateCodexActor(
  actual: { telegramUserId?: string; telegramChatId?: string },
  expected: CodexScope | undefined
): boolean {
  return Boolean(
    expected
    && actual.telegramUserId === expected.ownerTelegramId
    && actual.telegramChatId === expected.telegramChatId
  );
}

export function isPrivateCodexReportActor(
  actual: { telegramUserId?: string; telegramChatId?: string; chatType?: string },
  expected: CodexScope | undefined
): boolean {
  if (!expected || actual.telegramUserId !== expected.ownerTelegramId) return false;
  return actual.telegramChatId === expected.telegramChatId
    || (actual.chatType === "private" && actual.telegramChatId === expected.ownerTelegramId);
}

export function projectAlias(path: string): string {
  const basename = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "project";
  return basename
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "project";
}

export async function syncCodexProjects(scope: CodexScope, discovered: DiscoveredCodexProject[]): Promise<CodexProject[]> {
  const unique = uniqueProjectPaths(discovered);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.codexProject.findMany({
      where: scope,
      orderBy: [{ lastSeenAt: "desc" }, { alias: "asc" }]
    });
    const byPath = new Map(existing.map((project) => [project.path.toLowerCase(), project]));
    const aliases = new Set(existing.map((project) => project.alias.toLowerCase()));

    await tx.codexProject.updateMany({
      where: scope,
      data: { enabled: false }
    });

    for (const item of unique) {
      const matched = byPath.get(item.path.toLowerCase());
      const lastSeenAt = validDate(item.lastSeenAt) ?? new Date();
      if (matched) {
        await tx.codexProject.update({
          where: { id: matched.id },
          data: { path: item.path, enabled: true, lastSeenAt }
        });
        continue;
      }

      const alias = uniqueAlias(projectAlias(item.path), aliases);
      aliases.add(alias);
      const created = await tx.codexProject.create({
        data: { ...scope, alias, path: item.path, enabled: true, lastSeenAt }
      });
      byPath.set(item.path.toLowerCase(), created);
    }

    return tx.codexProject.findMany({
      where: { ...scope, enabled: true },
      orderBy: [{ lastSeenAt: "desc" }, { alias: "asc" }]
    });
  });
}

export async function listCodexProjects(scope: CodexScope): Promise<{
  projects: CodexProject[];
  activeProjectId?: string;
}> {
  const [projects, state] = await Promise.all([
    prisma.codexProject.findMany({
      where: { ...scope, enabled: true },
      orderBy: [{ lastSeenAt: "desc" }, { alias: "asc" }]
    }),
    prisma.codexChatState.findUnique({
      where: { ownerTelegramId_telegramChatId: scope }
    })
  ]);
  return { projects, activeProjectId: state?.activeProjectId ?? undefined };
}

export async function selectCodexProject(scope: CodexScope, alias: string): Promise<CodexProject | undefined> {
  const project = await prisma.codexProject.findFirst({
    where: {
      ...scope,
      enabled: true,
      alias: { equals: alias.trim(), mode: "insensitive" }
    }
  });
  if (!project) return undefined;

  await prisma.codexChatState.upsert({
    where: { ownerTelegramId_telegramChatId: scope },
    create: { ...scope, activeProjectId: project.id },
    update: { activeProjectId: project.id }
  });
  return project;
}

export async function selectCodexProjectById(scope: CodexScope, projectId: string): Promise<CodexProject | undefined> {
  const project = await prisma.codexProject.findFirst({
    where: { id: projectId, ...scope, enabled: true }
  });
  if (!project) return undefined;
  await prisma.codexChatState.upsert({
    where: { ownerTelegramId_telegramChatId: scope },
    create: { ...scope, activeProjectId: project.id },
    update: { activeProjectId: project.id }
  });
  return project;
}

export async function findCodexProject(scope: CodexScope, alias?: string): Promise<CodexProject | undefined> {
  if (alias) {
    return (await prisma.codexProject.findFirst({
      where: {
        ...scope,
        enabled: true,
        alias: { equals: alias.trim(), mode: "insensitive" }
      }
    })) ?? undefined;
  }

  const state = await prisma.codexChatState.findUnique({
    where: { ownerTelegramId_telegramChatId: scope },
    include: { activeProject: true }
  });
  return state?.activeProject?.enabled ? state.activeProject : undefined;
}

export async function findCodexReplyJob(scope: CodexScope, messageId: number): Promise<CodexJobWithProject | undefined> {
  const mapping = await prisma.codexJobMessage.findUnique({
    where: {
      chatId_messageId: {
        chatId: scope.telegramChatId,
        messageId
      }
    },
    include: {
      job: { include: { project: true, attachments: true } }
    }
  });
  if (!mapping || mapping.job.ownerTelegramId !== scope.ownerTelegramId) return undefined;
  return mapping.job;
}

export async function queueCodexJob(input: {
  scope: CodexScope;
  project: CodexProject;
  prompt: string;
  telegramRequestMessageId?: number;
  model?: string;
  reasoningEffort?: string;
  attachments?: CodexAttachmentInput[];
  replyToJob?: CodexJobWithProject;
  forceNewThread?: boolean;
}): Promise<CodexJobWithProject> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("Codex prompt cannot be empty.");

  const job = await prisma.codexJob.create({
    data: {
      ...input.scope,
      projectId: input.project.id,
      prompt,
      telegramRequestMessageId: input.telegramRequestMessageId,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      threadId: input.forceNewThread ? null : input.replyToJob?.threadId,
      replyToJobId: input.replyToJob?.id,
      attachments: input.attachments?.length ? { create: input.attachments } : undefined
    },
    include: { project: true, attachments: true }
  });

  await prisma.codexChatState.upsert({
    where: { ownerTelegramId_telegramChatId: input.scope },
    create: { ...input.scope, activeProjectId: input.project.id },
    update: { activeProjectId: input.project.id }
  });

  return job;
}

export async function recentCodexJobs(scope: CodexScope, take = 5): Promise<CodexJobWithProject[]> {
  return prisma.codexJob.findMany({
    where: scope,
    include: { project: true, attachments: true },
    orderBy: { createdAt: "desc" },
    take
  });
}

export async function claimCodexJob(scope: CodexScope, workerId: string, leaseSeconds: number): Promise<CodexJobWithProject | undefined> {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1_000);

  return (await prisma.$transaction(async (tx) => {
    const candidate = await tx.codexJob.findFirst({
      where: {
        ...scope,
        OR: [
          { status: CodexJobStatus.PENDING },
          { status: CodexJobStatus.RUNNING, leaseExpiresAt: { lt: now } }
        ]
      },
      orderBy: { createdAt: "asc" }
    });
    if (!candidate) return undefined;

    const claimed = await tx.codexJob.updateMany({
      where: {
        id: candidate.id,
        ...scope,
        OR: [
          { status: CodexJobStatus.PENDING },
          { status: CodexJobStatus.RUNNING, leaseExpiresAt: { lt: now } }
        ]
      },
      data: {
        status: CodexJobStatus.RUNNING,
        workerId,
        claimedAt: now,
        startedAt: candidate.startedAt ?? now,
        leaseExpiresAt,
        error: null
      }
    });
    if (claimed.count === 0) return undefined;

    return (await tx.codexJob.findUnique({
      where: { id: candidate.id },
      include: { project: true, attachments: true }
    })) ?? undefined;
  })) ?? undefined;
}

export async function completeCodexJob(input: {
  scope: CodexScope;
  id: string;
  workerId: string;
  finalResponse: string;
  threadId?: string;
}): Promise<CodexJobWithProject | undefined> {
  const updated = await prisma.codexJob.updateMany({
    where: { id: input.id, ...input.scope, workerId: input.workerId, status: CodexJobStatus.RUNNING },
    data: {
      status: CodexJobStatus.COMPLETED,
      finalResponse: input.finalResponse,
      threadId: input.threadId,
      error: null,
      completedAt: new Date(),
      leaseExpiresAt: null
    }
  });
  if (updated.count === 0) return undefined;
  return (await prisma.codexJob.findUnique({
    where: { id: input.id },
    include: { project: true, attachments: true }
  })) ?? undefined;
}

export async function completedCodexJobForWorker(
  scope: CodexScope,
  id: string,
  workerId: string
): Promise<CodexJobWithProject | undefined> {
  return (await prisma.codexJob.findFirst({
    where: {
      id,
      ...scope,
      workerId,
      status: { in: [CodexJobStatus.COMPLETED, CodexJobStatus.FAILED] }
    },
    include: { project: true, attachments: true }
  })) ?? undefined;
}

export async function failCodexJob(input: {
  scope: CodexScope;
  id: string;
  workerId: string;
  error: string;
  threadId?: string;
}): Promise<CodexJobWithProject | undefined> {
  const updated = await prisma.codexJob.updateMany({
    where: { id: input.id, ...input.scope, workerId: input.workerId, status: CodexJobStatus.RUNNING },
    data: {
      status: CodexJobStatus.FAILED,
      error: input.error.slice(0, 8_000),
      threadId: input.threadId,
      completedAt: new Date(),
      leaseExpiresAt: null
    }
  });
  if (updated.count === 0) return undefined;
  return (await prisma.codexJob.findUnique({
    where: { id: input.id },
    include: { project: true, attachments: true }
  })) ?? undefined;
}

export async function findCodexJobByReference(scope: CodexScope, reference: string): Promise<CodexJobWithProject | undefined> {
  const jobs = await prisma.codexJob.findMany({
    where: {
      ...scope,
      id: { startsWith: reference.trim(), mode: "insensitive" }
    },
    include: { project: true, attachments: true },
    orderBy: { createdAt: "desc" },
    take: 2
  });
  return jobs.length === 1 ? jobs[0] : undefined;
}

export async function codexJobForReport(scope: CodexScope, jobId: string): Promise<CodexJobWithProject | undefined> {
  return (await prisma.codexJob.findFirst({
    where: { id: jobId, ...scope },
    include: { project: true, attachments: true }
  })) ?? undefined;
}

export async function codexAttachmentForWorker(scope: CodexScope, attachmentId: string, workerId: string) {
  return (await prisma.codexJobAttachment.findFirst({
    where: {
      id: attachmentId,
      job: { ...scope, workerId, status: CodexJobStatus.RUNNING }
    }
  })) ?? undefined;
}

export async function renewCodexJobLease(input: {
  scope: CodexScope;
  id: string;
  workerId: string;
  leaseSeconds: number;
}): Promise<boolean> {
  const updated = await prisma.codexJob.updateMany({
    where: {
      id: input.id,
      ...input.scope,
      workerId: input.workerId,
      status: CodexJobStatus.RUNNING
    },
    data: {
      leaseExpiresAt: new Date(Date.now() + input.leaseSeconds * 1_000)
    }
  });
  return updated.count === 1;
}

export async function undeliveredCodexJobs(
  scope: CodexScope,
  completedBefore: Date,
  take = 10
): Promise<CodexJobWithProject[]> {
  return prisma.codexJob.findMany({
    where: {
      ...scope,
      status: { in: [CodexJobStatus.COMPLETED, CodexJobStatus.FAILED] },
      deliveredAt: null,
      completedAt: { lte: completedBefore }
    },
    include: { project: true, attachments: true },
    orderBy: { completedAt: "asc" },
    take
  });
}

export async function codexJobHasReportMessage(jobId: string): Promise<boolean> {
  return Boolean(await prisma.codexJobMessage.findFirst({
    where: { jobId },
    select: { id: true }
  }));
}

export async function recordCodexReportMessage(jobId: string, chatId: string, messageId: number): Promise<void> {
  await prisma.codexJobMessage.create({
    data: { jobId, chatId, messageId }
  });
}

export async function markCodexJobDelivered(jobId: string): Promise<void> {
  await prisma.codexJob.update({
    where: { id: jobId },
    data: { deliveredAt: new Date() }
  });
}

export function splitTelegramReport(text: string, maxLength = 3_900): string[] {
  if (!text) return [""];
  const codePoints = Array.from(text);
  const chunks: string[] = [];
  for (let offset = 0; offset < codePoints.length; offset += maxLength) {
    chunks.push(codePoints.slice(offset, offset + maxLength).join(""));
  }
  return chunks;
}

function uniqueProjectPaths(items: DiscoveredCodexProject[]): DiscoveredCodexProject[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const path = item.path.trim().replace(/[\\/]+$/, "");
    const key = path.toLowerCase();
    if (!path || seen.has(key)) return false;
    seen.add(key);
    item.path = path;
    return true;
  });
}

function uniqueAlias(base: string, aliases: Set<string>): string {
  if (!aliases.has(base)) return base;
  let suffix = 2;
  while (aliases.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function validDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
