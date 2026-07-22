import { Api, InlineKeyboard, type Bot, type Context } from "grammy";
import { DateTime } from "luxon";
import { ensureUser } from "../services/users";
import {
  GroupSchedulingError,
  cancelAvailabilityPoll,
  createAvailabilityPoll,
  finalizeAvailabilityPoll,
  getAvailabilityPoll,
  isFindTimeIntent,
  listAvailabilityPolls,
  parseFindTimeRequest,
  prepareAvailabilityReminder,
  releaseAvailabilityReminderReservation,
  setAvailabilityTelegramMessage,
  updateAvailabilityCalendar,
  type AvailabilityPollView,
  type SchedulingActor,
  type SchedulingScope,
} from "../services/groupScheduling";
import { groupWorkspaceForContext, refreshGroupMemberRole } from "../services/groupWorkspaces";
import { bold, h, HTML_REPLY, editOrReplyHtml } from "../utils/html";
import { prepareNaturalLanguageText, isGroupChat } from "./groupRouting";
import { groupScheduleMiniAppUrl } from "./links";
import { userFacingError } from "./errorResponses";

const apiCache = new Map<string, { api: Api; username?: string }>();

export function registerGroupScheduling(bot: Bot): void {
  bot.command(["findtime", "schedule"], async (ctx) => {
    if (!isGroupChat(ctx)) {
      await ctx.reply("Find a time is built for Telegram groups. Add Threadwise to a group, then run /findtime there.");
      return;
    }
    const requested = commandArguments(ctx.msg?.text ?? "");
    if (!requested) {
      await showFindTimeMenu(ctx);
      return;
    }
    await createPollFromText(ctx, requested);
  });

  bot.callbackQuery("menu:find-time", async (ctx) => {
    await safeAnswer(ctx);
    await showFindTimeMenu(ctx);
  });

  bot.callbackQuery(/^schedule:open:([^:]+)$/, async (ctx) => {
    try {
      const ready = await schedulingContext(ctx);
      const poll = await getAvailabilityPoll(ready.scope, ctx.match[1]!);
      await editOrReplyHtml(ctx, formatAvailabilityPollCard(poll), { reply_markup: availabilityPollKeyboard(poll, ready.scope.workspaceId, ctx.me.username) });
      await safeAnswer(ctx);
    } catch (error) {
      await answerOrReplyError(ctx, error);
    }
  });

  bot.callbackQuery(/^schedule:final:([^:]+):(\d+):(\d+)$/, async (ctx) => {
    try {
      const ready = await schedulingContext(ctx);
      assertSchedulingManager(ready.scope, "Only a group owner or administrator can finalize a time.");
      const current = await getAvailabilityPoll(ready.scope, ctx.match[1]!);
      const slot = current.bestSlots[Number(ctx.match[2])];
      if (!slot) throw new GroupSchedulingError("conflict", "That suggestion changed. Open the latest poll and try again.");
      const poll = await finalizeAvailabilityPoll(ready.scope, actorFromContext(ctx), current.id, slot.startAt, Number(ctx.match[3]));
      await editCurrentCard(ctx, ready.scope.workspaceId, poll);
      await ctx.answerCallbackQuery({ text: "Meeting confirmed." }).catch(() => undefined);
      await ctx.reply(`Meeting confirmed: ${formatFinalTime(poll)}.`);
    } catch (error) {
      await answerOrReplyError(ctx, error);
    }
  });

  bot.callbackQuery(/^schedule:nudge:([^:]+)$/, async (ctx) => {
    try {
      const ready = await schedulingContext(ctx);
      assertSchedulingManager(ready.scope, "Only a group owner or administrator can remind the group.");
      const result = await prepareAvailabilityReminder(ready.scope, ctx.match[1]!);
      if (result.pendingMembers.length === 0) {
        await ctx.answerCallbackQuery({ text: "Everyone has responded." }).catch(() => undefined);
        return;
      }
      try {
        await ctx.reply(formatPendingReminder(result.poll, result.pendingMembers), HTML_REPLY);
      } catch (error) {
        await releaseAvailabilityReminderReservation(ready.scope, result.poll.id, result.reservationAt);
        throw error;
      }
      await editCurrentCard(ctx, ready.scope.workspaceId, result.poll);
      await ctx.answerCallbackQuery({ text: "Reminder posted." }).catch(() => undefined);
    } catch (error) {
      await answerOrReplyError(ctx, error);
    }
  });

  bot.callbackQuery(/^schedule:cancel:([^:]+):(\d+)$/, async (ctx) => {
    try {
      const ready = await schedulingContext(ctx);
      assertSchedulingManager(ready.scope, "Only a group owner or administrator can close this poll.");
      const poll = await cancelAvailabilityPoll(ready.scope, actorFromContext(ctx), ctx.match[1]!, Number(ctx.match[2]));
      await editCurrentCard(ctx, ready.scope.workspaceId, poll);
      await ctx.answerCallbackQuery({ text: "Poll closed." }).catch(() => undefined);
    } catch (error) {
      await answerOrReplyError(ctx, error);
    }
  });

  bot.callbackQuery(/^schedule:calendar:([^:]+)$/, async (ctx) => {
    try {
      const ready = await schedulingContext(ctx);
      const poll = await updateAvailabilityCalendar(ready.scope, ctx.match[1]!, "sync");
      await editCurrentCard(ctx, ready.scope.workspaceId, poll);
      await ctx.answerCallbackQuery({ text: "Added to Google Calendar." }).catch(() => undefined);
    } catch (error) {
      await answerOrReplyError(ctx, error);
    }
  });

  bot.on("message:text", async (ctx, next) => {
    if (!isGroupChat(ctx)) return next();
    const text = prepareNaturalLanguageText(ctx, ctx.message.text);
    if (!text || !isFindTimeIntent(text)) return next();
    await createPollFromText(ctx, text);
  });
}

