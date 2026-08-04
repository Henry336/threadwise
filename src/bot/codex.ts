import { CodexApprovalStatus, CodexJobStatus, type CodexProject } from "@prisma/client";
import { InlineKeyboard, type Bot, type Context } from "grammy";
import { env, privateCodexConfig } from "../config/env";
import {
  codexJobHasReportMessage,
  codexJobForReport,
  clearActiveCodexThread,
  approveCodexJobCapabilities,
  blockedCodexJobsForQueue,
  cancelBlockedCodexJob,
  denyCodexJobCapabilities,
  findActiveCodexThread,
  findCodexJobByReference,
  findCodexProject,
  findCodexReplyJob,
  findCodexThreadByReference,
  isPrivateCodexActor,
  isPrivateCodexReportActor,
  listCodexProjects,
  listCodexThreads,
  queueCodexJob,
  recentCodexJobs,
  recordCodexReportMessage,
  markCodexJobDelivered,
  selectCodexProject,
  selectCodexProjectById,
  selectCodexThreadById,
  splitTelegramReport,
  taskTitleFromPrompt,
  retryBlockedCodexJobAsNew,
  undeliveredCodexJobs,
  type CodexAttachmentInput,
  type CodexJobWithProject,
  type CodexScope
} from "../services/codex";
import {
  capabilityLabel,
  parseCodexAccess,
  type CodexCapability
} from "../services/codexCapabilities";
import { logger } from "../logger";
import { localWorkerReadiness } from "../services/geminiIdeas";
import { detectTrustedPublishIntent } from "../services/trustedGitPublisher";
import { bold, code, h, HTML_REPLY, replyHtml } from "../utils/html";
import { commandBody } from "../utils/text";
import {
  TelegramAlbumBatcher,
  type TelegramAlbumBatch
} from "./codexAttachmentBatch";

export const CODEX_REPORT_PAGE_CHARS = 2_800;
const PROJECTS_PER_PAGE = 8;
const THREADS_PER_PAGE = 6;
const MAX_CODEX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_CODEX_ALBUM_ATTACHMENTS = 10;
const MAX_CODEX_ALBUM_BYTES = 100 * 1024 * 1024;
const CODEX_ALBUM_SETTLE_MS = 1_500;
const REASONING_LEVELS = ["minimal", "low", "medium", "high", "xhigh"] as const;
type ReasoningLevel = typeof REASONING_LEVELS[number];

type RunCommand = {
  action: "run";
  prompt: string;
  alias?: string;
  taskRef?: string;
  threadRef?: string;
  forceNewThread: boolean;
  model?: string;
  reasoningEffort?: ReasoningLevel;
  publishRequested?: boolean;
  publishAutoMerge?: boolean;
  requestedCapabilities?: CodexCapability[];
};

export type ParsedCodexCommand =
  | { action: "help" }
  | { action: "projects" }
  | { action: "tasks"; alias?: string }
  | { action: "models" }
  | { action: "status" }
  | { action: "doctor" }
  | { action: "use"; alias: string }
  | { action: "useTask"; reference: string }
  | { action: "error"; message: string }
  | RunCommand;

const codexAlbumBatcher = new TelegramAlbumBatcher<CodexAttachmentInput, Context>({
  settleMs: CODEX_ALBUM_SETTLE_MS,
  maxItems: MAX_CODEX_ALBUM_ATTACHMENTS,
  onFlush: flushCodexAlbum,
  onError: (error, batch) => {
    logger.error("Failed to queue Telegram Codex attachment album", {
      error: String(error),
      albumKey: batch.key
    });
    void batch.context.reply(
      "I couldn't queue that attachment batch. Please send the album again."
    ).catch((replyError) => {
      logger.warn("Failed to report Codex album queue error", {
        error: String(replyError),
        albumKey: batch.key
      });
    });
  }
});

