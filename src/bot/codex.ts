import { CodexJobStatus } from "@prisma/client";
import { InlineKeyboard, type Bot, type Context } from "grammy";
import { privateCodexConfig } from "../config/env";
import {
  codexJobHasReportMessage,
  codexJobForReport,
  findCodexJobByReference,
  findCodexProject,
  findCodexReplyJob,
  isPrivateCodexActor,
  isPrivateCodexReportActor,
  listCodexProjects,
  queueCodexJob,
  recentCodexJobs,
  recordCodexReportMessage,
  markCodexJobDelivered,
  selectCodexProject,
  selectCodexProjectById,
  splitTelegramReport,
  undeliveredCodexJobs,
  type CodexAttachmentInput,
  type CodexJobWithProject,
  type CodexScope
} from "../services/codex";
import { logger } from "../logger";
import { bold, code, h, HTML_REPLY, replyHtml } from "../utils/html";
import { commandBody } from "../utils/text";

export const CODEX_REPORT_PAGE_CHARS = 2_800;
const PROJECTS_PER_PAGE = 8;
const MAX_CODEX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const REASONING_LEVELS = ["minimal", "low", "medium", "high", "xhigh"] as const;
type ReasoningLevel = typeof REASONING_LEVELS[number];

type RunCommand = {
  action: "run";
  prompt: string;
  alias?: string;
  taskRef?: string;
  forceNewThread: boolean;
  model?: string;
  reasoningEffort?: ReasoningLevel;
};

export type ParsedCodexCommand =
  | { action: "help" }
  | { action: "projects" }
  | { action: "models" }
  | { action: "status" }
  | { action: "use"; alias: string }
  | { action: "error"; message: string }
  | RunCommand;

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
    if (!job || (job.status !== CodexJobStatus.COMPLETED && job.status !== CodexJobStatus.FAILED)) {
      await ctx.answerCallbackQuery({ text: "This report is no longer available." });
      return;
    }
    const pages = reportPages(job);
    const page = clampPage(Number(ctx.match[2]), pages.length);
    await ctx.editMessageText(renderReportPage(job, pages, page), {
      reply_markup: reportKeyboard(job.id, page, pages.length)
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
    await editProjectsPage(ctx, scope, Number(ctx.match[2]));
    await ctx.answerCallbackQuery({ text: `Using ${project.alias}` });
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
  if (/^(?:status|jobs?|tasks?)$/i.test(value)) return { action: "status" };

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
      reply_markup: reportKeyboard(job.id, 0, pages.length)
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

  value = value.replace(/^\s*--\s*/, "").trim();
  let alias: string | undefined;
  let taskRef: string | undefined;

  if (/^continue\s+[0-9a-f]{6,36}\s*$/i.test(value) || /^in\s+[a-z0-9][a-z0-9-]*\s*$/i.test(value)) {
    return { action: "error", message: "Add a prompt for Codex to work on." };
  }

  const continuation = value.match(/^continue\s+([0-9a-f]{6,36})\s+(.+)$/is);
  if (continuation?.[1] && continuation[2]) {
    taskRef = continuation[1];
    value = continuation[2];
  } else {
    const inProject = value.match(/^in\s+([a-z0-9][a-z0-9-]*)\s+(.+)$/is);
    if (inProject?.[1] && inProject[2]) {
      alias = inProject[1];
      value = inProject[2];
    }
  }

  const prompt = value.trim();
  if (!prompt) return { action: "error", message: "Add a prompt for Codex to work on." };
  return {
    action: "run",
    prompt,
    alias,
    taskRef,
    forceNewThread,
    model: modelFlag.value,
    reasoningEffort: reasoningFlag.value?.toLowerCase() as ReasoningLevel | undefined
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
      `${code("/codex use threadwise")} select by alias`,
      `${code("in threadwise Fix the bug")} target any project`,
      `${code("continue a1b2c3d4 Add tests")} continue a task by id`,
      `${code("/codex new Start separately")} start a fresh thread`,
      `${code("/codex status")} see task ids and progress`,
      "",
      `${code("--model MODEL_ID")} choose a model for one task`,
      `${code("--reasoning high")} choose minimal, low, medium, high, or xhigh`,
      "",
      `Example: ${code("in threadwise --model gpt-5.6-sol --reasoning high -- Fix CI")}`,
      "Reply to any Codex report—on any page—to continue that exact task and folder.",
      "Send an image or document with a caption to include it in the task."
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

  if (parsed.action === "status") {
    const jobs = await recentCodexJobs(scope, 8);
    if (jobs.length === 0) {
      await ctx.reply("No Codex tasks have been queued yet.");
      return;
    }
    await replyHtml(ctx, [
      bold("Recent Codex tasks"),
      ...jobs.map((job) => [
        `${jobStatusIcon(job.status)} ${code(shortJobId(job.id))} · ${code(job.project.alias)} · ${h(job.status.toLowerCase())}`,
        `${h(shortPrompt(job.prompt))}`,
        job.model || job.reasoningEffort
          ? `${h(job.model ?? "default model")} · reasoning ${h(job.reasoningEffort ?? "default")}`
          : undefined
      ].filter(Boolean).join("\n")),
      "",
      `Continue one with ${code("continue TASK_ID your prompt")} or reply to its report.`
    ].join("\n"));
    return;
  }

  if (parsed.action === "use") {
    const project = await selectCodexProject(scope, parsed.alias);
    if (!project) {
      await ctx.reply(`I couldn't find "${parsed.alias}". Open /codex projects to see and tap an available alias.`);
      return;
    }
    await replyHtml(ctx, `${bold("Active Codex project")} ${code(project.alias)}\n${code(project.path)}\n\nNow send a prompt normally.`);
    return;
  }

  if (parsed.action === "error") {
    await ctx.reply(parsed.message);
    return;
  }

  await queuePromptFromContext(ctx, scope, parsed, attachments);
}

async function handleCodexUpload(ctx: Context, scope: CodexScope, attachment: CodexAttachmentInput): Promise<void> {
  if (attachment.fileSize && attachment.fileSize > MAX_CODEX_ATTACHMENT_BYTES) {
    await ctx.reply("That attachment is larger than the 25 MB Codex upload limit.");
    return;
  }
  const caption = ctx.message?.caption?.trim();
  const input = caption?.replace(/^\/codex(?:@\w+)?\s*/i, "")
    || "Inspect the attached file and help me with it. Report what you found and any work you completed.";
  await handleCodexInput(ctx, input, [attachment]);
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
    await ctx.reply(`I couldn't find a unique Codex task matching "${command.taskRef}". Use /codex status and copy its task id.`);
    return;
  }

  const continuation = referencedJob ?? (command.alias ? undefined : repliedJob);
  if (continuation && !continuation.threadId && !command.forceNewThread) {
    await ctx.reply(
      "That task does not have a resumable Codex thread yet. Wait for its report, or use “new” to start a fresh task in the same project."
    );
    return;
  }
  const project = continuation?.project ?? await findCodexProject(scope, command.alias);
  if (!project) {
    const message = command.alias
      ? `I couldn't find "${command.alias}". Open /codex projects to see and tap an available alias.`
      : "Choose a project first with /codex projects. After that, plain messages use it automatically.";
    await ctx.reply(message);
    return;
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
    forceNewThread: command.forceNewThread
  });
  await replyHtml(ctx, [
    `${bold("Codex queued")} · ${code(project.alias)} · task ${code(shortJobId(job.id))}`,
    `${h(shortPrompt(job.prompt))}`,
    `${h(job.model ?? "default/resumed model")} · reasoning ${h(job.reasoningEffort ?? "default/resumed")}`,
    attachments.length ? `${attachments.length} attachment${attachments.length === 1 ? "" : "s"} included.` : undefined,
    continuation?.threadId && !command.forceNewThread
      ? "Continuing the selected Codex task and project."
      : "A project-labelled completion report will appear here."
  ].filter(Boolean).join("\n"));
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
      "Tap an alias to make it active. You can still target any alias with “in alias …”."
    ].join("\n"),
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

