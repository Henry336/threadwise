/**
 * Tracks verified group workspaces (one per Telegram group) and their members and
 * roles. ensureUser in users.ts records access on every group message; src/bot
 * handlers use the role helpers for admin-only actions; src/bot/index.ts feeds in
 * Telegram member and bot status changes.
 */
import { GroupMemberRole, GroupMemberStatus } from "@prisma/client";
import type { Context } from "grammy";
import { prisma } from "../db/prisma";
import { isGroupChat } from "../bot/groupRouting";

export type GroupWorkspaceAccess = {
  id: string;
  telegramChatId: string;
  title: string;
  role: GroupMemberRole;
};

/**
 * Creates or refreshes the workspace for this group and marks the sender as an
 * active member, in one transaction. New members start as MEMBER; an existing
 * stored role is kept and only refreshed by the Telegram role lookups below.
 */
export async function recordGroupWorkspaceAccess(ctx: Context, ownerUserId: string): Promise<GroupWorkspaceAccess | undefined> {
  if (!isGroupChat(ctx) || !ctx.chat || !ctx.from) return undefined;

  const chat = ctx.chat;
  const from = ctx.from;
  const telegramChatId = String(chat.id);
  const title = ("title" in chat ? chat.title : undefined) ?? "Threadwise group";
  const username = "username" in chat ? chat.username : undefined;
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const workspace = await tx.groupWorkspace.upsert({
      where: { telegramChatId },
      update: {
        ownerUserId,
        title,
        username,
        isActive: true
      },
      create: {
        ownerUserId,
        telegramChatId,
        title,
        username
      }
    });

    const existing = await tx.groupMembership.findUnique({
      where: {
        workspaceId_telegramId: {
          workspaceId: workspace.id,
          telegramId: String(from.id)
        }
      },
      select: { role: true }
    });

    const membership = await tx.groupMembership.upsert({
      where: {
        workspaceId_telegramId: {
          workspaceId: workspace.id,
          telegramId: String(from.id)
        }
      },
      update: {
        username: from.username,
        firstName: from.first_name,
        lastName: from.last_name,
        status: GroupMemberStatus.ACTIVE,
        lastSeenAt: now
      },
      create: {
        workspaceId: workspace.id,
        telegramId: String(from.id),
        username: from.username,
        firstName: from.first_name,
        lastName: from.last_name,
        role: GroupMemberRole.MEMBER,
        status: GroupMemberStatus.ACTIVE,
        lastSeenAt: now
      }
    });

    return {
      id: workspace.id,
      telegramChatId,
      title,
      role: existing?.role ?? membership.role
    };
  });
}

/**
 * Returns the workspace for this group chat with the sender's role, or undefined
 * when the chat has no workspace or the sender is not an active member.
 */
export async function groupWorkspaceForContext(ctx: Context): Promise<GroupWorkspaceAccess | undefined> {
  if (!isGroupChat(ctx) || !ctx.chat || !ctx.from) return undefined;
  const workspace = await prisma.groupWorkspace.findUnique({
    where: { telegramChatId: String(ctx.chat.id) },
    include: {
      members: {
        where: { telegramId: String(ctx.from.id), status: GroupMemberStatus.ACTIVE },
        select: { role: true },
        take: 1
      }
    }
  });
  if (!workspace || !workspace.members[0]) return undefined;
  return {
    id: workspace.id,
    telegramChatId: workspace.telegramChatId,
    title: workspace.title,
    role: workspace.members[0].role
  };
}

/**
 * Asks Telegram for the sender's current group role and stores it. The upsert runs only when the
 * role or membership status actually changed (or the member is new), because buttons call this
 * on every press and an unchanged write records nothing. Recent activity (lastSeenAt) is kept
 * fresh by recordGroupWorkspaceAccess on each group message instead.
 */
export async function refreshGroupMemberRole(ctx: Context): Promise<GroupMemberRole | undefined> {
  if (!isGroupChat(ctx) || !ctx.chat || !ctx.from) return undefined;
  const workspace = await prisma.groupWorkspace.findUnique({
    where: { telegramChatId: String(ctx.chat.id) },
    include: { members: { where: { telegramId: String(ctx.from.id) }, select: { role: true, status: true }, take: 1 } },
  });
  if (!workspace) return undefined;

  const chatMember = await ctx.api.getChatMember(ctx.chat.id, ctx.from.id);
  const role = chatMember.status === "creator"
    ? GroupMemberRole.OWNER
    : chatMember.status === "administrator"
      ? GroupMemberRole.ADMIN
      : GroupMemberRole.MEMBER;
  const status = chatMember.status === "kicked"
    ? GroupMemberStatus.KICKED
    : chatMember.status === "left"
      ? GroupMemberStatus.LEFT
      : GroupMemberStatus.ACTIVE;

  const stored = workspace.members[0];
  if (stored?.role === role && stored.status === status) return role;
  await prisma.groupMembership.upsert({
    where: { workspaceId_telegramId: { workspaceId: workspace.id, telegramId: String(ctx.from.id) } },
    update: { role, status, lastSeenAt: new Date() },
    create: {
      workspaceId: workspace.id,
      telegramId: String(ctx.from.id),
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
      role,
      status
    }
  });
  return role;
}

/**
 * True when the sender is the group creator or an admin. Private chats count as
 * managers (the owner controls their own list). Any lookup error returns false,
 * so permission checks fail closed.
 */
export async function isGroupManager(ctx: Context): Promise<boolean> {
  if (!isGroupChat(ctx)) return true;
  try {
    const role = await refreshGroupMemberRole(ctx);
    return role === GroupMemberRole.OWNER || role === GroupMemberRole.ADMIN;
  } catch {
    return false;
  }
}

/**
 * Applies a Telegram chat_member update (join, leave, kick, promotion) to the
 * stored membership. Ignored for groups without a workspace.
 */
export async function updateGroupMemberFromTelegram(
  telegramChatId: string,
  member: { id: number; username?: string; first_name: string; last_name?: string },
  telegramStatus: string
): Promise<void> {
  const workspace = await prisma.groupWorkspace.findUnique({ where: { telegramChatId } });
  if (!workspace) return;
  const role = telegramStatus === "creator"
    ? GroupMemberRole.OWNER
    : telegramStatus === "administrator"
      ? GroupMemberRole.ADMIN
      : GroupMemberRole.MEMBER;
  const status = telegramStatus === "kicked"
    ? GroupMemberStatus.KICKED
    : telegramStatus === "left"
      ? GroupMemberStatus.LEFT
      : GroupMemberStatus.ACTIVE;
  await prisma.groupMembership.upsert({
    where: { workspaceId_telegramId: { workspaceId: workspace.id, telegramId: String(member.id) } },
    update: {
      username: member.username,
      firstName: member.first_name,
      lastName: member.last_name,
      role,
      status,
      lastSeenAt: new Date()
    },
    create: {
      workspaceId: workspace.id,
      telegramId: String(member.id),
      username: member.username,
      firstName: member.first_name,
      lastName: member.last_name,
      role,
      status
    }
  });
}

/**
 * Records the bot's own status in a group. The workspace is marked inactive
 * when the bot has left or been removed.
 */
export async function updateGroupBotStatus(telegramChatId: string, status: string): Promise<void> {
  await prisma.groupWorkspace.updateMany({
    where: { telegramChatId },
    data: {
      botStatus: status,
      isActive: status !== "left" && status !== "kicked"
    }
  });
}