export async function publishAvailabilityPollCardWithToken(
  botToken: string,
  scope: SchedulingScope,
  poll: AvailabilityPollView,
): Promise<void> {
  const client = await botClient(botToken);
  const message = await client.api.sendMessage(scope.telegramChatId, formatAvailabilityPollCard(poll), {
    ...HTML_REPLY,
    reply_markup: availabilityPollKeyboard(poll, scope.workspaceId, client.username),
  });
  await setAvailabilityTelegramMessage(scope, poll.id, String(message.message_id));
}

export async function refreshAvailabilityPollCardWithToken(
  botToken: string,
  scope: SchedulingScope,
  poll: AvailabilityPollView,
): Promise<void> {
  if (!poll.telegramMessageId) return;
  const client = await botClient(botToken);
  try {
    await client.api.editMessageText(scope.telegramChatId, Number(poll.telegramMessageId), formatAvailabilityPollCard(poll), {
      ...HTML_REPLY,
      reply_markup: availabilityPollKeyboard(poll, scope.workspaceId, client.username),
    });
  } catch (error) {
    if (!String(error).toLowerCase().includes("message is not modified")) throw error;
  }
}

export async function sendAvailabilityReminderWithToken(
  botToken: string,
  scope: SchedulingScope,
  poll: AvailabilityPollView,
  pendingMembers: AvailabilityPollView["pendingMembers"],
): Promise<void> {
  if (pendingMembers.length === 0) return;
  const client = await botClient(botToken);
  await client.api.sendMessage(scope.telegramChatId, formatPendingReminder(poll, pendingMembers), HTML_REPLY);
}

export function formatAvailabilityPollCard(poll: AvailabilityPollView): string {
  const range = formatDateRange(poll);
  if (poll.status === "FINALIZED") {
    return [
      `${bold("Meeting confirmed")} · ${h(poll.publicId)}`,
      bold(poll.title),
      formatFinalTime(poll),
      `${poll.respondentCount}/${poll.memberCount} responded`,
    ].join("\n");
  }
  if (poll.status === "CANCELED") {
    return [`${bold("Availability poll closed")} · ${h(poll.publicId)}`, bold(poll.title), range].join("\n");
  }
  const best = poll.bestSlots[0];
  return [
    `${bold("Find a time")} · ${h(poll.publicId)}`,
    bold(poll.title),
    `${range} · ${formatDuration(poll.durationMinutes)}`,
    `${poll.respondentCount}/${poll.memberCount} responded`,
    best?.availableCount
      ? `Best so far: ${h(formatSlot(best.startAt, poll.timezone))} · ${best.availableCount} free`
      : "Add your availability to reveal the best overlap.",
  ].join("\n");
}

