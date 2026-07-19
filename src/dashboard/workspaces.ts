import { Api } from "grammy";
import { GroupMemberRole, GroupMemberStatus, type PrismaClient } from "@prisma/client";
import { prisma } from "../db/prisma";

const PERSONAL_TELEGRAM_ID = /^[1-9]\d{0,19}$/;
const WORKSPACE_ID = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
const MEMBERSHIP_CACHE_MS = 60_000;

export type DashboardWorkspace = {
  id: string;
  kind: "PERSONAL" | "GROUP";
  name: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  memberCount?: number;
};

export type DashboardWorkspaceScope = {
  principalTelegramId: string;
  ownerTelegramId: string;
  workspace: DashboardWorkspace;
};

export class DashboardGroupAccessError extends Error {
  constructor(message = "This group workspace could not be verified.") {
    super(message);
    this.name = "DashboardGroupAccessError";
  }
}

type MembershipVerifier = (botToken: string, chatId: string, telegramId: string) => Promise<GroupMemberRole>;
const membershipCache = new Map<string, { expiresAt: number; role: GroupMemberRole }>();
let cachedBotToken: string | undefined;
let cachedApi: Api | undefined;

function telegramApi(botToken: string): Api {
  if (!cachedApi || cachedBotToken !== botToken) {
    cachedBotToken = botToken;
    cachedApi = new Api(botToken);
  }
  return cachedApi;
}

export async function verifyTelegramGroupMembership(botToken: string, chatId: string, telegramId: string): Promise<GroupMemberRole> {
  const key = `${chatId}:${telegramId}`;
  const cached = membershipCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.role;

  let member;
  try {
    member = await telegramApi(botToken).getChatMember(chatId, Number(telegramId));
  } catch {
    throw new DashboardGroupAccessError("Telegram could not verify current group membership. A group admin may need to promote Threadwise first.");
  }
  const active = member.status === "creator"
    || member.status === "administrator"
    || member.status === "member"
    || (member.status === "restricted" && member.is_member === true);
  if (!active) throw new DashboardGroupAccessError("You are no longer a member of this Threadwise group workspace.");
  const role = member.status === "creator"
    ? GroupMemberRole.OWNER
    : member.status === "administrator"
      ? GroupMemberRole.ADMIN
      : GroupMemberRole.MEMBER;
  membershipCache.set(key, { expiresAt: Date.now() + MEMBERSHIP_CACHE_MS, role });
  return role;
}

export async function listDashboardWorkspaces(
  telegramId: string,
  database: PrismaClient = prisma
): Promise<DashboardWorkspace[]> {
  if (!PERSONAL_TELEGRAM_ID.test(telegramId)) throw new DashboardGroupAccessError();
  const [personal, memberships] = await Promise.all([
    database.user.findUnique({
      where: { telegramId },
      select: { firstName: true, username: true }
    }),
    database.groupMembership.findMany({
      where: { telegramId, status: GroupMemberStatus.ACTIVE, workspace: { isActive: true } },
      include: {
        workspace: {
          include: { _count: { select: { members: { where: { status: GroupMemberStatus.ACTIVE } } } } }
        }
      },
      orderBy: { lastSeenAt: "desc" }
    })
  ]);
  const workspaces: DashboardWorkspace[] = [];
  if (personal) {
    workspaces.push({
      id: "personal",
      kind: "PERSONAL",
      name: personal.firstName?.trim() || personal.username?.trim() || "Personal",
      role: "OWNER"
    });
  }
  for (const membership of memberships) {
    workspaces.push({
      id: membership.workspace.id,
      kind: "GROUP",
      name: membership.workspace.title,
      role: membership.role,
      memberCount: membership.workspace._count.members
    });
  }
  return workspaces;
}

export async function resolveDashboardWorkspace(
  principalTelegramId: string,
  requestedWorkspaceId: string | undefined,
  botToken: string | undefined,
  database: PrismaClient = prisma,
  verifyMembership: MembershipVerifier = verifyTelegramGroupMembership
): Promise<DashboardWorkspaceScope> {
  if (!PERSONAL_TELEGRAM_ID.test(principalTelegramId)) throw new DashboardGroupAccessError();
  if (!requestedWorkspaceId || requestedWorkspaceId === "personal") {
    return {
      principalTelegramId,
      ownerTelegramId: principalTelegramId,
      workspace: { id: "personal", kind: "PERSONAL", name: "Personal", role: "OWNER" }
    };
  }
  if (!WORKSPACE_ID.test(requestedWorkspaceId)) throw new DashboardGroupAccessError();

  const membership = await database.groupMembership.findFirst({
    where: {
      telegramId: principalTelegramId,
      status: GroupMemberStatus.ACTIVE,
      workspace: { id: requestedWorkspaceId, isActive: true }
    },
    include: {
      workspace: {
        include: {
          ownerUser: { select: { telegramId: true } },
          _count: { select: { members: { where: { status: GroupMemberStatus.ACTIVE } } } }
        }
      }
    }
  });
  if (!membership || !botToken) throw new DashboardGroupAccessError();

  const role = await verifyMembership(botToken, membership.workspace.telegramChatId, principalTelegramId);
  await database.groupMembership.update({
    where: { id: membership.id },
    data: { role, status: GroupMemberStatus.ACTIVE, lastSeenAt: new Date() }
  });
  return {
    principalTelegramId,
    ownerTelegramId: membership.workspace.ownerUser.telegramId,
    workspace: {
      id: membership.workspace.id,
      kind: "GROUP",
      name: membership.workspace.title,
      role,
      memberCount: membership.workspace._count.members
    }
  };
}

export function assertPersonalWorkspace(scope: DashboardWorkspaceScope): void {
  if (scope.workspace.kind === "GROUP") {
    throw new DashboardGroupAccessError("Personal integrations and account controls are not available in a shared group workspace.");
  }
}

export function assertWorkspaceManager(scope: DashboardWorkspaceScope): void {
  if (scope.workspace.kind === "GROUP" && scope.workspace.role === "MEMBER") {
    throw new DashboardGroupAccessError("Only a Telegram group admin can change shared workspace settings.");
  }
}
