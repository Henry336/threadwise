import type { Context } from "grammy";
import { replyHtml } from "../utils/html";
import { isGroupChat } from "./groupRouting";
import { formatStartText } from "./help";
import { privateMenuKeyboard, startMenuKeyboard } from "./keyboards";

export async function showMainMenu(ctx: Context, timezone = "Asia/Singapore"): Promise<void> {
  await replyHtml(ctx, formatStartText(timezone), {
    reply_markup: isGroupChat(ctx) ? startMenuKeyboard() : privateMenuKeyboard()
  });
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