export function availabilityPollKeyboard(poll: AvailabilityPollView, workspaceId: string, botUsername?: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const openUrl = groupScheduleMiniAppUrl(botUsername, workspaceId, poll.publicId);
  if (poll.status === "OPEN") {
    keyboard.url("Add or update availability", openUrl).row();
    poll.bestSlots.slice(0, 2).forEach((slot, index) => {
      if (slot.availableCount > 0) keyboard.text(`Confirm ${formatShortSlot(slot.startAt, poll.timezone)}`, `schedule:final:${poll.publicId}:${index}:${poll.revision}`).row();
    });
    keyboard.text("Remind pending", `schedule:nudge:${poll.publicId}`)
      .text("Close poll", `schedule:cancel:${poll.publicId}:${poll.revision}`);
  } else if (poll.status === "FINALIZED") {
    keyboard.url("View meeting", openUrl).row();
    keyboard.text("Add to my Calendar", `schedule:calendar:${poll.publicId}`);
  } else {
    keyboard.url("View poll", openUrl);
  }
  return keyboard;
}

async function showFindTimeMenu(ctx: Context): Promise<void> {
  try {
    const ready = await schedulingContext(ctx);
    const polls = await listAvailabilityPolls(ready.scope);
    const active = polls.filter((poll) => poll.status === "OPEN").slice(0, 5);
    const manager = isSchedulingManager(ready.scope);
    const keyboard = new InlineKeyboard();
    if (manager) keyboard.url("Create availability poll", groupScheduleMiniAppUrl(ctx.me.username, ready.scope.workspaceId, undefined, true)).row();
    for (const poll of active) keyboard.text(`${poll.publicId} · ${poll.title}`.slice(0, 54), `schedule:open:${poll.publicId}`).row();
    keyboard.url("Open Find a time", groupScheduleMiniAppUrl(ctx.me.username, ready.scope.workspaceId));
    await editOrReplyHtml(ctx, [bold("Find a time"), active.length ? `${active.length} active poll${active.length === 1 ? "" : "s"}.` : "No active polls."].join("\n"), { reply_markup: keyboard });
  } catch (error) {
    await ctx.reply(userFacingError(error, "I couldn't open group scheduling just now."));
  }
}

async function createPollFromText(ctx: Context, text: string): Promise<void> {
  try {
    const ready = await schedulingContext(ctx);
    if (!isSchedulingManager(ready.scope)) {
      await ctx.reply("Only a group owner or administrator can start an availability poll. You can still respond to any active poll.");
      return;
    }
    const poll = await createAvailabilityPoll(ready.scope, actorFromContext(ctx), parseFindTimeRequest(text, ready.timezone));
    const message = await ctx.reply(formatAvailabilityPollCard(poll), { ...HTML_REPLY, reply_markup: availabilityPollKeyboard(poll, ready.scope.workspaceId, ctx.me.username) });
    await setAvailabilityTelegramMessage(ready.scope, poll.id, String(message.message_id));
  } catch (error) {
    await ctx.reply(userFacingError(error, "I couldn't start that availability poll. Try /findtime without details and use the form."));
  }
}

async function schedulingContext(ctx: Context): Promise<{ scope: SchedulingScope; timezone: string }> {
  if (!isGroupChat(ctx) || !ctx.from || !ctx.chat) throw new GroupSchedulingError("forbidden", "Find a time is available in group chats.");
  const user = await ensureUser(ctx);
  const workspace = await groupWorkspaceForContext(ctx);
  const role = await refreshGroupMemberRole(ctx);
  if (!workspace || !role) throw new GroupSchedulingError("forbidden", "Threadwise could not verify this group workspace.");
  return {
    scope: {
      workspaceId: workspace.id,
      ownerTelegramId: user.telegramId,
      telegramChatId: String(ctx.chat.id),
      viewerTelegramId: String(ctx.from.id),
      viewerRole: role,
    },
    timezone: user.settings?.timezone ?? "Asia/Singapore",
  };
}

