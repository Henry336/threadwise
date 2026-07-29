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

export type DiscoveredCodexThread = {
  threadId: string;
  path: string;
  title: string;
  preview?: string;
  source: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type CodexJobWithProject = Prisma.CodexJobGetPayload<{
  include: { project: true; attachments: true };
}>;

export type CodexThreadWithProject = Prisma.CodexThreadGetPayload<{
  include: { project: true };
}>;

export type CodexAttachmentInput = {
  kind: "image" | "file";
  telegramFileId: string;
  telegramFileUniqueId?: string;
  fileName: string;
  mimeType?: string;
  fileSize?: number;
};

export type CodexPublishResultInput = {
  status: "BLOCKED" | "PR_OPEN" | "AUTO_MERGE_ENABLED" | "MERGED";
  branch?: string;
  commitSha?: string;
  prNumber?: number;
  prUrl?: string;
  checks?: string;
  mergeCommitSha?: string;
  blocker?: string;
};

export type CodexPublishAuditInput = {
  eventKey: string;
  action: "COMMIT" | "PUSH" | "PR" | "CHECKS" | "AUTO_MERGE" | "MERGE" | "BLOCKED";
  status: string;
  branch?: string;
  commitSha?: string;
  prNumber?: number;
  prUrl?: string;
  details?: Record<string, unknown>;
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
  if (unique.length === 0) {
    return prisma.codexProject.findMany({
      where: { ...scope, enabled: true },
      orderBy: [{ lastSeenAt: "desc" }, { alias: "asc" }]
    });
  }

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

export async function syncCodexThreads(
  scope: CodexScope,
  discovered: DiscoveredCodexThread[]
): Promise<CodexThreadWithProject[]> {
  const unique = uniqueThreads(discovered);

  return prisma.$transaction(async (tx) => {
    const projects = await tx.codexProject.findMany({ where: { ...scope, enabled: true } });
    const projectsByPath = new Map(projects.map((project) => [normalizedPathKey(project.path), project]));
    const validItems = unique.filter((item) => projectsByPath.has(normalizedPathKey(item.path)));
    const threadIds = validItems.map((item) => item.threadId);

    await tx.codexThread.updateMany({
      where: scope,
      data: { enabled: false }
    });

    const [knownJobs, existingThreads] = threadIds.length > 0
      ? await Promise.all([
          tx.codexJob.findMany({
            where: { ...scope, threadId: { in: threadIds } },
            select: { threadId: true, threadTitle: true, prompt: true },
            orderBy: { createdAt: "desc" }
          }),
          tx.codexThread.findMany({
            where: { id: { in: threadIds }, ...scope }
          })
        ])
      : [[], []];
    const jobByThreadId = new Map<string, typeof knownJobs[number]>();
    for (const job of knownJobs) {
      if (job.threadId && !jobByThreadId.has(job.threadId)) jobByThreadId.set(job.threadId, job);
    }
    const existingById = new Map(existingThreads.map((thread) => [thread.id, thread]));

    for (const item of validItems) {
      const project = projectsByPath.get(normalizedPathKey(item.path))!;
      const knownJob = jobByThreadId.get(item.threadId);
      const existing = existingById.get(item.threadId);
      const isTelegramThread = Boolean(knownJob || existing?.source === "telegram");
      const title = isTelegramThread
        ? knownJob?.threadTitle || existing?.title || taskTitleFromPrompt(knownJob?.prompt || item.preview || item.title)
        : item.title;
      const lastSeenAt = validDate(item.updatedAt) ?? validDate(item.createdAt) ?? new Date();

      await tx.codexThread.upsert({
        where: { id: item.threadId },
        create: {
          id: item.threadId,
          ...scope,
          projectId: project.id,
          title,
          preview: item.preview,
          source: isTelegramThread ? "telegram" : item.source,
          status: item.status,
          enabled: true,
          threadCreatedAt: validDate(item.createdAt),
          threadUpdatedAt: validDate(item.updatedAt),
          lastSeenAt
        },
        update: {
          projectId: project.id,
          title,
          preview: item.preview,
          source: isTelegramThread ? "telegram" : item.source,
          status: item.status,
          enabled: true,
          threadCreatedAt: validDate(item.createdAt),
          threadUpdatedAt: validDate(item.updatedAt),
          lastSeenAt
        }
      });
    }

    const inactiveState = await tx.codexChatState.findUnique({
      where: { ownerTelegramId_telegramChatId: scope },
      include: { activeThread: true }
    });
    if (inactiveState?.activeThread && !inactiveState.activeThread.enabled) {
      await tx.codexChatState.update({
        where: { id: inactiveState.id },
        data: { activeThreadId: null }
      });
    }

    return tx.codexThread.findMany({
      where: { ...scope, enabled: true },
      include: { project: true },
      orderBy: [{ threadUpdatedAt: "desc" }, { lastSeenAt: "desc" }]
    });
  });
}

export async function listCodexProjects(scope: CodexScope): Promise<{
  projects: CodexProject[];
  activeProjectId?: string;
  activeThreadId?: string;
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
  return {
    projects,
    activeProjectId: state?.activeProjectId ?? undefined,
    activeThreadId: state?.activeThreadId ?? undefined
  };
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
    create: { ...scope, activeProjectId: project.id, activeThreadId: null, pendingThreadJobId: null },
    update: { activeProjectId: project.id, activeThreadId: null, pendingThreadJobId: null }
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
    create: { ...scope, activeProjectId: project.id, activeThreadId: null, pendingThreadJobId: null },
    update: { activeProjectId: project.id, activeThreadId: null, pendingThreadJobId: null }
  });
  return project;
}