function renderReportPage(job: CodexJobWithProject, pages: string[], page: number): string {
  return [
    job.status === CodexJobStatus.COMPLETED ? "✅ Codex finished" : "❌ Codex task failed",
    `Project: ${job.project.alias}`,
    `Task: ${shortJobId(job.id)}`,
    `Folder: ${displayPath(job.project.path, 500)}`,
    `Model: ${job.model ?? "local/resumed default"}`,
    `Reasoning: ${job.reasoningEffort ?? "local/resumed default"}`,
    `Report page: ${page + 1}/${pages.length}`,
    "",
    pages[page] ?? ""
  ].join("\n");
}

export function reportKeyboard(jobId: string, page: number, totalPages: number): InlineKeyboard | undefined {
  if (totalPages <= 1) return undefined;
  const keyboard = new InlineKeyboard();
  if (page > 0) keyboard.text("‹ Previous", `codex:report:${jobId}:${page - 1}`);
  if (page + 1 < totalPages) keyboard.text("Next ›", `codex:report:${jobId}:${page + 1}`);
  return keyboard;
}

function shortPrompt(prompt: string): string {
  const oneLine = prompt.replace(/\s+/g, " ").trim();
  return oneLine.length <= 140 ? oneLine : `${oneLine.slice(0, 137)}...`;
}

function shortJobId(id: string): string {
  return id.replace(/-/g, "").slice(0, 8);
}

function jobStatusIcon(status: CodexJobStatus): string {
  if (status === CodexJobStatus.COMPLETED) return "✅";
  if (status === CodexJobStatus.FAILED) return "❌";
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

async function soleOwnerGroup(api: Bot["api"], chatId: string, ownerTelegramId: string): Promise<boolean> {
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
