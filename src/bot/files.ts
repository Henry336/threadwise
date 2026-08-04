import {
  FileCourierJobKind,
  FileCourierJobStatus
} from "@prisma/client";
import { InlineKeyboard, type Bot, type Context } from "grammy";
import { privateCodexConfig } from "../config/env";
import { logger } from "../logger";
import {
  cancelFileCourierJob,
  findFileCourierJob,
  isFileCourierActor,
  markFileCourierJobDelivered,
  queueFileCourierLookup,
  queueFileCourierSend,
  recordFileCourierAudit,
  undeliveredFileCourierJobs,
  type FileCourierJobWithResults,
  type FileCourierScope
} from "../services/fileCourier";
import { formatBytes } from "../services/fileCourierLocal";
import {
  FILE_COURIER_RESULT_LIMIT,
  fileCourierPage
} from "../services/fileCourierPolicy";
import { localWorkerReadiness } from "../services/geminiIdeas";
import { soleOwnerGroup } from "./codex";

export type ParsedFileCourierCommand =
  | { action: "help" }
  | { action: "search"; query: string; sortLatest: boolean }
  | { action: "recent" }
  | { action: "lookup"; path: string }
  | { action: "error"; message: string };

export function registerFileCourier(bot: Bot): void {
  bot.command("files", async (ctx) => {
    const scope = fileCourierScopeForContext(ctx);
    if (!scope || !await fileCourierChatIsPrivate(ctx, scope)) return;
    await handleFileCourierCommand(ctx, scope, parseFileCourierCommand(commandBody(ctx.message?.text ?? "")));
  });

  bot.callbackQuery(/^files:page:([0-9a-f-]+):(\d+)$/, async (ctx) => {
    const scope = fileCourierScopeForContext(ctx);
    if (!scope || !await fileCourierChatIsPrivate(ctx, scope)) {
      await silentlyAnswer(ctx);
      return;
    }
    const job = await findFileCourierJob(scope, ctx.match[1]!);
    if (
      !job
      || job.requesterTelegramId !== String(ctx.from!.id)
      || job.status !== FileCourierJobStatus.COMPLETED
      || job.kind === FileCourierJobKind.SEND
    ) {
      await ctx.answerCallbackQuery({ text: "Those file results are no longer available.", show_alert: true });
      return;
    }
    const requestedPage = Number(ctx.match[2]);
    const pagination = fileCourierPage(job.results, requestedPage);
    try {
      await ctx.editMessageText(renderFileCourierResult(job, pagination.page), {
        reply_markup: fileResultKeyboard(job, pagination.page)
      });
    } catch (error) {
      if (!String(error).toLowerCase().includes("message is not modified")) throw error;
    }
    await ctx.answerCallbackQuery({ text: `Page ${pagination.page + 1} of ${pagination.pageCount}` });
    await recordFileCourierAudit(job.id, "PAGE_VIEWED", "COMPLETED", {
      page: pagination.page + 1,
      pageCount: pagination.pageCount
    }).catch((error) => {
      logger.warn("File courier page audit failed.", { jobId: job.id, error: String(error) });
    });
  });

  bot.callbackQuery(/^files:send:([0-9a-f-]+)$/, async (ctx) => {
    const scope = fileCourierScopeForContext(ctx);
    if (!scope || !await fileCourierChatIsPrivate(ctx, scope)) {
      await silentlyAnswer(ctx);
      return;
    }
    const readiness = await localWorkerReadiness(scope);
    if (!readiness.online) {
      await ctx.answerCallbackQuery({
        text: "The laptop worker is offline. Start it, then tap Send again.",
        show_alert: true
      });
      return;
    }
    if (!readiness.fileCourierAvailable) {
      await ctx.answerCallbackQuery({
        text: "File courier is not configured on the laptop. Set THREADWISE_FILE_ROOTS and restart the worker.",
        show_alert: true
      });
      return;
    }
    const job = await queueFileCourierSend({
      scope,
      requesterTelegramId: String(ctx.from!.id),
      resultId: ctx.match[1]!,
      telegramRequestMessageId: ctx.callbackQuery.message?.message_id
    });
    if (!job) {
      await ctx.answerCallbackQuery({ text: "That file result is no longer available.", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: "Send queued." });
    await ctx.reply(
      `Preparing ${job.selectedFileName ?? "the selected file"} on your laptop. Request ${job.id.slice(0, 8)}.`,
      { reply_markup: cancelKeyboard(job.id) }
    );
  });

  bot.callbackQuery(/^files:cancel:([0-9a-f-]+)$/, async (ctx) => {
    const scope = fileCourierScopeForContext(ctx);
    if (!scope || !await fileCourierChatIsPrivate(ctx, scope)) {
      await silentlyAnswer(ctx);
      return;
    }
    const result = await cancelFileCourierJob(scope, ctx.match[1]!, String(ctx.from!.id));
    await ctx.answerCallbackQuery({
      text: result === "canceled"
        ? "Canceled."
        : result === "busy"
          ? "That request is already running or finished."
          : "That request is no longer available.",
      show_alert: result !== "canceled"
    });
    if (result === "canceled") {
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
    }
  });

  bot.on("message:text", async (ctx, next) => {
    const scope = fileCourierScopeForContext(ctx);
    if (!scope || ctx.message.text.startsWith("/")) {
      await next();
      return;
    }
    const parsed = parseNaturalLaptopFileRequest(ctx.message.text);
    if (!parsed) {
      await next();
      return;
    }
    if (!await fileCourierChatIsPrivate(ctx, scope)) return;
    await handleFileCourierCommand(ctx, scope, parsed);
  });
}

export function fileCourierScopeForContext(ctx: Context): FileCourierScope | undefined {
  const config = privateCodexConfig();
  if (!config) return undefined;
  const scope = {
    ownerTelegramId: config.ownerTelegramId,
    telegramChatId: config.telegramChatId
  };
  return isFileCourierActor({
    telegramUserId: ctx.from?.id ? String(ctx.from.id) : undefined,
    telegramChatId: ctx.chat?.id ? String(ctx.chat.id) : undefined
  }, scope) ? scope : undefined;
}

export function parseFileCourierCommand(input: string): ParsedFileCourierCommand {
  const value = input.trim();
  if (!value || /^(?:help|\?)$/i.test(value)) return { action: "help" };
  if (/^recent$/i.test(value)) return { action: "recent" };
  const find = value.match(/^find\s+(.+)$/is);
  if (find) {
    const query = stripWrappingQuotes(find[1]!.trim());
    return query
      ? { action: "search", query, sortLatest: false }
      : { action: "error", message: "Add a filename or phrase to find." };
  }
  const get = value.match(/^get\s+(.+)$/is);
  if (get) {
    const path = stripWrappingQuotes(get[1]!.trim());
    return path
      ? { action: "lookup", path }
      : { action: "error", message: "Add an absolute laptop file path." };
  }
  return {
    action: "error",
    message: "Use /files find <name>, /files recent, or /files get \"C:\\absolute\\path\"."
  };
}

export function parseNaturalLaptopFileRequest(text: string): ParsedFileCourierCommand | undefined {
  const value = text.trim();
  const latest = value.match(
    /^(?:please\s+)?send me (?:the\s+)?(?:latest|newest|most recent)\s+(.+?)\s+from (?:my|the) laptop[.!?]*$/i
  );
  if (latest?.[1]?.trim()) {
    return { action: "search", query: latest[1].trim(), sortLatest: true };
  }
  const find = value.match(
    /^(?:please\s+)?(?:find|look for|search for)\s+(.+?)\s+(?:on|from)\s+(?:my|the)\s+laptop[.!?]*$/i
  );
  if (find?.[1]?.trim()) {
    return { action: "search", query: find[1].trim(), sortLatest: false };
  }
  return undefined;
}

export async function deliverFileCourierJobOnce(bot: Bot, job: FileCourierJobWithResults): Promise<void> {
  if (
    job.deliveredAt
    || (job.kind === FileCourierJobKind.SEND && job.status !== FileCourierJobStatus.FAILED)
  ) return;
  const sent = await bot.api.sendMessage(
    job.telegramChatId,
    renderFileCourierResult(job),
    {
      ...(job.telegramRequestMessageId
        ? { reply_parameters: { message_id: job.telegramRequestMessageId, allow_sending_without_reply: true } }
        : {}),
      reply_markup: fileResultKeyboard(job)
    }
  );
  await markFileCourierJobDelivered(
    { ownerTelegramId: job.ownerTelegramId, telegramChatId: job.telegramChatId },
    job.id,
    sent.message_id
  );
}

export function startFileCourierDeliveryLoop(bot: Bot, intervalMs = 60_000): NodeJS.Timeout | undefined {
  const config = privateCodexConfig();
  if (!config) return undefined;
  const scope = { ownerTelegramId: config.ownerTelegramId, telegramChatId: config.telegramChatId };
  let active = false;
  return setInterval(() => {
    if (active) return;
    active = true;
    void (async () => {
      try {
        const jobs = await undeliveredFileCourierJobs(scope, new Date(Date.now() - 60_000));
        for (const job of jobs) {
          try {
            await deliverFileCourierJobOnce(bot, job);
          } catch (error) {
            logger.warn("File courier result retry failed.", { jobId: job.id, error: String(error) });
          }
        }
      } catch (error) {
        logger.warn("File courier delivery retry pass failed.", { error: String(error) });
      } finally {
        active = false;
      }
    })();
  }, intervalMs);
}

export function renderFileCourierResult(job: FileCourierJobWithResults, requestedPage = 0): string {
  if (job.status === FileCourierJobStatus.FAILED) {
    return [
      "❌ Laptop file request failed",
      `Request ${job.id.slice(0, 8)}`,
      job.error || "The laptop worker did not provide an error."
    ].join("\n");
  }
  if (job.results.length === 0) {
    return [
      "Laptop files",
      queryLabel(job),
      "No matching files were found in your configured laptop roots."
    ].join("\n");
  }
  const pagination = fileCourierPage(job.results, requestedPage);
  return [
    "Laptop files",
    queryLabel(job),
    `Page ${pagination.page + 1} of ${pagination.pageCount} · ${job.results.length} result${job.results.length === 1 ? "" : "s"}`,
    "",
    ...pagination.items.flatMap((result, index) => [
      `${pagination.startIndex + index + 1}. ${truncate(result.fileName, 100)}`,
      truncate(result.parentPath, 140),
      `${formatBytes(Number(result.sizeBytes))} · ${result.modifiedAt.toISOString()} · ${result.fileType}`,
      ""
    ]),
    job.results.length >= FILE_COURIER_RESULT_LIMIT
      ? `Showing the first ${FILE_COURIER_RESULT_LIMIT} matches. Refine the search phrase if the file is not listed.`
      : undefined,
    "Tap Send for the exact file you want. Nothing is transferred before that tap."
  ].filter((line) => line !== undefined).join("\n").trim();
}

export function fileResultKeyboard(
  job: FileCourierJobWithResults,
  requestedPage = 0
): InlineKeyboard | undefined {
  if (job.status !== FileCourierJobStatus.COMPLETED || job.results.length === 0) return undefined;
  const pagination = fileCourierPage(job.results, requestedPage);
  const keyboard = new InlineKeyboard();
  pagination.items.forEach((result, index) => {
    keyboard.text(`Send ${pagination.startIndex + index + 1}`, `files:send:${result.id}`).row();
  });
  if (pagination.page > 0) {
    keyboard.text("◀ Previous", `files:page:${job.id}:${pagination.page - 1}`);
  }
  if (pagination.page + 1 < pagination.pageCount) {
    keyboard.text("Next ▶", `files:page:${job.id}:${pagination.page + 1}`);
  }
  if (pagination.pageCount > 1) keyboard.row();
  return keyboard;
}

function cancelKeyboard(jobId: string): InlineKeyboard {
  return new InlineKeyboard().text("Cancel", `files:cancel:${jobId}`);
}

async function handleFileCourierCommand(
  ctx: Context,
  scope: FileCourierScope,
  parsed: ParsedFileCourierCommand
): Promise<void> {
  if (parsed.action === "help") {
    await ctx.reply([
      "Private laptop files",
      "/files find <name or phrase>",
      "/files recent",
      "/files get \"C:\\absolute\\path\"",
      "",
      "Searches only the explicit THREADWISE_FILE_ROOTS on your laptop. Results show metadata first; tap Send to transfer one file.",
      "The standard Telegram Bot API currently accepts files up to 50 MB."
    ].join("\n"));
    return;
  }
  if (parsed.action === "error") {
    await ctx.reply(parsed.message);
    return;
  }
  const readiness = await localWorkerReadiness(scope);
  if (!readiness.online) {
    await ctx.reply("Your laptop worker is offline. Start it on the laptop, then retry this file request.");
    return;
  }
  if (!readiness.fileCourierAvailable) {
    await ctx.reply([
      "Laptop file courier is not configured.",
      "Set THREADWISE_FILE_ROOTS in .env.codex-worker to explicit semicolon-separated folders, then restart the worker.",
      readiness.fileCourierError ? `Worker detail: ${readiness.fileCourierError}` : undefined
    ].filter(Boolean).join("\n"));
    return;
  }
  const request = parsed.action === "recent"
    ? { kind: "RECENT" as const, query: undefined, sortLatest: true }
    : parsed.action === "lookup"
      ? { kind: "LOOKUP" as const, query: parsed.path, sortLatest: false }
      : { kind: "SEARCH" as const, query: parsed.query, sortLatest: parsed.sortLatest };
  const job = await queueFileCourierLookup({
    scope,
    requesterTelegramId: String(ctx.from!.id),
    telegramRequestMessageId: ctx.message?.message_id,
    ...request
  });
  await ctx.reply(
    `${request.kind === "RECENT" ? "Checking recent laptop files" : "Searching your laptop"} · request ${job.id.slice(0, 8)}`,
    { reply_markup: cancelKeyboard(job.id) }
  );
}

async function fileCourierChatIsPrivate(ctx: Context, scope: FileCourierScope): Promise<boolean> {
  if (await soleOwnerGroup(ctx.api, scope.telegramChatId, scope.ownerTelegramId)) return true;
  try {
    await ctx.api.sendMessage(
      scope.ownerTelegramId,
      "Laptop file courier is paused because the configured group is no longer just you and Threadwise."
    );
  } catch {
    // Fail closed and stay silent in the configured group.
  }
  return false;
}

function queryLabel(job: FileCourierJobWithResults): string {
  if (job.kind === FileCourierJobKind.RECENT) return "Most recently modified";
  if (job.kind === FileCourierJobKind.LOOKUP) return "Exact path lookup";
  return `Search: ${truncate(job.query ?? "", 180)}`;
}

function commandBody(text: string): string {
  return text.replace(/^\/files(?:@\w+)?\s*/i, "");
}

function stripWrappingQuotes(value: string): string {
  const match = value.match(/^(["'])([\s\S]*)\1$/);
  return (match?.[2] ?? value).trim();
}

function truncate(value: string, maximum: number): string {
  const points = Array.from(value);
  return points.length <= maximum ? value : `${points.slice(0, maximum - 1).join("")}…`;
}

async function silentlyAnswer(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => undefined);
}