export async function listCodexThreads(
  scope: CodexScope,
  projectId: string
): Promise<{
  project?: CodexProject;
  threads: CodexThreadWithProject[];
  activeThreadId?: string;
}> {
  const [project, threads, state] = await Promise.all([
    prisma.codexProject.findFirst({ where: { id: projectId, ...scope, enabled: true } }),
    prisma.codexThread.findMany({
      where: {
        ...scope,
        projectId,
        enabled: true,
        source: { in: ["vscode", "cli", "appServer", "unknown", "telegram"] }
      },
      include: { project: true },
      orderBy: [{ threadUpdatedAt: "desc" }, { lastSeenAt: "desc" }]
    }),
    prisma.codexChatState.findUnique({
      where: { ownerTelegramId_telegramChatId: scope }
    })
  ]);
  return { project: project ?? undefined, threads, activeThreadId: state?.activeThreadId ?? undefined };
}

export async function selectCodexThreadById(
  scope: CodexScope,
  threadId: string
): Promise<CodexThreadWithProject | undefined> {
  const thread = await prisma.codexThread.findFirst({
    where: { id: threadId, ...scope, enabled: true, project: { enabled: true } },
    include: { project: true }
  });
  if (!thread) return undefined;
  await prisma.codexChatState.upsert({
    where: { ownerTelegramId_telegramChatId: scope },
    create: { ...scope, activeProjectId: thread.projectId, activeThreadId: thread.id, pendingThreadJobId: null },
    update: { activeProjectId: thread.projectId, activeThreadId: thread.id, pendingThreadJobId: null }
  });
  return thread;
}

export async function clearActiveCodexThread(
  scope: CodexScope,
  projectId: string
): Promise<CodexProject | undefined> {
  const project = await prisma.codexProject.findFirst({
    where: { id: projectId, ...scope, enabled: true }
  });
  if (!project) return undefined;
  await prisma.codexChatState.upsert({
    where: { ownerTelegramId_telegramChatId: scope },
    create: { ...scope, activeProjectId: project.id, activeThreadId: null, pendingThreadJobId: null },
    update: { activeProjectId: project.id, activeThreadId: null, pendingThreadJobId: null }
  });
  return project;
}

export async function findActiveCodexThread(
  scope: CodexScope,
  projectId?: string
): Promise<CodexThreadWithProject | undefined> {
  const state = await prisma.codexChatState.findUnique({
    where: { ownerTelegramId_telegramChatId: scope },
    include: { activeThread: { include: { project: true } } }
  });
  const thread = state?.activeThread;
  if (!thread?.enabled || !thread.project.enabled) return undefined;
  if (projectId && thread.projectId !== projectId) return undefined;
  return thread;
}

