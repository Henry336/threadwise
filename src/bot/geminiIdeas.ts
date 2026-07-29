import { CodexJobStatus } from "@prisma/client";
import { InlineKeyboard, type Bot, type Context } from "grammy";
import { privateCodexConfig } from "../config/env";
import { logger } from "../logger";
import {
  findGeminiIdeaJob,
  geminiIdeaActionLabel,
  isGeminiIdeaAction,
  localWorkerReadiness,
  markGeminiIdeaJobDelivered,
  queueGeminiIdeaJob,
  undeliveredGeminiIdeaJobs,
  type GeminiIdeaJobWithIdea
} from "../services/geminiIdeas";
import { ensureUser } from "../services/users";
import { bold, code, h, replyHtml } from "../utils/html";
import { splitTelegramReport } from "../services/codex";

const GEMINI_REPORT_PAGE_CHARS = 2_900;

export function registerGeminiIdeas(bot: Bot): void {
  bot.callbackQuery(/^gemini-idea:(develop|challenge|next|tasks):(.+)$/, async (ctx) => {
    const action = ctx.match[1];
    const ideaId = ctx.match[2];
    if (!action || !isGeminiIdeaAction(action) || !ideaId) return;
    const scope = ownerScope(ctx);
    if (!scope) {
      await ctx.answerCallbackQuery({ text: "Ideas Intelligence is owner-only.", show_alert: true });
      return;
    }

    const readiness = await localWorkerReadiness(scope);
    if (!readiness.online) {
      await ctx.answerCallbackQuery({
        text: "The laptop worker has not checked in recently. It should reconnect after Windows sign-in.",
        show_alert: true
      });
      return;
    }
    if (!readiness.geminiAvailable) {
      await ctx.answerCallbackQuery({
        text: "Gemini CLI is not ready on the laptop yet. Install and sign in once, then retry.",
        show_alert: true
      });
      return;
    }

    const user = await ensureUser(ctx);
    const queued = await queueGeminiIdeaJob({
      userId: user.id,
      ideaId,
      requesterTelegramId: String(ctx.from!.id),
      telegramChatId: String(ctx.chat!.id),
      telegramRequestMessageId: ctx.callbackQuery.message?.message_id,
      action
    });
    await ctx.answerCallbackQuery({
      text: queued.alreadyQueued ? "That analysis is already queued." : "Sent to Gemini Ideas Intelligence."
    });
    await replyHtml(ctx, [
      bold(queued.alreadyQueued ? "Already queued" : "Ideas Intelligence queued"),
      `${h(geminiIdeaActionLabel(action))}: ${h(queued.job.idea.title)}`,
      readiness.geminiModel ? `Model: ${code(readiness.geminiModel)}` : undefined,
      "The result will arrive here when the laptop worker finishes."
    ].filter(Boolean).join("\n"));
  });

  bot.callbackQuery(/^gemini-idea-report:([0-9a-f-]+):(\d+)$/, async (ctx) => {
    if (!ownerScope(ctx)) {
      await ctx.answerCallbackQuery();
      return;
    }
    const job = await findGeminiIdeaJob(ctx.match[1]!);
    if (!job || job.requesterTelegramId !== String(ctx.from!.id)) {
      await ctx.answerCallbackQuery({ text: "This analysis is no longer available." });
      return;
    }
    const pages = geminiIdeaReportPages(job);
    const page = clampPage(Number(ctx.match[2]), pages.length);
    await ctx.editMessageText(renderGeminiIdeaReport(job, pages, page), {
      reply_markup: geminiIdeaReportKeyboard(job.id, page, pages.length)
    });
    await ctx.answerCallbackQuery();
  });
}

export async function deliverGeminiIdeaJobOnce(bot: Bot, job: GeminiIdeaJobWithIdea): Promise<void> {
  if (job.deliveredAt) return;
  const pages = geminiIdeaReportPages(job);
  await bot.api.sendMessage(job.telegramChatId, renderGeminiIdeaReport(job, pages, 0), {
    ...(job.telegramRequestMessageId
      ? { reply_parameters: { message_id: job.telegramRequestMessageId, allow_sending_without_reply: true } }
      : {}),
    reply_markup: geminiIdeaReportKeyboard(job.id, 0, pages.length)
  });
  await markGeminiIdeaJobDelivered(job.id);
}

export function startGeminiIdeaDeliveryLoop(bot: Bot, intervalMs = 60_000): NodeJS.Timeout | undefined {
  if (!privateCodexConfig()) return undefined;
  let active = false;
  return setInterval(() => {
    if (active) return;
    active = true;
    void (async () => {
      try {
        const jobs = await undeliveredGeminiIdeaJobs(new Date(Date.now() - 60_000));
        for (const job of jobs) {
          try {
            await deliverGeminiIdeaJobOnce(bot, job);
          } catch (error) {
            logger.warn("Gemini idea report retry failed.", { jobId: job.id, error: String(error) });
          }
        }
      } catch (error) {
        logger.warn("Gemini idea delivery retry pass failed.", { error: String(error) });
      } finally {
        active = false;
      }
    })();
  }, intervalMs);
}

function ownerScope(ctx: Context) {
  const config = privateCodexConfig();
  if (!config || String(ctx.from?.id ?? "") !== config.ownerTelegramId) return undefined;
  return {
    ownerTelegramId: config.ownerTelegramId,
    telegramChatId: config.telegramChatId
  };
}

function geminiIdeaReportPages(job: GeminiIdeaJobWithIdea): string[] {
  const content = job.status === CodexJobStatus.COMPLETED
    ? job.finalResponse || "(Gemini returned an empty response.)"
    : job.error || "The local Gemini worker did not provide an error.";
  return splitTelegramReport(content, GEMINI_REPORT_PAGE_CHARS);
}

function renderGeminiIdeaReport(job: GeminiIdeaJobWithIdea, pages: string[], page: number): string {
  return [
    job.status === CodexJobStatus.COMPLETED ? "✨ Ideas Intelligence" : "❌ Ideas Intelligence failed",
    `Idea: ${job.idea.publicId} · ${job.idea.title}`,
    `Action: ${geminiIdeaActionLabel(job.action)}`,
    `Model: ${job.model ?? "Gemini local default"}`,
    `Page: ${page + 1}/${pages.length}`,
    "",
    pages[page] ?? ""
  ].join("\n");
}

function geminiIdeaReportKeyboard(jobId: string, page: number, totalPages: number): InlineKeyboard | undefined {
  if (totalPages <= 1) return undefined;
  const keyboard = new InlineKeyboard();
  if (page > 0) keyboard.text("‹ Previous", `gemini-idea-report:${jobId}:${page - 1}`);
  if (page + 1 < totalPages) keyboard.text("Next ›", `gemini-idea-report:${jobId}:${page + 1}`);
  return keyboard;
}

function clampPage(page: number, totalPages: number): number {
  return Math.max(0, Math.min(Number.isFinite(page) ? Math.floor(page) : 0, Math.max(0, totalPages - 1)));
}