export function registerCodexMode(bot: Bot): void {
  bot.command("codex", async (ctx) => {
    if (!privateCodexScopeForContext(ctx)) return;
    await handleCodexInput(ctx, commandBody(ctx.message?.text ?? "", "codex"));
  });

  bot.callbackQuery(/^codex:report:([0-9a-f-]+):(\d+)$/, async (ctx) => {
    const access = privateCodexReportAccess(ctx);
    if (!access || (access.inConfiguredGroup && !await codexGroupIsPrivate(ctx, access.scope))) {
      await silentlyAnswerCallback(ctx);
      return;
    }
    const job = await codexJobForReport(access.scope, ctx.match[1]!);
    if (!job || !(
      job.status === CodexJobStatus.COMPLETED
      || job.status === CodexJobStatus.FAILED
      || job.status === CodexJobStatus.BLOCKED
    )) {
      await ctx.answerCallbackQuery({ text: "This report is no longer available." });
      return;
    }
    const pages = reportPages(job);
    const page = clampPage(Number(ctx.match[2]), pages.length);
    await ctx.editMessageText(renderReportPage(job, pages, page), {
      reply_markup: reportKeyboard(job.id, page, pages.length, job.status)
    });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^codex:projects:(\d+)$/, async (ctx) => {
    const scope = privateCodexScopeForContext(ctx);
    if (!scope || !await codexGroupIsPrivate(ctx, scope)) {
      await silentlyAnswerCallback(ctx);
      return;
    }
    await editProjectsPage(ctx, scope, Number(ctx.match[1]));
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^codex:project:([0-9a-f-]+):(\d+)$/, async (ctx) => {
    const scope = privateCodexScopeForContext(ctx);
    if (!scope || !await codexGroupIsPrivate(ctx, scope)) {
      await silentlyAnswerCallback(ctx);
      return;
    }
    const project = await selectCodexProjectById(scope, ctx.match[1]!);
    if (!project) {
      await ctx.answerCallbackQuery({ text: "That project is no longer available." });
      return;
    }
    await editTasksPage(ctx, scope, project.id, 0);
    await ctx.answerCallbackQuery({ text: `Using ${project.alias}` });
  });

  bot.callbackQuery(/^codex:tasks:([0-9a-f-]+):(\d+)$/, async (ctx) => {
    const scope = privateCodexScopeForContext(ctx);
    if (!scope || !await codexGroupIsPrivate(ctx, scope)) {
      await silentlyAnswerCallback(ctx);
      return;
    }
    await editTasksPage(ctx, scope, ctx.match[1]!, Number(ctx.match[2]));
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^codex:thread:([0-9a-f-]+):(\d+)$/, async (ctx) => {
    const scope = privateCodexScopeForContext(ctx);
    if (!scope || !await codexGroupIsPrivate(ctx, scope)) {
      await silentlyAnswerCallback(ctx);
      return;
    }
    const thread = await selectCodexThreadById(scope, ctx.match[1]!);
    if (!thread) {
      await ctx.answerCallbackQuery({ text: "That Codex task is no longer available." });
      return;
    }
    await editTasksPage(ctx, scope, thread.projectId, Number(ctx.match[2]));
    await ctx.answerCallbackQuery({ text: `Using ${buttonTitle(thread.title, 48)}` });
  });

  bot.callbackQuery(/^codex:newtask:([0-9a-f-]+):(\d+)$/, async (ctx) => {
    const scope = privateCodexScopeForContext(ctx);
    if (!scope || !await codexGroupIsPrivate(ctx, scope)) {
      await silentlyAnswerCallback(ctx);
      return;
    }
    const project = await clearActiveCodexThread(scope, ctx.match[1]!);
    if (!project) {
      await ctx.answerCallbackQuery({ text: "That project is no longer available." });
      return;
    }
    await editTasksPage(ctx, scope, project.id, Number(ctx.match[2]));
    await ctx.answerCallbackQuery({ text: "Your next prompt starts a new task." });
  });

  bot.callbackQuery(/^codex:(approve|deny):([0-9a-f-]+)$/, async (ctx) => {
    const scope = privateCodexScopeForContext(ctx);
    if (!scope || !await codexGroupIsPrivate(ctx, scope)) {
      await silentlyAnswerCallback(ctx);
      return;
    }
    const approve = ctx.match[1] === "approve";
    const job = approve
      ? await approveCodexJobCapabilities({
          scope,
          id: ctx.match[2]!,
          decisionTelegramId: String(ctx.from.id)
        })
      : await denyCodexJobCapabilities({
          scope,
          id: ctx.match[2]!,
          decisionTelegramId: String(ctx.from.id)
        });
    if (!job) {
      await ctx.answerCallbackQuery({ text: "This approval has already been handled." });
      return;
    }
    await ctx.editMessageText(
      approve
        ? `✅ Approved. ${job.project.alias} request ${shortJobId(job.id)} is queued again.`
        : `🚫 Canceled. ${job.project.alias} request ${shortJobId(job.id)} will not run.`
    );
    if (!approve) {
      await markCodexJobDelivered(job.id);
      const blocked = await blockedCodexJobsForQueue(scope, job.queueKey);
      for (const dependent of blocked) await deliverCodexJobOnce(bot, dependent);
    }
    await ctx.answerCallbackQuery({ text: approve ? "Approved" : "Canceled" });
  });

  bot.callbackQuery(/^codex:blocked:(retry|cancel):([0-9a-f-]+)$/, async (ctx) => {
    const scope = privateCodexScopeForContext(ctx);
    if (!scope || !await codexGroupIsPrivate(ctx, scope)) {
      await silentlyAnswerCallback(ctx);
      return;
    }
    if (ctx.match[1] === "cancel") {
      if (!await cancelBlockedCodexJob({ scope, id: ctx.match[2]! })) {
        await ctx.answerCallbackQuery({ text: "This blocked request is no longer available." });
        return;
      }
      await ctx.editMessageText("🚫 Canceled. This dependent prompt will not run.");
      await ctx.answerCallbackQuery({ text: "Canceled" });
      return;
    }
    const job = await retryBlockedCodexJobAsNew({ scope, id: ctx.match[2]! });
    if (!job) {
      await ctx.answerCallbackQuery({ text: "This blocked request is no longer available." });
      return;
    }
    await ctx.editMessageText(`↻ Retried as new request ${shortJobId(job.id)}.`);
    if (job.status === CodexJobStatus.WAITING_APPROVAL) {
      await replyHtml(ctx, renderCodexApproval(job), { reply_markup: codexApprovalKeyboard(job.id) });
    } else {
      await replyHtml(ctx, renderCodexQueuedMessage({
        projectAlias: job.project.alias,
        title: job.threadTitle ?? taskTitleFromPrompt(job.prompt),
        threadId: "new",
        requestId: shortJobId(job.id),
        model: job.model,
        reasoningEffort: job.reasoningEffort,
        attachmentCount: job.attachments.length,
        continuing: false,
        queuePosition: job.queuePosition,
        waitingForThread: false,
        publishRequested: job.publishRequested,
        publishAutoMerge: job.publishAutoMerge
      }));
    }
    await ctx.answerCallbackQuery({ text: "Retried as new task" });
  });

  bot.on("message:photo", async (ctx, next) => {
    const scope = privateCodexScopeForContext(ctx);
    if (!scope) {
      await next();
      return;
    }
    if (!await codexGroupIsPrivate(ctx, scope)) return;
    const photo = ctx.message.photo.at(-1);
    if (!photo) return;
    await handleCodexUpload(ctx, scope, {
      kind: "image",
      telegramFileId: photo.file_id,
      telegramFileUniqueId: photo.file_unique_id,
      fileName: `telegram-image-${photo.file_unique_id}.jpg`,
      mimeType: "image/jpeg",
      fileSize: photo.file_size
    });
  });

  bot.on("message:document", async (ctx, next) => {
    const scope = privateCodexScopeForContext(ctx);
    if (!scope) {
      await next();
      return;
    }
    if (!await codexGroupIsPrivate(ctx, scope)) return;
    const document = ctx.message.document;
    await handleCodexUpload(ctx, scope, {
      kind: document.mime_type?.startsWith("image/") ? "image" : "file",
      telegramFileId: document.file_id,
      telegramFileUniqueId: document.file_unique_id,
      fileName: document.file_name || `telegram-file-${document.file_unique_id}`,
      mimeType: document.mime_type,
      fileSize: document.file_size
    });
  });

  bot.on("message:text", async (ctx, next) => {
    const scope = privateCodexScopeForContext(ctx);
    if (!scope || ctx.message.text.startsWith("/")) {
      await next();
      return;
    }
    if (!await codexGroupIsPrivate(ctx, scope)) return;
    await handleCodexInput(ctx, ctx.message.text);
  });
}

export function privateCodexScopeForContext(ctx: Context): CodexScope | undefined {
  const config = privateCodexConfig();
  if (!config) return undefined;
  const scope = {
    ownerTelegramId: config.ownerTelegramId,
    telegramChatId: config.telegramChatId
  };
  return isPrivateCodexActor({
    telegramUserId: ctx.from?.id ? String(ctx.from.id) : undefined,
    telegramChatId: ctx.chat?.id ? String(ctx.chat.id) : undefined
  }, scope) ? scope : undefined;
}

export function parseCodexCommand(body: string): ParsedCodexCommand {
  const value = body.trim();
  if (!value || /^(?:help|\?)$/i.test(value)) return { action: "help" };
  if (/^(?:projects?|repos?)$/i.test(value)) return { action: "projects" };
  if (/^(?:models?|reasoning)$/i.test(value)) return { action: "models" };
  if (/^(?:status|jobs?)$/i.test(value)) return { action: "status" };
  if (/^(?:doctor|diagnostics?|access)$/i.test(value)) return { action: "doctor" };

  const tasks = value.match(/^tasks?(?:\s+([a-z0-9][a-z0-9-]*))?$/i);
  if (tasks) return { action: "tasks", alias: tasks[1] };

  const useTask = value.match(/^use\s+task\s+(.+)$/i);
  if (useTask?.[1]) return { action: "useTask", reference: unquote(useTask[1].trim()) };

  const use = value.match(/^use\s+([a-z0-9][a-z0-9-]*)$/i);
  if (use?.[1]) return { action: "use", alias: use[1] };

  return parseRunCommand(value);
}

export async function deliverCodexJob(bot: Bot, job: CodexJobWithProject): Promise<void> {
  const groupIsPrivate = await soleOwnerGroup(bot.api, job.telegramChatId, job.ownerTelegramId);
  const deliveryChatId = groupIsPrivate ? job.telegramChatId : job.ownerTelegramId;
  const privacyNotice = groupIsPrivate
    ? undefined
    : "Privacy fallback: another group member is present, so this report was sent only to your private bot chat.";
  const replyParameters = groupIsPrivate && job.telegramRequestMessageId
    ? { reply_parameters: { message_id: job.telegramRequestMessageId, allow_sending_without_reply: true } }
    : {};

  const pages = reportPages(job);
  const message = await bot.api.sendMessage(
    deliveryChatId,
    [privacyNotice, renderReportPage(job, pages, 0)].filter(Boolean).join("\n\n"),
    {
      ...replyParameters,
      reply_markup: reportKeyboard(job.id, 0, pages.length, job.status)
    }
  );
  await recordCodexReportMessage(job.id, deliveryChatId, message.message_id);
}

export async function deliverCodexJobOnce(bot: Bot, job: CodexJobWithProject): Promise<void> {
  if (job.deliveredAt) return;
  if (await codexJobHasReportMessage(job.id)) {
    await markCodexJobDelivered(job.id);
    return;
  }
  await deliverCodexJob(bot, job);
  await markCodexJobDelivered(job.id);
}

export function startCodexDeliveryLoop(bot: Bot, intervalMs = 60_000): NodeJS.Timeout | undefined {
  const config = privateCodexConfig();
  if (!config) return undefined;
  const scope = {
    ownerTelegramId: config.ownerTelegramId,
    telegramChatId: config.telegramChatId
  };
  let active = false;
  return setInterval(() => {
    if (active) return;
    active = true;
    void (async () => {
      try {
        const jobs = await undeliveredCodexJobs(scope, new Date(Date.now() - 60_000));
        for (const job of jobs) {
          try {
            await deliverCodexJobOnce(bot, job);
          } catch (error) {
            logger.warn("Codex report retry failed.", { jobId: job.id, error: String(error) });
          }
        }
      } catch (error) {
        logger.warn("Codex delivery retry pass failed.", { error: String(error) });
      } finally {
        active = false;
      }
    })();
  }, intervalMs);
}

function parseRunCommand(input: string): ParsedCodexCommand {
  let value = input.trim();
  let forceNewThread = false;
  if (/^new(?:\s|$)/i.test(value)) {
    forceNewThread = true;
    value = value.replace(/^new(?:\s+|$)/i, "");
  }

  const modelFlag = extractFlag(value, "model");
  value = modelFlag.rest;
  if (modelFlag.value && !/^[a-z0-9][a-z0-9._:-]{0,79}$/i.test(modelFlag.value)) {
    return { action: "error", message: "Use a valid model id after --model." };
  }

  const reasoningFlag = extractFlag(value, "(?:reasoning|reasoning-level)");
  value = reasoningFlag.rest;
  if (reasoningFlag.value && !isReasoningLevel(reasoningFlag.value)) {
    return {
      action: "error",
      message: `Reasoning must be one of: ${REASONING_LEVELS.join(", ")}.`
    };
  }

  const accessFlag = extractFlag(value, "access");
  value = accessFlag.rest;
  const access = parseCodexAccess(accessFlag.value);
  if (access.invalid.length) {
    return {
      action: "error",
      message: `Unknown access profile: ${access.invalid.join(", ")}. Use code, internet, publish, deploy, browser, files, or full.`
    };
  }

  value = value.replace(/^\s*--\s*/, "").trim();
  let alias: string | undefined;
  let taskRef: string | undefined;
  let threadRef: string | undefined;

  if (
    /^continue\s+[0-9a-f]{6,36}\s*$/i.test(value)
    || /^in\s+[a-z0-9][a-z0-9-]*\s*$/i.test(value)
    || /^(?:in\s+[a-z0-9][a-z0-9-]*\s+)?task\s+.+:\s*$/i.test(value)
  ) {
    return { action: "error", message: "Add a prompt for Codex to work on." };
  }

  const continuation = value.match(/^continue\s+([0-9a-f]{6,36})\s+(.+)$/is);
  if (continuation?.[1] && continuation[2]) {
    taskRef = continuation[1];
    value = continuation[2];
  } else {
    const inProjectTask = value.match(
      /^in\s+([a-z0-9][a-z0-9-]*)\s+task\s+(?:"([^"]+)"|'([^']+)'|([^:]+?))\s*:\s*(.+)$/is
    );
    const activeProjectTask = value.match(
      /^task\s+(?:"([^"]+)"|'([^']+)'|([^:]+?))\s*:\s*(.+)$/is
    );
    if (inProjectTask?.[1] && inProjectTask[5]) {
      alias = inProjectTask[1];
      threadRef = inProjectTask[2] || inProjectTask[3] || inProjectTask[4];
      value = inProjectTask[5];
    } else if (activeProjectTask?.[4]) {
      threadRef = activeProjectTask[1] || activeProjectTask[2] || activeProjectTask[3];
      value = activeProjectTask[4];
    } else {
      const inProject = value.match(/^in\s+([a-z0-9][a-z0-9-]*)\s+(.+)$/is);
      if (inProject?.[1] && inProject[2]) {
        alias = inProject[1];
        value = inProject[2];
      }
    }
  }

  const prompt = value.trim();
  if (!prompt) return { action: "error", message: "Add a prompt for Codex to work on." };
  const publish = detectTrustedPublishIntent(prompt);
  const accessPublishes = access.capabilities.includes("publish") || access.capabilities.includes("deploy");
  return {
    action: "run",
    prompt,
    alias,
    taskRef,
    threadRef: threadRef?.trim(),
    forceNewThread,
    model: modelFlag.value,
    reasoningEffort: reasoningFlag.value?.toLowerCase() as ReasoningLevel | undefined,
    ...(access.capabilities.length ? { requestedCapabilities: access.capabilities } : {}),
    ...(publish.requested || accessPublishes
      ? {
          publishRequested: true,
          publishAutoMerge: publish.autoMerge || access.capabilities.includes("deploy")
        }
      : {})
  };
}

function extractFlag(input: string, namePattern: string): { value?: string; rest: string } {
  let value: string | undefined;
  const expression = new RegExp(`(^|\\s)--${namePattern}(?:=|\\s+)([^\\s]+)`, "ig");
  const rest = input.replace(expression, (_match, prefix: string, found: string) => {
    value = found;
    return prefix;
  });
  return { value, rest };
}

async function handleCodexInput(ctx: Context, input: string, attachments: CodexAttachmentInput[] = []): Promise<void> {
  const scope = privateCodexScopeForContext(ctx);
  if (!scope || !await codexGroupIsPrivate(ctx, scope)) return;
  const parsed = parseCodexCommand(input);

  if (parsed.action === "help") {
    await replyHtml(ctx, [
      bold("Private Codex"),
      "Choose a project once, then send prompts naturally—just like a Codex chat.",
      "",
      `${code("/codex projects")} browse and tap a project`,
      `${code("/codex tasks threadwise")} browse and tap that project's Codex tasks`,
      `${code("/codex use threadwise")} select by alias`,
      `${code('/codex use task "Add Telegram Codex mode"')} select a task by title`,
      `${code("in threadwise Fix the bug")} target any project`,
      `${code('in threadwise task "Add Telegram Codex mode": Continue it')} target any exact task`,
      `${code("continue a1b2c3d4 Add tests")} continue a task by id`,
      `${code("/codex new Start separately")} start a fresh thread`,
      `${code("/codex status")} see task ids and progress`,
      `${code("/codex doctor")} verify Codex, GitHub, network, browser, files, deploys, and project Git readiness`,
      "",
      `${code("--model MODEL_ID")} choose a model for one task`,
      `${code("--reasoning high")} choose minimal, low, medium, high, or xhigh`,
      `${code("--access internet")} request one-task access; also supports publish, deploy, browser, files, and full`,
      "",
      `Example: ${code("in threadwise --model gpt-5.6-sol --reasoning high -- Fix CI")}`,
      "Reply to any Codex report—on any page—to continue that exact task and folder.",
      "Send one image or document with a caption, or send up to 10 items as one Telegram album. The album caption becomes the prompt and every item goes to one Codex request.",
      `Trusted publishing: ${code("Implement this, verify it, publish it, and auto-merge when CI passes.")}`
    ].join("\n"));
    return;
  }

  if (parsed.action === "models") {
    await replyHtml(ctx, [
      bold("Per-task Codex controls"),
      `${code("--model MODEL_ID")} passes that model id to Codex for this task.`,
      `${code("--reasoning LEVEL")} accepts ${REASONING_LEVELS.map(code).join(", ")}.`,
      "",
      "Omit either option to use the resumed thread or your local Codex defaults.",
      `Example: ${code("--model gpt-5.6-sol --reasoning xhigh -- Review this architecture")}`
    ].join("\n"));
    return;
  }

  if (parsed.action === "projects") {
    await sendProjectsPage(ctx, scope, 0);
    return;
  }

  if (parsed.action === "tasks") {
    const project = await findCodexProject(scope, parsed.alias);
    if (!project) {
      await ctx.reply(parsed.alias
        ? `I couldn't find "${parsed.alias}". Open /codex projects to see the available aliases.`
        : "Choose a project first with /codex projects.");
      return;
    }
    await sendTasksPage(ctx, scope, project.id, 0);
    return;
  }

  if (parsed.action === "status") {
    const [jobs, worker] = await Promise.all([
      recentCodexJobs(scope, 8),
      localWorkerReadiness(scope)
    ]);
    await replyHtml(ctx, renderCodexStatus(jobs, worker));
    return;
  }

  if (parsed.action === "doctor") {
    const [worker, projectData] = await Promise.all([
      localWorkerReadiness(scope),
      listCodexProjects(scope)
    ]);
    await replyHtml(ctx, renderCodexDoctor(worker, projectData.projects, projectData.activeProjectId));
    return;
  }

  if (parsed.action === "use") {
    const project = await selectCodexProject(scope, parsed.alias);
    if (!project) {
      await ctx.reply(`I couldn't find "${parsed.alias}". Open /codex projects to see and tap an available alias.`);
      return;
    }
    await sendTasksPage(ctx, scope, project.id, 0);
    return;
  }

  if (parsed.action === "useTask") {
    const activeProject = await findCodexProject(scope);
    const thread = await findCodexThreadByReference(scope, parsed.reference, activeProject?.id);
    if (!thread) {
      await ctx.reply(
        `I couldn't find one unique task matching "${parsed.reference}"${activeProject ? ` in ${activeProject.alias}` : ""}. Open /codex tasks and tap it.`
      );
      return;
    }
    await selectCodexThreadById(scope, thread.id);
    await replyHtml(ctx, [
      bold("Active Codex task"),
      `Project: ${code(thread.project.alias)}`,
      `Task: ${h(thread.title)}`,
      `ID: ${code(shortCodexThreadId(thread.id))}`,
      "",
      "Now send a prompt normally. It will resume this exact desktop task."
    ].join("\n"));
    return;
  }

  if (parsed.action === "error") {
    await ctx.reply(parsed.message);
    return;
  }

  await queuePromptFromContext(ctx, scope, parsed, attachments);
}

async function handleCodexUpload(ctx: Context, scope: CodexScope, attachment: CodexAttachmentInput): Promise<void> {
  const mediaGroupId = ctx.message?.media_group_id;
  const albumKey = mediaGroupId ? codexAlbumKey(scope, mediaGroupId) : undefined;
  if (attachment.fileSize && attachment.fileSize > MAX_CODEX_ATTACHMENT_BYTES) {
    if (!albumKey || codexAlbumBatcher.block(albumKey)) {
      await ctx.reply(
        albumKey
          ? "One item in that album is larger than the 25 MB Codex upload limit, so I did not queue the album."
          : "That attachment is larger than the 25 MB Codex upload limit."
      );
    }
    return;
  }

  if (albumKey && ctx.message) {
    const result = codexAlbumBatcher.add(albumKey, {
      messageId: ctx.message.message_id,
      attachment,
      context: ctx,
      caption: ctx.message.caption
    });
    if (result.status === "overflow") {
      await ctx.reply(
        `A Codex attachment album can contain at most ${MAX_CODEX_ALBUM_ATTACHMENTS} items, so I did not queue that album.`
      );
    }
    return;
  }

  const input = codexUploadPrompt(ctx.message?.caption, 1);
  await handleCodexInput(ctx, input, [attachment]);
}

async function flushCodexAlbum(
  batch: TelegramAlbumBatch<CodexAttachmentInput, Context>
): Promise<void> {
  const knownBytes = batch.attachments.reduce(
    (total, attachment) => total + (attachment.fileSize ?? 0),
    0
  );
  if (knownBytes > MAX_CODEX_ALBUM_BYTES) {
    await batch.context.reply(
      `That album is larger than the ${MAX_CODEX_ALBUM_BYTES / 1024 / 1024} MB combined Codex upload limit, so I did not queue it.`
    );
    return;
  }

  await handleCodexInput(
    batch.context,
    codexUploadPrompt(batch.caption, batch.attachments.length),
    batch.attachments
  );
}

function codexAlbumKey(scope: CodexScope, mediaGroupId: string): string {
  return `${scope.ownerTelegramId}:${scope.telegramChatId}:${mediaGroupId}`;
}

export function codexUploadPrompt(caption: string | undefined, attachmentCount: number): string {
  const prompt = caption?.trim().replace(/^\/codex(?:@\w+)?\s*/i, "").trim();
  if (prompt) return prompt;
  return attachmentCount === 1
    ? "Inspect the attached file and help me with it. Report what you found and any work you completed."
    : `Inspect all ${attachmentCount} attached files together and help me with them. Report what you found and any work you completed.`;
}

async function queuePromptFromContext(
  ctx: Context,
  scope: CodexScope,
  command: RunCommand,
  attachments: CodexAttachmentInput[] = []
): Promise<void> {
  const repliedMessageId = ctx.message?.reply_to_message?.message_id;
  const repliedJob = repliedMessageId ? await findCodexReplyJob(scope, repliedMessageId) : undefined;
  const referencedJob = command.taskRef ? await findCodexJobByReference(scope, command.taskRef) : undefined;
  if (command.taskRef && !referencedJob) {
    await ctx.reply(`I couldn't find a unique Codex request matching "${command.taskRef}". Use /codex status and copy its request id.`);
    return;
  }

  if (command.forceNewThread && command.threadRef) {
    await ctx.reply("Choose either “new” or a specific existing task, not both.");
    return;
  }

  const explicitProject = command.alias ? await findCodexProject(scope, command.alias) : undefined;
  if (command.alias && !explicitProject) {
    await ctx.reply(`I couldn't find "${command.alias}". Open /codex projects to see and tap an available alias.`);
    return;
  }
  const explicitThread = command.threadRef
    ? await findCodexThreadByReference(scope, command.threadRef, explicitProject?.id)
    : undefined;
  if (command.threadRef && !explicitThread) {
    await ctx.reply(
      `I couldn't find one unique Codex task matching "${command.threadRef}". Open ${command.alias ? `/codex tasks ${command.alias}` : "/codex tasks"} and tap it.`
    );
    return;
  }

  const continuation = referencedJob
    ?? (!command.alias && !command.threadRef && !command.forceNewThread ? repliedJob : undefined);
  if (continuation && !continuation.threadId && !command.forceNewThread) {
    await ctx.reply(
      "That task does not have a resumable Codex thread yet. Wait for its report, or use “new” to start a fresh task in the same project."
    );
    return;
  }
  const selectedProject = explicitProject ?? await findCodexProject(scope);
  const activeThread = !continuation && !explicitThread && !command.forceNewThread
    ? await findActiveCodexThread(scope, selectedProject?.id)
    : undefined;
  const targetThread = explicitThread ?? activeThread;
  const project = continuation?.project ?? targetThread?.project ?? selectedProject;
  if (!project) {
    await ctx.reply("Choose a project first with /codex projects. After that, choose a task or tap “New task”.");
    return;
  }

  const requestedCapabilities = [...new Set([
    ...(command.requestedCapabilities ?? []),
    ...(command.publishRequested ? ["publish" as const] : [])
  ])];
  if (requestedCapabilities.length) {
    const readiness = await localWorkerReadiness(scope);
    const available = readiness.capabilities?.allowedCapabilities;
    const unavailable = available
      ? requestedCapabilities.filter((capability) => !available.includes(capability))
      : [];
    if (unavailable.length) {
      await ctx.reply(
        `The laptop worker is not configured for ${unavailable.map(capabilityLabel).join(", ")}. Open /codex doctor for the exact setup.`
      );
      return;
    }
  }

  const job = await queueCodexJob({
    scope,
    project,
    prompt: command.prompt,
    telegramRequestMessageId: ctx.message?.message_id,
    model: command.model,
    reasoningEffort: command.reasoningEffort,
    attachments,
    replyToJob: continuation,
    targetThread,
    forceNewThread: command.forceNewThread,
    publishRequested: command.publishRequested,
    publishAutoMerge: command.publishAutoMerge,
    requestedCapabilities
  });
  if (job.status === CodexJobStatus.WAITING_APPROVAL) {
    await replyHtml(ctx, renderCodexApproval(job), { reply_markup: codexApprovalKeyboard(job.id) });
    return;
  }
  const threadId = job.threadId ? shortCodexThreadId(job.threadId) : "new";
  await replyHtml(ctx, renderCodexQueuedMessage({
    projectAlias: project.alias,
    title: job.threadTitle ?? taskTitleFromPrompt(job.prompt),
    threadId,
    requestId: shortJobId(job.id),
    model: job.model,
    reasoningEffort: job.reasoningEffort,
    attachmentCount: attachments.length,
    continuing: job.waitingForThread || Boolean((continuation?.threadId || targetThread) && !command.forceNewThread),
    queuePosition: job.queuePosition,
    waitingForThread: job.waitingForThread,
    pendingRequestId: job.waitingForThread ? shortJobId(job.queueKey) : undefined,
    publishRequested: job.publishRequested,
    publishAutoMerge: job.publishAutoMerge
  }));
}

export async function deliverCodexApprovalRequest(bot: Bot, job: CodexJobWithProject): Promise<void> {
  const groupIsPrivate = await soleOwnerGroup(bot.api, job.telegramChatId, job.ownerTelegramId);
  const deliveryChatId = groupIsPrivate ? job.telegramChatId : job.ownerTelegramId;
  await bot.api.sendMessage(deliveryChatId, renderCodexApproval(job), {
    ...HTML_REPLY,
    reply_markup: codexApprovalKeyboard(job.id)
  });
}

function renderCodexApproval(job: CodexJobWithProject): string {
  const pending = job.approvals.filter((approval) => approval.status === CodexApprovalStatus.PENDING);
  return [
    bold("Codex needs your approval"),
    `${code(job.project.alias)} · ${h(job.threadTitle ?? taskTitleFromPrompt(job.prompt))}`,
    `Request ${code(shortJobId(job.id))}`,
    "",
    `Access: ${pending.map((approval) => h(capabilityLabel(approval.capability))).join(", ")}`,
    pending.find((approval) => approval.reason)?.reason
      ? `Reason: ${h(pending.find((approval) => approval.reason)!.reason!.slice(0, 500))}`
      : "This permission applies only to this queued request.",
    "Credentials remain in the trusted laptop worker and are not sent in the prompt."
  ].filter(Boolean).join("\n");
}

function codexApprovalKeyboard(jobId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Approve once", `codex:approve:${jobId}`)
    .text("Cancel", `codex:deny:${jobId}`);
}

async function sendProjectsPage(ctx: Context, scope: CodexScope, requestedPage: number): Promise<void> {
  const data = await projectsPageData(scope, requestedPage);
  if (!data) {
    await ctx.reply("No local Codex projects have been discovered yet. Start the Windows worker, then try again.");
    return;
  }
  await replyHtml(ctx, data.text, { reply_markup: data.keyboard });
}

async function editProjectsPage(ctx: Context, scope: CodexScope, requestedPage: number): Promise<void> {
  const data = await projectsPageData(scope, requestedPage);
  if (!data) {
    return;
  }
  await ctx.editMessageText(data.text, { ...HTML_REPLY, reply_markup: data.keyboard });
}

async function projectsPageData(scope: CodexScope, requestedPage: number) {
  const { projects, activeProjectId } = await listCodexProjects(scope);
  if (projects.length === 0) return undefined;
  const pageCount = Math.ceil(projects.length / PROJECTS_PER_PAGE);
  const page = clampPage(requestedPage, pageCount);
  const visible = projects.slice(page * PROJECTS_PER_PAGE, (page + 1) * PROJECTS_PER_PAGE);
  const keyboard = new InlineKeyboard();
  for (let index = 0; index < visible.length; index += 2) {
    for (const project of visible.slice(index, index + 2)) {
      keyboard.text(
        `${project.id === activeProjectId ? "✓ " : ""}${project.alias}`,
        `codex:project:${project.id}:${page}`
      );
    }
    keyboard.row();
  }
  if (page > 0) keyboard.text("‹ Projects", `codex:projects:${page - 1}`);
  if (page + 1 < pageCount) keyboard.text("More ›", `codex:projects:${page + 1}`);

  return {
    text: [
      bold(`Codex projects · ${page + 1}/${pageCount}`),
      ...visible.map((project) =>
        `${project.id === activeProjectId ? "●" : "○"} ${code(project.alias)}\n${code(displayPath(project.path, 240))}`
      ),
      "",
      "Tap a project to choose one of its exact Codex tasks."
    ].join("\n"),
    keyboard
  };
}

async function sendTasksPage(
  ctx: Context,
  scope: CodexScope,
  projectId: string,
  requestedPage: number
): Promise<void> {
  const data = await tasksPageData(scope, projectId, requestedPage);
  if (!data) {
    await ctx.reply("That Codex project is no longer available. Open /codex projects and choose another.");
    return;
  }
  await replyHtml(ctx, data.text, { reply_markup: data.keyboard });
}

async function editTasksPage(
  ctx: Context,
  scope: CodexScope,
  projectId: string,
  requestedPage: number
): Promise<void> {
  const data = await tasksPageData(scope, projectId, requestedPage);
  if (!data) return;
  await ctx.editMessageText(data.text, { ...HTML_REPLY, reply_markup: data.keyboard });
}

async function tasksPageData(scope: CodexScope, projectId: string, requestedPage: number) {
  const [{ project, threads, activeThreadId }, worker] = await Promise.all([
    listCodexThreads(scope, projectId),
    localWorkerReadiness(scope)
  ]);
  if (!project) return undefined;
  const pageCount = Math.max(1, Math.ceil(threads.length / THREADS_PER_PAGE));
  const page = clampPage(requestedPage, pageCount);
  const visible = threads.slice(page * THREADS_PER_PAGE, (page + 1) * THREADS_PER_PAGE);
  const keyboard = new InlineKeyboard();

  for (const thread of visible) {
    keyboard
      .text(
        `${thread.id === activeThreadId ? "✓ " : ""}${buttonTitle(thread.title, 48)}`,
        `codex:thread:${thread.id}:${page}`
      )
      .row();
  }
  if (page > 0) keyboard.text("‹ Tasks", `codex:tasks:${project.id}:${page - 1}`);
  if (page + 1 < pageCount) keyboard.text("More ›", `codex:tasks:${project.id}:${page + 1}`);
  if (page > 0 || page + 1 < pageCount) keyboard.row();
  keyboard.text("＋ New task", `codex:newtask:${project.id}:${page}`).row();
  keyboard.text("‹ Projects", "codex:projects:0");

  return {
    text: [
      bold(`${project.alias} tasks · ${page + 1}/${pageCount}`),
      code(displayPath(project.path, 240)),
      "",
      ...(visible.length > 0
        ? visible.map((thread) => [
            `${thread.id === activeThreadId ? "●" : "○"} ${h(thread.title)}`,
            `${code(shortCodexThreadId(thread.id))} · ${h(threadSourceLabel(thread.source))}${thread.threadUpdatedAt ? ` · updated ${h(formatCodexTimestamp(thread.threadUpdatedAt))}` : ""}`
          ].join("\n"))
        : [
            !worker.online
              ? "No tasks are synced because the laptop worker is offline or stale."
              : "The worker is online, but no resumable Codex tasks were found in this project."
          ]),
      "",
      worker.lastSeenAt ? `Worker heartbeat: ${h(formatCodexTimestamp(worker.lastSeenAt))}` : undefined,
      activeThreadId
        ? "Tap a task to make it active. Plain messages resume the checked task."
        : "Tap a task, or choose “New task” and send your next prompt."
    ].filter(Boolean).join("\n"),
    keyboard
  };
}

function reportPages(job: CodexJobWithProject): string[] {
  const report = job.status === CodexJobStatus.COMPLETED
    ? job.finalResponse || "(Codex returned an empty final report.)"
    : job.error || "The local worker did not provide an error.";
  return paginateCodexReport(report);
}

export function paginateCodexReport(report: string): string[] {
  return splitTelegramReport(report, CODEX_REPORT_PAGE_CHARS);
}

export function renderReportPage(job: CodexJobWithProject, pages: string[], page: number): string {
  const title = job.threadTitle ?? taskTitleFromPrompt(job.prompt);
  const context = [
    job.project.alias,
    job.threadId ? `task ${shortCodexThreadId(job.threadId)}` : "new task",
    `request ${shortJobId(job.id)}`
  ].join(" · ");
  const controls = [
    job.model,
    job.reasoningEffort ? `${job.reasoningEffort} reasoning` : undefined,
    pages.length > 1 ? `page ${page + 1}/${pages.length}` : undefined
  ].filter(Boolean).join(" · ");
  const publishing = publishReportLines(job);
  const outcome = job.status === CodexJobStatus.COMPLETED
    ? "✅ Codex finished"
    : job.status === CodexJobStatus.BLOCKED
      ? "⛔ Codex prompt blocked"
    : job.status === CodexJobStatus.CANCELED
      ? "🚫 Codex canceled"
      : "❌ Codex failed";
  return [
    outcome,
    title,
    context,
    controls || undefined,
    ...publishing,
    "",
    pages[page] ?? ""
  ].filter((line) => line !== undefined).join("\n");
}

export function renderCodexQueuedMessage(input: {
  projectAlias: string;
  title: string;
  threadId: string;
  requestId: string;
  model?: string | null;
  reasoningEffort?: string | null;
  attachmentCount?: number;
  continuing: boolean;
  queuePosition?: number;
  waitingForThread?: boolean;
  pendingRequestId?: string;
  publishRequested?: boolean;
  publishAutoMerge?: boolean;
}): string {
  const context = [
    code(input.projectAlias),
    input.waitingForThread
      ? `pending task ${code(input.pendingRequestId ?? "creating")}`
      : input.continuing ? `task ${code(input.threadId)}` : "new task",
    `request ${code(input.requestId)}`
  ].join(" · ");
  const controls = [
    input.model ? h(input.model) : undefined,
    input.reasoningEffort ? `${h(input.reasoningEffort)} reasoning` : undefined,
    input.attachmentCount
      ? `${input.attachmentCount} attachment${input.attachmentCount === 1 ? "" : "s"}`
      : undefined
  ].filter(Boolean).join(" · ");
  return [
    bold("⏳ Codex is working"),
    h(input.title),
    context,
    controls || undefined,
    input.queuePosition && input.queuePosition > 1
      ? `Queue position: ${input.queuePosition}`
      : undefined,
    input.publishRequested
      ? input.publishAutoMerge
        ? "Publishing: verify -> commit -> agent/* -> PR -> CI -> auto-merge"
        : "Publishing: verify -> commit -> agent/* -> PR"
      : undefined
  ].filter(Boolean).join("\n");
}

function publishReportLines(job: CodexJobWithProject): Array<string | undefined> {
  if (!job.publishRequested) return [];
  return [
    `Publishing: ${job.publishStatus ?? "not completed"}`,
    job.publishBranch ? `Branch: ${job.publishBranch}` : undefined,
    job.publishCommitSha ? `Commit: ${job.publishCommitSha.slice(0, 12)}` : undefined,
    job.publishPrUrl ? `PR: ${job.publishPrUrl}` : undefined,
    job.publishChecks ? `Checks: ${job.publishChecks}` : undefined,
    job.publishMergeCommitSha ? `Merge: ${job.publishMergeCommitSha.slice(0, 12)}` : undefined,
    job.publishBlocker ? `Blocked: ${job.publishBlocker}` : undefined
  ];
}

export function reportKeyboard(
  jobId: string,
  page: number,
  totalPages: number,
  status?: CodexJobStatus
): InlineKeyboard | undefined {
  if (totalPages <= 1 && status !== CodexJobStatus.BLOCKED) return undefined;
  const keyboard = new InlineKeyboard();
  if (page > 0) keyboard.text("‹ Previous", `codex:report:${jobId}:${page - 1}`);
  if (page + 1 < totalPages) keyboard.text("Next ›", `codex:report:${jobId}:${page + 1}`);
  if (status === CodexJobStatus.BLOCKED) {
    if (page > 0 || page + 1 < totalPages) keyboard.row();
    keyboard
      .text("↻ Retry as new task", `codex:blocked:retry:${jobId}`)
      .text("Cancel", `codex:blocked:cancel:${jobId}`);
  }
  return keyboard;
}

function shortPrompt(prompt: string): string {
  const oneLine = prompt.replace(/\s+/g, " ").trim();
  return oneLine.length <= 140 ? oneLine : `${oneLine.slice(0, 137)}...`;
}

function shortJobId(id: string): string {
  return id.replace(/-/g, "").slice(0, 8);
}

type CodexWorkerReadiness = Awaited<ReturnType<typeof localWorkerReadiness>>;

export function renderCodexStatus(
  jobs: CodexJobWithProject[],
  worker: CodexWorkerReadiness,
  timezone = env.DEFAULT_TIMEZONE
): string {
  const groups = groupRecentCodexJobs(jobs);
  return [
    bold("Recent Codex requests"),
    `Laptop worker: ${worker.online ? "online" : worker.lastSeenAt ? "stale" : "not checked in"}`,
    worker.lastSeenAt
      ? `Heartbeat: ${h(formatCodexTimestamp(worker.lastSeenAt, timezone))}`
      : undefined,
    jobs.length === 0 ? "No Codex requests have been queued yet." : undefined,
    ...groups.map(({ latest, jobs: groupedJobs }) => [
      "",
      `${jobStatusIcon(latest.status)} ${code(latest.project.alias)} · ${h(latest.threadTitle ?? taskTitleFromPrompt(latest.prompt))}`,
      `Task ${code(latest.threadId ? shortCodexThreadId(latest.threadId) : "starting")} · ${groupedJobs.length} recent ${groupedJobs.length === 1 ? "request" : "requests"}`,
      `Latest ${code(shortJobId(latest.id))} · ${h(statusLabel(latest.status))} · ${h(formatCodexTimestamp(jobTimestamp(latest), timezone))}`,
      `Prompt: ${h(shortPrompt(latest.prompt))}`,
      latest.model || latest.reasoningEffort
        ? `${h(latest.model ?? "default model")} · reasoning ${h(latest.reasoningEffort ?? "default")}`
        : undefined,
      groupedJobs.length > 1
        ? `Requests: ${groupedJobs.map((job) => `${jobStatusIcon(job.status)} ${code(shortJobId(job.id))}`).join(" · ")}`
        : undefined
    ].filter(Boolean).join("\n")),
    "",
    `Continue with ${code("continue REQUEST_ID your prompt")}, choose a desktop task with ${code("/codex tasks")}, or reply to its report.`
  ].filter((line) => line !== undefined).join("\n");
}

export function renderCodexDoctor(
  worker: CodexWorkerReadiness,
  projects: CodexProject[],
  activeProjectId?: string
): string {
  const capabilities = worker.capabilities;
  const gitReady = projects.filter((project) => project.gitReady).length;
  const activeProject = projects.find((project) => project.id === activeProjectId);
  const projectBlockers = projects.filter((project) => project.gitRepository && !project.gitReady).slice(0, 8);
  return [
    bold("Codex laptop doctor"),
    `Worker: ${worker.online ? "✅ online" : worker.lastSeenAt ? "⚠️ stale" : "❌ offline"}`,
    worker.lastSeenAt ? `Heartbeat: ${h(formatCodexTimestamp(worker.lastSeenAt))}` : undefined,
    capabilities ? undefined : "⚠️ This worker has not reported Remote Operator diagnostics yet. Update and restart it.",
    "",
    `Desktop Codex home: ${doctorMark(Boolean(capabilities?.codexConfigAvailable && capabilities.codexAuthAvailable))}`,
    `Git + GitHub auth: ${doctorMark(Boolean(capabilities?.gitAvailable && capabilities.githubAuthenticated))}`,
    `Internet approval: ${doctorMark(Boolean(capabilities?.networkAccessAvailable))}`,
    `Browser approval: ${doctorMark(Boolean(capabilities?.browserAvailable && capabilities.networkAccessAvailable))}`,
    `Additional file roots: ${capabilities?.additionalRootCount ?? 0}`,
    `Deploy targets: ${capabilities?.deployTargets?.length ? capabilities.deployTargets.map(code).join(", ") : "none"}`,
    `Plugin credential broker: ${capabilities?.credentialBrokerVariables?.length
      ? capabilities.credentialBrokerVariables.map(code).join(", ")
      : "none"}`,
    `Gemini CLI: ${doctorMark(worker.geminiAvailable)}`,
    !capabilities?.networkAccessAvailable && capabilities?.diagnostics?.internet
      ? `Internet setup: ${h(capabilities.diagnostics.internet)}`
      : undefined,
    !capabilities?.additionalRootCount && capabilities?.diagnostics?.files
      ? `File setup: ${h(capabilities.diagnostics.files)}`
      : undefined,
    !capabilities?.deployTargets?.length && capabilities?.diagnostics?.deploy
      ? `Deploy setup: ${h(capabilities.diagnostics.deploy)}`
      : undefined,
    "",
    `Projects discovered: ${projects.length} · publish-ready: ${gitReady}`,
    activeProject
      ? `Active: ${code(activeProject.alias)} · ${activeProject.gitReady ? "publish-ready" : activeProject.gitRepository ? "Git needs attention" : "code-only"}`
      : "Active project: none selected",
    ...projectBlockers.map((project) => (
      `⚠️ ${code(project.alias)}: ${h(project.gitError ?? "Git publishing is not ready.")}`
    )),
    "",
    "Each prompt stays code-only unless you use --access or request trusted publishing. Internet, browser, deploy, and extra-file access require a one-task Telegram approval."
  ].filter((line) => line !== undefined).join("\n");
}

function doctorMark(ready: boolean): string {
  return ready ? "✅ ready" : "❌ not configured";
}

export function formatCodexTimestamp(
  date: Date,
  timezone = env.DEFAULT_TIMEZONE
): string {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: timezone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short"
  }).format(date);
}