export async function findCodexThreadByReference(
  scope: CodexScope,
  reference: string,
  projectId?: string
): Promise<CodexThreadWithProject | undefined> {
  const value = reference.trim().replace(/^["']|["']$/g, "");
  if (!value) return undefined;
  const where = {
    ...scope,
    ...(projectId ? { projectId } : {}),
    enabled: true,
    project: { enabled: true }
  };
  const direct = await prisma.codexThread.findMany({
    where: {
      ...where,
      OR: [
        { id: { startsWith: value, mode: "insensitive" as const } },
        { title: { equals: value, mode: "insensitive" as const } }
      ]
    },
    include: { project: true },
    take: 2
  });
  if (direct.length === 1) return direct[0];
  if (direct.length > 1) return undefined;

  const partial = await prisma.codexThread.findMany({
    where: { ...where, title: { contains: value, mode: "insensitive" } },
    include: { project: true },
    orderBy: [{ threadUpdatedAt: "desc" }, { lastSeenAt: "desc" }],
    take: 2
  });
  return partial.length === 1 ? partial[0] : undefined;
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
  targetThread?: CodexThreadWithProject;
  forceNewThread?: boolean;
  publishRequested?: boolean;
  publishAutoMerge?: boolean;
}): Promise<CodexJobWithProject> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("Codex prompt cannot be empty.");
  const resumedThreadId = input.replyToJob?.threadId ?? input.targetThread?.id;
  const newThread = Boolean(input.forceNewThread || !resumedThreadId);
  const threadTitle = newThread
    ? taskTitleFromPrompt(prompt)
    : input.replyToJob?.threadTitle
      || (input.replyToJob ? taskTitleFromPrompt(input.replyToJob.prompt) : undefined)
      || input.targetThread?.title
      || taskTitleFromPrompt(prompt);
  const knownThread = !newThread && resumedThreadId
    ? input.targetThread ?? await prisma.codexThread.findFirst({
        where: { id: resumedThreadId, ...input.scope, enabled: true },
        include: { project: true }
      }) ?? undefined
    : undefined;

  const job = await prisma.codexJob.create({
    data: {
      ...input.scope,
      projectId: input.project.id,
      prompt,
      telegramRequestMessageId: input.telegramRequestMessageId,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      publishRequested: Boolean(input.publishRequested),
      publishAutoMerge: Boolean(input.publishRequested && input.publishAutoMerge),
      threadId: newThread ? null : resumedThreadId,
      threadTitle,
      newThread,
      replyToJobId: input.replyToJob?.id,
      attachments: input.attachments?.length ? { create: input.attachments } : undefined
    },
    include: { project: true, attachments: true }
  });

  await prisma.codexChatState.upsert({
    where: { ownerTelegramId_telegramChatId: input.scope },
    create: {
      ...input.scope,
      activeProjectId: input.project.id,
      activeThreadId: newThread ? null : knownThread?.id,
      pendingThreadJobId: newThread ? job.id : null
    },
    update: {
      activeProjectId: input.project.id,
      activeThreadId: newThread ? null : knownThread?.id,
      pendingThreadJobId: newThread ? job.id : null
    }
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
  publishResult?: CodexPublishResultInput;
}): Promise<CodexJobWithProject | undefined> {
  const updated = await prisma.codexJob.updateMany({
    where: { id: input.id, ...input.scope, workerId: input.workerId, status: CodexJobStatus.RUNNING },
    data: {
      status: CodexJobStatus.COMPLETED,
      finalResponse: input.finalResponse,
      threadId: input.threadId,
      publishStatus: input.publishResult?.status,
      publishBranch: input.publishResult?.branch,
      publishCommitSha: input.publishResult?.commitSha,
      publishPrNumber: input.publishResult?.prNumber,
      publishPrUrl: input.publishResult?.prUrl,
      publishChecks: input.publishResult?.checks,
      publishMergeCommitSha: input.publishResult?.mergeCommitSha,
      publishBlocker: input.publishResult?.blocker,
      publishCompletedAt: input.publishResult ? new Date() : undefined,
      error: null,
      completedAt: new Date(),
      leaseExpiresAt: null
    }
  });
  if (updated.count === 0) return undefined;
  const job = (await prisma.codexJob.findUnique({
    where: { id: input.id },
    include: { project: true, attachments: true }
  })) ?? undefined;
  if (job && input.threadId) await recordCompletedCodexThread(job, input.threadId, "idle");
  else if (job?.newThread) await clearPendingCodexThread(job);
  return job;
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
  const job = (await prisma.codexJob.findUnique({
    where: { id: input.id },
    include: { project: true, attachments: true }
  })) ?? undefined;
  if (job && input.threadId) await recordCompletedCodexThread(job, input.threadId, "systemError");
  else if (job?.newThread) await clearPendingCodexThread(job);
  return job;
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

export async function recordCodexPublishAudit(input: {
  scope: CodexScope;
  jobId: string;
  workerId: string;
  event: CodexPublishAuditInput;
}): Promise<boolean> {
  const job = await prisma.codexJob.findFirst({
    where: {
      id: input.jobId,
      ...input.scope,
      workerId: input.workerId,
      status: CodexJobStatus.RUNNING,
      publishRequested: true
    },
    select: { id: true }
  });
  if (!job) return false;

  await prisma.codexPublishAudit.upsert({
    where: {
      jobId_eventKey: {
        jobId: input.jobId,
        eventKey: input.event.eventKey
      }
    },
    create: {
      jobId: input.jobId,
      ...input.scope,
      workerId: input.workerId,
      eventKey: input.event.eventKey,
      action: input.event.action,
      status: input.event.status,
      branch: input.event.branch,
      commitSha: input.event.commitSha,
      prNumber: input.event.prNumber,
      prUrl: input.event.prUrl,
      details: input.event.details as Prisma.InputJsonValue | undefined
    },
    update: {}
  });
  return true;
}

export function taskTitleFromPrompt(prompt: string): string {
  const firstLine = prompt.split(/\r?\n/, 1)[0]?.replace(/\s+/g, " ").trim() || "New Codex task";
  const points = Array.from(firstLine);
  return points.length <= 80 ? firstLine : `${points.slice(0, 77).join("")}...`;
}

async function recordCompletedCodexThread(
  job: CodexJobWithProject,
  threadId: string,
  status: string
): Promise<void> {
  const now = job.completedAt ?? new Date();
  const title = job.threadTitle || taskTitleFromPrompt(job.prompt);
  await prisma.$transaction(async (tx) => {
    await tx.codexThread.upsert({
      where: { id: threadId },
      create: {
        id: threadId,
        ownerTelegramId: job.ownerTelegramId,
        telegramChatId: job.telegramChatId,
        projectId: job.projectId,
        title,
        preview: job.prompt,
        source: "telegram",
        status,
        enabled: true,
        threadCreatedAt: job.startedAt ?? now,
        threadUpdatedAt: now,
        lastSeenAt: now
      },
      update: {
        projectId: job.projectId,
        title,
        preview: job.prompt,
        source: "telegram",
        status,
        enabled: true,
        threadUpdatedAt: now,
        lastSeenAt: now
      }
    });
    if (job.newThread) {
      const scope = {
        ownerTelegramId: job.ownerTelegramId,
        telegramChatId: job.telegramChatId
      };
      await tx.codexChatState.updateMany({
        where: { ...scope, pendingThreadJobId: job.id },
        data: { activeProjectId: job.projectId, activeThreadId: threadId, pendingThreadJobId: null }
      });
    }
  });
}

async function clearPendingCodexThread(job: CodexJobWithProject): Promise<void> {
  await prisma.codexChatState.updateMany({
    where: {
      ownerTelegramId: job.ownerTelegramId,
      telegramChatId: job.telegramChatId,
      pendingThreadJobId: job.id
    },
    data: { pendingThreadJobId: null }
  });
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

function uniqueThreads(items: DiscoveredCodexThread[]): DiscoveredCodexThread[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = item.threadId.trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    item.threadId = id;
    item.path = item.path.trim().replace(/[\\/]+$/, "");
    return Boolean(item.path);
  });
}

function normalizedPathKey(path: string): string {
  return path.trim().replace(/[\\/]+$/, "").replace(/\//g, "\\").toLowerCase();
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
