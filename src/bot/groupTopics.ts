import { InlineKeyboard, type Bot, type Context } from "grammy";
import { prisma } from "../db/prisma";
import { groupWorkspaceForContext, isGroupManager } from "../services/groupWorkspaces";
import { ensureUser } from "../services/users";
import { bold, editOrReplyHtml, replyHtml } from "../utils/html";
import { userFacingError } from "./errorResponses";
import { isGroupChat } from "./groupRouting";

const topicCreations = new Set<string>();

export function registerGroupTopics(bot: Bot): void {
  bot.command("threadwise_topic", async (ctx) => createThreadwiseTopic(ctx, false));
  bot.callbackQuery("group:topic:create", async (ctx) => createThreadwiseTopic(ctx, true));
}

async function createThreadwiseTopic(ctx: Context, fromCallback: boolean): Promise<void> {
  if (!isGroupChat(ctx) || !ctx.chat) {
    if (fromCallback) await ctx.answerCallbackQuery({ text: "This is available in Telegram groups." });
    else await ctx.reply("Use this inside a Telegram group with Topics enabled.");
    return;
  }
  if (!(await isGroupManager(ctx))) {
    if (fromCallback) await ctx.answerCallbackQuery({ text: "Only a group administrator can create the Threadwise topic.", show_alert: true });
    else await ctx.reply("Only a Telegram group administrator can create the Threadwise topic.");
    return;
  }
  await ensureUser(ctx);
  const workspace = await groupWorkspaceForContext(ctx);
  if (!workspace) {
    await ctx.reply("I couldn't prepare this group's topic just now. Try again in a moment.");
    return;
  }
  const stored = await prisma.groupWorkspace.findUnique({ where: { id: workspace.id }, select: { threadwiseTopicId: true } });
  if (stored?.threadwiseTopicId) {
    const text = `${bold("Threadwise topic is ready")}\nUse it for TODO imports, task decisions, and other Threadwise controls.`;
    if (fromCallback) {
      await ctx.answerCallbackQuery({ text: "Topic already exists" });
      await editOrReplyHtml(ctx, text, { reply_markup: topicLinkKeyboard(ctx.chat.id, stored.threadwiseTopicId) });
    } else {
      await replyHtml(ctx, text, { reply_markup: topicLinkKeyboard(ctx.chat.id, stored.threadwiseTopicId) });
    }
    return;
  }
  if (ctx.chat.type !== "supergroup" || !("is_forum" in ctx.chat) || ctx.chat.is_forum !== true) {
    const text = "Turn on Topics in this supergroup first, then run /threadwise_topic again.";
    if (fromCallback) await ctx.answerCallbackQuery({ text, show_alert: true });
    else await ctx.reply(text);
    return;
  }
  if (topicCreations.has(workspace.id)) {
    const text = "The Threadwise topic is already being created.";
    if (fromCallback) await ctx.answerCallbackQuery({ text });
    else await ctx.reply(text);
    return;
  }

  topicCreations.add(workspace.id);
  try {
    if (fromCallback) await ctx.answerCallbackQuery({ text: "Creating topic…" });
    const topic = await ctx.api.createForumTopic(ctx.chat.id, "Threadwise");
    await prisma.groupWorkspace.update({
      where: { id: workspace.id },
      data: { threadwiseTopicId: topic.message_thread_id },
    });
    await ctx.api.sendMessage(ctx.chat.id, [
      bold("Threadwise"),
      "Use this topic for shared tasks and decisions.",
      "Paste a list beginning with TODO: or ACTION ITEMS: to review it before import.",
    ].join("\n"), { parse_mode: "HTML", message_thread_id: topic.message_thread_id });
    const text = `${bold("Threadwise topic created")}\nThe group can keep shared task controls in one place.`;
    if (fromCallback) await editOrReplyHtml(ctx, text, { reply_markup: topicLinkKeyboard(ctx.chat.id, topic.message_thread_id) });
    else await replyHtml(ctx, text, { reply_markup: topicLinkKeyboard(ctx.chat.id, topic.message_thread_id) });
  } catch (error) {
    const message = userFacingError(error, "I couldn't create the topic. Make Threadwise an admin with Manage Topics permission, then try again.");
    if (fromCallback) {
      try {
        await ctx.answerCallbackQuery({ text: message.slice(0, 180), show_alert: true });
      } catch {
        await ctx.reply(message);
      }
    } else {
      await ctx.reply(message);
    }
  } finally {
    topicCreations.delete(workspace.id);
  }
}

function topicLinkKeyboard(chatId: number, messageThreadId: number): InlineKeyboard {
  const internalId = String(chatId).replace(/^-100/, "");
  return new InlineKeyboard().url("Open topic", `https://t.me/c/${internalId}/${messageThreadId}`);
}