function groupRecentCodexJobs(jobs: CodexJobWithProject[]): Array<{
  latest: CodexJobWithProject;
  jobs: CodexJobWithProject[];
}> {
  const groups = new Map<string, CodexJobWithProject[]>();
  for (const job of jobs) {
    const key = job.threadId ? `thread:${job.threadId}` : `request:${job.id}`;
    const group = groups.get(key) ?? [];
    group.push(job);
    groups.set(key, group);
  }
  return [...groups.values()].flatMap((group) =>
    group[0] ? [{ latest: group[0], jobs: group }] : []
  );
}

function jobTimestamp(job: CodexJobWithProject): Date {
  return job.completedAt ?? job.startedAt ?? job.createdAt;
}

function statusLabel(status: CodexJobStatus): string {
  return status.split("_").map((part) => part.charAt(0) + part.slice(1).toLowerCase()).join(" ");
}

function shortCodexThreadId(id: string): string {
  return id.replace(/-/g, "").slice(0, 8);
}

function buttonTitle(value: string, maximum: number): string {
  const points = Array.from(value.replace(/\s+/g, " ").trim());
  return points.length <= maximum ? points.join("") : `${points.slice(0, maximum - 1).join("")}…`;
}

function threadSourceLabel(source: string): string {
  if (source === "telegram") return "Telegram";
  if (source === "vscode") return "Codex app";
  if (source === "cli") return "Codex CLI";
  if (source === "appServer") return "Codex client";
  return "Codex";
}

