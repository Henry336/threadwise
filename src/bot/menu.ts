import type { Context } from "grammy";
import { replyHtml } from "../utils/html";
import { isGroupChat } from "./groupRouting";
import { formatGroupMainMenuText, formatMainMenuText } from "./help";
import { dashboardLinkKeyboard, groupDashboardLinkKeyboard, groupStartMenuKeyboard, privateMenuKeyboard, startMenuKeyboard } from "./keyboards";
import { rememberNewControlCard } from "./controlCards";
import { DASHBOARD_URL } from "./links";
import { cancelTransientInteractions } from "./interactions";
import { groupWorkspaceForContext, recordGroupWorkspaceAccess } from "../services/groupWorkspaces";

export async function showMainMenu(
  ctx: Context,
  timezone = "Asia/Singapore",
  userId?: string,
  actorTelegramId?: string | number
): Promise<void> {
  if (userId && actorTelegramId !== undefined) {
    await cancelTransientInteractions(userId, actorTelegramId);
  }
  const group = isGroupChat(ctx);
  const workspace = group
    ? (userId ? await recordGroupWorkspaceAccess(ctx, userId) : await groupWorkspaceForContext(ctx))
    : undefined;
  const message = await replyHtml(ctx, group
    ? formatGroupMainMenuText(workspace?.title ?? "Shared workspace", timezone)
    : formatMainMenuText(timezone), {
    reply_markup: group ? groupStartMenuKeyboard(workspace?.id) : startMenuKeyboard()
  });
  if (!group) await rememberNewControlCard(ctx, message);
}

export async function showDashboardLink(ctx: Context): Promise<void> {
  if (isGroupChat(ctx)) {
    const workspace = await groupWorkspaceForContext(ctx);
    if (!workspace) {
      await ctx.reply("I couldn't prepare this group's dashboard just now. Try /dashboard again.");
      return;
    }
    let verificationCopy = "Telegram will verify that each visitor is still a member of this group.";
    try {
      const botMember = await ctx.api.getChatMember(ctx.chat!.id, ctx.me.id);
      if (botMember.status !== "administrator" && botMember.status !== "creator") {
        verificationCopy = "For safe live membership checks, make Threadwise a group admin before opening this dashboard. The bot can still work in chat without admin access.";
      }
    } catch {
      verificationCopy = "Threadwise could not confirm its group role. A group admin may need to promote the bot before dashboard access can be verified.";
    }
    await replyHtml(ctx, [
      `<b>🌐 ${workspace.title} dashboard</b>`,
      "A separate shared workspace for this group's tasks, notes, ideas, images, and expenses.",
      verificationCopy,
      "Personal workspaces and personal integrations stay separate."
    ].join("\n"), { reply_markup: groupDashboardLinkKeyboard(workspace.id) });
    return;
  }
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
