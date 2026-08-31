import type { CommunityGroup } from "@prisma/client";
import { Bot, type Context } from "grammy";
import type { BeaconConfig } from "../config/env";
import { logger } from "../logger";
import {
  activeCommunityConversation,
  claimCommunityUpdate,
  communityAccess,
  communityGroupById,
  communityGroupForChat,
  ensureConfiguredCommunityGroups,
  hasPermanentCommunityBan,
  isTrustedCommunityMember,
  recordCommunityAudit,
  selectCommunityControlGroup,
  suspendCommunityModerator,
  updateCommunityGroupTitle,
  upsertCommunityMember,
  type CommunityAccess,
} from "./store";
import { isBeaconInvocation } from "./policy";
import { displayModerator, escapeHtml } from "./ui";

const OWNER_ONLY = "Only Beacon's owner can do that.";
const REPORT_PATTERN = /^(?:\/report(?:@\w+)?|report(?:\s+this)?|ဒီစာကို\s*တိုင်ကြားမယ်|တိုင်ကြားမယ်)(?:\s+(.+))?$/iu;
const SETTINGS_PATTERN = /^(?:\/beacon(?:@\w+)?|beacon\s+(?:settings|menu)|moderation\s+settings)$/iu;
const ADD_MODERATOR_PATTERN = /^(?:add|make)\s+(?:this\s+user\s+)?(?:a\s+)?moderator$/iu;
const RULES_PATTERN = /^(?:\/rules(?:@\w+)?|rules|စည်းမျဉ်း(?:များ)?)$/iu;
const PURGE_PATTERN = /^(?:\/purge(?:@\w+)?|purge(?:\s+(?:this\s+)?topic)?)$/iu;

type CommunityConversation = NonNullable<Awaited<ReturnType<typeof activeCommunityConversation>>>;

export type BeaconRegistrationHandlers = {
  showPrivateHome: (ctx: Context, group: CommunityGroup, access: CommunityAccess) => Promise<void>;
  showPrivateEntry: (ctx: Context, config: BeaconConfig) => Promise<void>;
  configuredGroup: (ctx: Context) => Promise<CommunityGroup | null>;
  accessFor: (ctx: Context, group: CommunityGroup, config: BeaconConfig) => Promise<CommunityAccess>;
  showMemberHelp: (ctx: Context, group: CommunityGroup) => Promise<void>;
  showGroupHome: (ctx: Context, group: CommunityGroup, access: CommunityAccess) => Promise<void>;
  showRules: (ctx: Context, group: CommunityGroup) => Promise<void>;
  handleMemberReport: (ctx: Context, group: CommunityGroup, config: BeaconConfig, reason?: string) => Promise<void>;
  beginTopicPurge: (ctx: Context, group: CommunityGroup, config: BeaconConfig) => Promise<void>;
  handleCallback: (ctx: Context, config: BeaconConfig) => Promise<void>;
  answerCallback: (ctx: Context, text?: string, showAlert?: boolean) => Promise<void>;
  handlePrivateMessage: (ctx: Context, config: BeaconConfig) => Promise<void>;
  handleServiceMessage: (ctx: Context, group: CommunityGroup, config: BeaconConfig) => Promise<void>;
  enforceStructuralSafety: (ctx: Context, group: CommunityGroup, config: BeaconConfig, text: string) => Promise<boolean>;
  handleConversationMessage: (ctx: Context, group: CommunityGroup, conversation: CommunityConversation, access: CommunityAccess, config: BeaconConfig) => Promise<boolean>;
  handleNaturalPolicyCommand: (ctx: Context, group: CommunityGroup, access: CommunityAccess, config: BeaconConfig) => Promise<boolean>;
  beginModeratorTarget: (ctx: Context, group: CommunityGroup, config: BeaconConfig, user?: { id: number; username?: string; first_name: string; last_name?: string }, conversationId?: string) => Promise<void>;
  enforceConfiguredPolicy: (ctx: Context, group: CommunityGroup, config: BeaconConfig, text: string) => Promise<void>;
  notifyOwner: (bot: Pick<Bot, "api">, config: BeaconConfig, group: CommunityGroup, auditId: string, text: string) => Promise<void>;
  memberName: (user: { first_name: string; last_name?: string; username?: string }) => string;
};