function unquote(value: string): string {
  const match = value.match(/^(?:"([^"]+)"|'([^']+)')$/s);
  return match ? (match[1] ?? match[2] ?? value) : value;
}

function jobStatusIcon(status: CodexJobStatus): string {
  if (status === CodexJobStatus.COMPLETED) return "✅";
  if (status === CodexJobStatus.FAILED) return "❌";
  if (status === CodexJobStatus.BLOCKED) return "⛔";
  if (status === CodexJobStatus.CANCELED) return "🚫";
  if (status === CodexJobStatus.WAITING_APPROVAL) return "🔐";
  if (status === CodexJobStatus.RUNNING) return "⚙️";
  return "⏳";
}

function clampPage(page: number, totalPages: number): number {
  return Math.max(0, Math.min(Number.isFinite(page) ? Math.floor(page) : 0, Math.max(0, totalPages - 1)));
}

function isReasoningLevel(value: string): value is ReasoningLevel {
  return (REASONING_LEVELS as readonly string[]).includes(value.toLowerCase());
}

async function silentlyAnswerCallback(ctx: Context): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
  } catch {
    // Unauthorized actors receive no feature-identifying response.
  }
}

async function codexGroupIsPrivate(ctx: Context, scope: CodexScope): Promise<boolean> {
  if (await soleOwnerGroup(ctx.api, scope.telegramChatId, scope.ownerTelegramId)) return true;
  try {
    await ctx.api.sendMessage(
      scope.ownerTelegramId,
      "Private Codex mode is paused in its group because another member is present. Remove the other member before sending Codex prompts there."
    );
  } catch {
    // Stay silent in the configured group so the private mode is not exposed.
  }
  return false;
}