function actorFromContext(ctx: Context): SchedulingActor {
  if (!ctx.from) throw new GroupSchedulingError("forbidden", "Telegram could not identify you.");
  return { telegramId: String(ctx.from.id), displayName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || ctx.from.username || "Group member" };
}

function isSchedulingManager(scope: SchedulingScope): boolean {
  return scope.viewerRole === "OWNER" || scope.viewerRole === "ADMIN";
}

function assertSchedulingManager(scope: SchedulingScope, message: string): void {
  if (!isSchedulingManager(scope)) throw new GroupSchedulingError("forbidden", message);
}

async function editCurrentCard(ctx: Context, workspaceId: string, poll: AvailabilityPollView): Promise<void> {
  try {
    await ctx.editMessageText(formatAvailabilityPollCard(poll), { ...HTML_REPLY, reply_markup: availabilityPollKeyboard(poll, workspaceId, ctx.me.username) });
  } catch (error) {
    if (!String(error).toLowerCase().includes("message is not modified")) throw error;
  }
}

async function answerOrReplyError(ctx: Context, error: unknown): Promise<void> {
  const message = userFacingError(error, "I couldn't update that availability poll just now.");
  try {
    await ctx.answerCallbackQuery({ text: message.slice(0, 180), show_alert: true });
  } catch {
    await ctx.reply(message);
  }
}

async function safeAnswer(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => undefined);
}

async function botClient(token: string): Promise<{ api: Api; username?: string }> {
  const existing = apiCache.get(token);
  if (existing?.username) return existing;
  const client = existing ?? { api: new Api(token), username: undefined };
  if (!existing) apiCache.set(token, client);
  try {
    client.username = (await client.api.getMe()).username;
  } catch {
    // A direct dashboard link remains available if Telegram's getMe call is briefly unavailable.
  }
  return client;
}

function formatPendingReminder(poll: AvailabilityPollView, pending: AvailabilityPollView["pendingMembers"]): string {
  const names = pending.slice(0, 20).map((member) => member.username
    ? `@${h(member.username)}`
    : `<a href="tg://user?id=${encodeURIComponent(member.telegramId)}">${h(member.displayName)}</a>`);
  return [`${bold("Availability reminder")} · ${h(poll.publicId)}`, h(poll.title), names.join(" "), "Add your times when you can."].join("\n");
}

function formatDateRange(poll: Pick<AvailabilityPollView, "startDate" | "endDate" | "timezone">): string {
  const start = DateTime.fromISO(poll.startDate, { zone: poll.timezone });
  const end = DateTime.fromISO(poll.endDate, { zone: poll.timezone });
  return start.hasSame(end, "day") ? start.toFormat("ccc, d LLL") : `${start.toFormat("d LLL")}–${end.toFormat("d LLL")}`;
}

function formatSlot(value: string, timezone: string): string {
  return DateTime.fromISO(value, { setZone: true }).setZone(timezone).toFormat("ccc, d LLL · h:mm a");
}

function formatShortSlot(value: string, timezone: string): string {
  return DateTime.fromISO(value, { setZone: true }).setZone(timezone).toFormat("ccc h:mm a");
}

function formatFinalTime(poll: AvailabilityPollView): string {
  return poll.finalStartAt ? `${formatSlot(poll.finalStartAt, poll.timezone)} (${poll.timezone})` : "Time pending";
}

function formatDuration(minutes: number): string {
  return minutes < 60 ? `${minutes} min` : minutes % 60 === 0 ? `${minutes / 60} hr` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

function commandArguments(text: string): string {
  return text.replace(/^\/(?:findtime|schedule)(?:@[A-Za-z0-9_]+)?\s*/i, "").trim();
}
