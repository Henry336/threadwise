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

export async function refreshGroupMemberRole(ctx: Context): Promise<GroupMemberRole | undefined> {
  if (!isGroupChat(ctx) || !ctx.chat || !ctx.from) return undefined;
  const workspace = await prisma.groupWorkspace.findUnique({ where: { telegramChatId: String(ctx.chat.id) } });
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

export async function isGroupManager(ctx: Context): Promise<boolean> {
  if (!isGroupChat(ctx)) return true;
  try {
    const role = await refreshGroupMemberRole(ctx);
    return role === GroupMemberRole.OWNER || role === GroupMemberRole.ADMIN;
  } catch {
    return false;
  }
}

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

export async function updateGroupBotStatus(telegramChatId: string, status: string): Promise<void> {
  await prisma.groupWorkspace.updateMany({
    where: { telegramChatId },
    data: {
      botStatus: status,
      isActive: status !== "left" && status !== "kicked"
    }
  });
}