export async function soleOwnerGroup(api: Bot["api"], chatId: string, ownerTelegramId: string): Promise<boolean> {
  try {
    const [memberCount, owner] = await Promise.all([
      api.getChatMemberCount(chatId),
      api.getChatMember(chatId, Number(ownerTelegramId))
    ]);
    return isSoleOwnerMembership(
      memberCount,
      owner.status,
      owner.status === "restricted" ? owner.is_member : undefined
    );
  } catch {
    // Fail closed if Telegram cannot prove the exact owner is present alone with the bot.
    return false;
  }
}

export function isSoleOwnerMembership(
  memberCount: number,
  ownerStatus: string,
  restrictedIsMember?: boolean
): boolean {
  return memberCount === 2
    && ownerStatus !== "left"
    && ownerStatus !== "kicked"
    && (ownerStatus !== "restricted" || restrictedIsMember === true);
}

function privateCodexReportAccess(ctx: Context): { scope: CodexScope; inConfiguredGroup: boolean } | undefined {
  const config = privateCodexConfig();
  if (!config) return undefined;
  const scope = {
    ownerTelegramId: config.ownerTelegramId,
    telegramChatId: config.telegramChatId
  };
  const chatId = String(ctx.chat?.id ?? "");
  if (!isPrivateCodexReportActor({
    telegramUserId: ctx.from?.id ? String(ctx.from.id) : undefined,
    telegramChatId: chatId,
    chatType: ctx.chat?.type
  }, scope)) return undefined;
  return { scope, inConfiguredGroup: chatId === scope.telegramChatId };
}

function displayPath(path: string, maxCodePoints: number): string {
  const points = Array.from(path);
  return points.length <= maxCodePoints ? path : `…${points.slice(-(maxCodePoints - 1)).join("")}`;
}