/** Registers Telegram transport events while domain decisions remain in the injected handlers. */
export async function createRegisteredBeaconBot(
  token: string,
  config: BeaconConfig,
  handlers: BeaconRegistrationHandlers,
): Promise<Bot> {
  const bot = new Bot(token);
  await ensureConfiguredCommunityGroups(config);

  bot.use(async (ctx, next) => {
    if (!(await claimCommunityUpdate(ctx.update.update_id))) return;
    await next();
  });

  bot.command("start", async (ctx) => {
    const actorId = String(ctx.from?.id ?? "");
    const requestedGroupId = typeof ctx.match === "string" && ctx.match.startsWith("manage_")
      ? ctx.match.slice("manage_".length)
      : undefined;
    if (requestedGroupId) {
      const group = await communityGroupById(requestedGroupId);
      if (group?.enabled) {
        const access = await communityAccess(group.id, actorId, config.ownerTelegramId);
        if (access.owner || access.moderator) {
          await selectCommunityControlGroup(actorId, group.id);
          await handlers.showPrivateHome(ctx, group, access);
          return;
        }
      }
    }
    await handlers.showPrivateEntry(ctx, config);
  });

  bot.command("beacon", async (ctx) => {
    if (ctx.chat.type === "private") {
      await handlers.showPrivateEntry(ctx, config);
      return;
    }
    const group = await handlers.configuredGroup(ctx);
    if (!group) return;
    const access = await handlers.accessFor(ctx, group, config);
    if (!access.owner && !access.moderator) {
      await handlers.showMemberHelp(ctx, group);
      return;
    }
    await handlers.showGroupHome(ctx, group, access);
  });

  bot.command("rules", async (ctx) => {
    const group = await handlers.configuredGroup(ctx);
    if (group) await handlers.showRules(ctx, group);
  });

  bot.command("report", async (ctx) => {
    const group = await handlers.configuredGroup(ctx);
    if (group) await handlers.handleMemberReport(ctx, group, config);
  });

  bot.command("purge", async (ctx) => {
    const group = await handlers.configuredGroup(ctx);
    if (group) await handlers.beginTopicPurge(ctx, group, config);
  });

  bot.callbackQuery(/^bc:/, async (ctx) => {
    try {
      await handlers.handleCallback(ctx, config);
    } catch (error) {
      logger.error("Beacon callback failed.", { error: String(error), data: ctx.callbackQuery.data });
      await handlers.answerCallback(ctx, "That action could not be completed. Please reopen Beacon and try again.", true);
    }
  });

  bot.on("chat_member", async (ctx) => {
    const group = await communityGroupForChat(String(ctx.chat.id));
    if (!group) return;
    const member = ctx.chatMember.new_chat_member;
    const active = !["left", "kicked"].includes(member.status);
    await upsertCommunityMember({
      groupId: group.id,
      telegramId: String(member.user.id),
      username: member.user.username,
      displayName: handlers.memberName(member.user),
      joined: active,
      active,
    });
    if (active && await hasPermanentCommunityBan(group.id, String(member.user.id))) {
      await ctx.api.banChatMember(Number(group.telegramChatId), member.user.id).catch((error) =>
        logger.warn("Beacon could not restore a permanent ban.", {
          groupId: group.id,
          telegramId: String(member.user.id),
          error: String(error),
        })
      );
      return;
    }
    if (!active) {
      const suspended = await suspendCommunityModerator(group.id, String(member.user.id));
      if (suspended) {
        const audit = await recordCommunityAudit({
          groupId: group.id,
          actorTelegramId: "SYSTEM",
          action: "MODERATOR_AUTO_SUSPENDED",
          targetTelegramId: suspended.telegramId,
          details: { reason: "left_group" },
        });
        await handlers.notifyOwner(bot, config, group, audit.id, [
          "<b>Moderator suspended</b>",
          `${escapeHtml(displayModerator(suspended))} left the group. Beacon permissions were suspended automatically.`,
        ].join("\n"));
      }
    }
  });

  bot.on("my_chat_member", async (ctx) => {
    const group = await communityGroupForChat(String(ctx.chat.id));
    if (group) await updateCommunityGroupTitle(group.id, ctx.chat.title);
  });

  bot.on("message", async (ctx) => {
    if (ctx.chat.type === "private") {
      await handlers.handlePrivateMessage(ctx, config);
      return;
    }
    const group = await handlers.configuredGroup(ctx);
    if (!group) return;
    await updateCommunityGroupTitle(group.id, "title" in ctx.chat ? ctx.chat.title : undefined);

    if (
      ctx.message.new_chat_members?.length
      || ctx.message.left_chat_member
      || ctx.message.forum_topic_created
      || ctx.message.forum_topic_edited
    ) {
      await handlers.handleServiceMessage(ctx, group, config);
      return;
    }

    const senderId = String(ctx.from?.id ?? "");
    if (!senderId) return;
    await upsertCommunityMember({
      groupId: group.id,
      telegramId: senderId,
      username: ctx.from?.username,
      displayName: ctx.from ? handlers.memberName(ctx.from) : undefined,
    });

    const text = ctx.message.text?.trim();
    if (!text) {
      await handlers.enforceStructuralSafety(ctx, group, config, "");
      return;
    }

    const reportMatch = text.match(REPORT_PATTERN);
    if (reportMatch) {
      await handlers.handleMemberReport(ctx, group, config, reportMatch[1]);
      return;
    }

    const access = await handlers.accessFor(ctx, group, config);
    const conversation = await activeCommunityConversation(group.id, senderId);
    if (conversation && await handlers.handleConversationMessage(ctx, group, conversation, access, config)) return;

    if (SETTINGS_PATTERN.test(text)) {
      if (!access.owner && !access.moderator) await handlers.showMemberHelp(ctx, group);
      else await handlers.showGroupHome(ctx, group, access);
      return;
    }
    if (isBeaconInvocation(text)) {
      if (access.owner || access.moderator) await handlers.showGroupHome(ctx, group, access);
      else await handlers.showMemberHelp(ctx, group);
      return;
    }
    if (RULES_PATTERN.test(text)) {
      await handlers.showRules(ctx, group);
      return;
    }
    if (PURGE_PATTERN.test(text)) {
      await handlers.beginTopicPurge(ctx, group, config);
      return;
    }
    if (ADD_MODERATOR_PATTERN.test(text) && ctx.message.reply_to_message) {
      if (!access.owner) {
        await ctx.reply(OWNER_ONLY);
        return;
      }
      await handlers.beginModeratorTarget(ctx, group, config, ctx.message.reply_to_message.from);
      return;
    }
    if (await handlers.handleNaturalPolicyCommand(ctx, group, access, config)) return;

    if (access.owner || access.moderator || await isTrustedCommunityMember(group.id, senderId)) return;
    if (await handlers.enforceStructuralSafety(ctx, group, config, text)) return;
    await handlers.enforceConfiguredPolicy(ctx, group, config, text);
  });

  bot.catch((error) => {
    logger.error("Beacon update failed.", {
      error: String(error.error),
      updateId: error.ctx.update.update_id,
    });
  });

  return bot;
}
