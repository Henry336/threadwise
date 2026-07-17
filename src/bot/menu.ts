import type { Context } from "grammy";
import { replyHtml } from "../utils/html";
import { isGroupChat } from "./groupRouting";
import { formatMainMenuText } from "./help";
import { dashboardLinkKeyboard, privateMenuKeyboard, startMenuKeyboard } from "./keyboards";
import { rememberNewControlCard } from "./controlCards";
import { DASHBOARD_URL } from "./links";
import { cancelTransientInteractions } from "./interactions";

export async function showMainMenu(
  ctx: Context,
  timezone = "Asia/Singapore",
  userId?: string,
  actorTelegramId?: string | number
): Promise<void> {
  if (userId && actorTelegramId !== undefined) {
    await cancelTransientInteractions(userId, actorTelegramId);
  }
  const message = await replyHtml(ctx, formatMainMenuText(timezone), {
    reply_markup: startMenuKeyboard()
  });
  if (!isGroupChat(ctx)) await rememberNewControlCard(ctx, message);
}

export async function showDashboardLink(ctx: Context): Promise<void> {
  await replyHtml(ctx, [
    "<b>🌐 Your Threadwise dashboard</b>",
    "See and manage your tasks, notes, ideas, images, and expenses in one live workspace.",
    "Sign in securely with the same Telegram account you use here.",
    "",
    DASHBOARD_URL
  ].join("\n"), { reply_markup: dashboardLinkKeyboard() });
}

export async function hidePrivateMenu(ctx: Context): Promise<void> {
  if (isGroupChat(ctx)) {
    await ctx.reply("In groups, Threadwise buttons stay attached to my messages instead of sitting beneath everyone’s reply box.");
    return;
  }
  await ctx.reply("Menu tucked away. Type /menu whenever you want it back.", {
    reply_markup: { remove_keyboard: true }
  });
}
