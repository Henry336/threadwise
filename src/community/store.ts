import {
  CommunityEnvironment,
  CommunityModerationActionType,
  CommunityModeratorStatus,
  CommunityOffenceSeverity,
  CommunityOffenceStatus,
  CommunityReportStatus,
  CommunityTriggerMatchType,
  Prisma,
  type CommunityGroup,
  type CommunityModerator
} from "@prisma/client";
import type { BeaconConfig } from "../config/env";
import { prisma } from "../db/prisma";
import { inferTriggerMatchType, normalizedCategoryName, normalizeCommunityText } from "./policy";

const CONVERSATION_TTL_MS = 15 * 60_000;
const EVIDENCE_TTL_MS = 30 * 24 * 60 * 60_000;

const DEFAULT_TRIGGER_GROUPS = [
  { name: "Watchlist", description: "Log and review uncertain matches.", action: CommunityModerationActionType.REVIEW, deleteMessage: false, severity: CommunityOffenceSeverity.MINOR },
  { name: "Mild disruption", description: "Remove low-severity disruption and warn the sender.", action: CommunityModerationActionType.WARN, deleteMessage: true, severity: CommunityOffenceSeverity.MODERATE },
  { name: "Repeated promotion", description: "Remove repeated advertising and warn the sender.", action: CommunityModerationActionType.WARN, deleteMessage: true, severity: CommunityOffenceSeverity.MODERATE },
  { name: "Harassment", description: "Remove harassment and temporarily mute the sender.", action: CommunityModerationActionType.MUTE, deleteMessage: true, muteDurationMinutes: 1_440, severity: CommunityOffenceSeverity.SERIOUS },
  { name: "Known scams", description: "High-confidence scam domains or exact repeated templates. Starts in review mode until explicitly promoted.", action: CommunityModerationActionType.REVIEW, deleteMessage: false, severity: CommunityOffenceSeverity.CRITICAL }
] as const;

const DEFAULT_SEVERITY_POINTS: Record<CommunityOffenceSeverity, number> = {
  MINOR: 1,
  MODERATE: 2,
  SERIOUS: 3,
  CRITICAL: 5
};

export type ModeratorPermissionsInput = {
  canWarnDelete: boolean;
  canMute: boolean;
  canBan: boolean;
  canEditRules: boolean;
  canAddTriggers: boolean;
  canRemoveTriggers: boolean;
  canChangeTriggerSeverity: boolean;
  canManageTriggerGroups: boolean;
  canChangeAutomaticActions: boolean;
  canManageTrustedMembers: boolean;
  canLockdown: boolean;
};

export type ModeratorIdentityInput = {
  telegramId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
};

export type CommunityAccess = {
  owner: boolean;
  moderator?: CommunityModerator;
  canWarn: boolean;
  canDelete: boolean;
  canMute: boolean;
  canBan: boolean;
  canEditRules: boolean;
  canAddTriggers: boolean;
  canRemoveTriggers: boolean;
  canChangeTriggerSeverity: boolean;
  canManageTriggerGroups: boolean;
  canChangeAutomaticActions: boolean;
  canManageTrustedMembers: boolean;
  canLockdown: boolean;
};

export async function ensureConfiguredCommunityGroups(config: BeaconConfig): Promise<CommunityGroup[]> {
  const bindings = [
    config.testChatId ? { chatId: config.testChatId, environment: CommunityEnvironment.TEST, title: "Beacon testing group" } : undefined,
    config.productionChatId ? { chatId: config.productionChatId, environment: CommunityEnvironment.PRODUCTION, title: "Scholarship community" } : undefined
  ].filter((binding): binding is NonNullable<typeof binding> => Boolean(binding));

  const configuredChatIds = bindings.map((binding) => binding.chatId);
  if (configuredChatIds.length > 0) {
    await prisma.communityGroup.updateMany({
      where: { telegramChatId: { notIn: configuredChatIds } },
      data: { enabled: false }
    });
  } else {
    await prisma.communityGroup.updateMany({ data: { enabled: false } });
  }

  const groups: CommunityGroup[] = [];
  for (const binding of bindings) {
    const group = await prisma.communityGroup.upsert({
      where: { telegramChatId: binding.chatId },
      create: {
        telegramChatId: binding.chatId,
        title: binding.title,
        environment: binding.environment,
        ownerTelegramId: config.ownerTelegramId,
        moderatorReviewChatId: config.moderatorChatId,
        observeMode: true
      },
      update: {
        environment: binding.environment,
        ownerTelegramId: config.ownerTelegramId,
        moderatorReviewChatId: config.moderatorChatId ?? null,
        enabled: true
      }
    });
    await ensureDefaultTriggerGroups(group.id);
    await ensureDefaultSeverityRules(group.id);
    groups.push(group);
  }
  return groups;
}

async function ensureDefaultTriggerGroups(groupId: string): Promise<void> {
  for (const category of DEFAULT_TRIGGER_GROUPS) {
    await prisma.communityTriggerGroup.upsert({
      where: { groupId_normalizedName: { groupId, normalizedName: normalizedCategoryName(category.name) } },
      create: {
        groupId,
        name: category.name,
        normalizedName: normalizedCategoryName(category.name),
        description: category.description,
        action: category.action,
        deleteMessage: category.deleteMessage,
        severity: category.severity,
        muteDurationMinutes: "muteDurationMinutes" in category ? category.muteDurationMinutes : null
      },
      update: {}
    });
  }
}

async function ensureDefaultSeverityRules(groupId: string): Promise<void> {
  for (const severity of Object.values(CommunityOffenceSeverity)) {
    await prisma.communitySeverityRule.upsert({
      where: { groupId_severity: { groupId, severity } },
      create: { groupId, severity, points: DEFAULT_SEVERITY_POINTS[severity] },
      update: {}
    });
  }
}

export async function communityGroupForChat(chatId: string): Promise<CommunityGroup | null> {
  return prisma.communityGroup.findFirst({ where: { telegramChatId: chatId, enabled: true } });
}

export async function communityGroupById(groupId: string): Promise<CommunityGroup | null> {
  return prisma.communityGroup.findUnique({ where: { id: groupId } });
}

export async function updateCommunityGroupTitle(groupId: string, title?: string): Promise<void> {
  if (!title) return;
  await prisma.communityGroup.update({ where: { id: groupId }, data: { title } });
}

export async function listManageableCommunityGroups(telegramId: string, ownerTelegramId: string): Promise<CommunityGroup[]> {
  return prisma.communityGroup.findMany({
    where: telegramId === ownerTelegramId
      ? { enabled: true }
      : {
          enabled: true,
          moderators: { some: { telegramId, status: CommunityModeratorStatus.ACTIVE } }
        },
    orderBy: [{ environment: "asc" }, { title: "asc" }, { createdAt: "asc" }]
  });
}

export async function communityControlSession(actorTelegramId: string) {
  return prisma.communityControlSession.findUnique({
    where: { actorTelegramId },
    include: { selectedGroup: true }
  });
}

export async function selectCommunityControlGroup(actorTelegramId: string, selectedGroupId: string): Promise<void> {
  await prisma.communityControlSession.upsert({
    where: { actorTelegramId },
    create: { actorTelegramId, selectedGroupId },
    update: {
      selectedGroupId,
      triggerSearchQuery: null,
      triggerActionFilter: null,
      triggerGroupFilterId: null,
      triggerPage: 0
    }
  });
}

export async function updateCommunityControlTriggerFilters(input: {
  actorTelegramId: string;
  searchQuery?: string | null;
  action?: CommunityModerationActionType | null;
  triggerGroupId?: string | null;
  page?: number;
}): Promise<void> {
  await prisma.communityControlSession.update({
    where: { actorTelegramId: input.actorTelegramId },
    data: {
      triggerSearchQuery: input.searchQuery === undefined ? undefined : input.searchQuery?.trim() || null,
      triggerActionFilter: input.action === undefined ? undefined : input.action,
      triggerGroupFilterId: input.triggerGroupId === undefined ? undefined : input.triggerGroupId,
      triggerPage: input.page === undefined ? undefined : Math.max(0, input.page)
    }
  });
}

export async function claimCommunityUpdate(updateId: number): Promise<boolean> {
  try {
    await prisma.communityProcessedUpdate.create({ data: { updateId } });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
    throw error;
  }
}

export async function communityAccess(groupId: string, telegramId: string, ownerTelegramId: string): Promise<CommunityAccess> {
  if (telegramId === ownerTelegramId) {
    return {
      owner: true,
      canWarn: true,
      canDelete: true,
      canMute: true,
      canBan: true,
      canEditRules: true,
      canAddTriggers: true,
      canRemoveTriggers: true,
      canChangeTriggerSeverity: true,
      canManageTriggerGroups: true,
      canChangeAutomaticActions: true,
      canManageTrustedMembers: true,
      canLockdown: true
    };
  }
  const moderator = await prisma.communityModerator.findUnique({ where: { groupId_telegramId: { groupId, telegramId } } });
  const active = moderator?.status === CommunityModeratorStatus.ACTIVE;
  return {
    owner: false,
    moderator: active ? moderator : undefined,
    canWarn: Boolean(active && moderator?.canWarn),
    canDelete: Boolean(active && moderator?.canDelete),
    canMute: Boolean(active && moderator?.canMute),
    canBan: Boolean(active && moderator?.canBan),
    canEditRules: Boolean(active && moderator?.canEditRules),
    canAddTriggers: Boolean(active && moderator?.canAddTriggers),
    canRemoveTriggers: false,
    canChangeTriggerSeverity: false,
    canManageTriggerGroups: false,
    canChangeAutomaticActions: false,
    canManageTrustedMembers: Boolean(active && moderator?.canManageTrustedMembers),
    canLockdown: Boolean(active && moderator?.canLockdown)
  };
}

export async function listCommunityModerators(groupId: string): Promise<CommunityModerator[]> {
  return prisma.communityModerator.findMany({
    where: { groupId, status: { not: CommunityModeratorStatus.REMOVED } },
    orderBy: [{ status: "asc" }, { firstName: "asc" }, { createdAt: "asc" }]
  });
}

export async function communityModeratorById(groupId: string, moderatorId: string): Promise<CommunityModerator | null> {
  return prisma.communityModerator.findFirst({ where: { id: moderatorId, groupId } });
}

export async function saveCommunityModerator(input: {
  groupId: string;
  identity: ModeratorIdentityInput;
  permissions: ModeratorPermissionsInput;
  actorTelegramId: string;
}): Promise<{ before: CommunityModerator | null; after: CommunityModerator }> {
  const before = await prisma.communityModerator.findUnique({
    where: { groupId_telegramId: { groupId: input.groupId, telegramId: input.identity.telegramId } }
  });
  const data = {
    username: input.identity.username,
    firstName: input.identity.firstName,
    lastName: input.identity.lastName,
    status: CommunityModeratorStatus.ACTIVE,
    canWarn: input.permissions.canWarnDelete,
    canDelete: input.permissions.canWarnDelete,
    canMute: input.permissions.canMute,
    canBan: input.permissions.canBan,
    canEditRules: input.permissions.canEditRules,
    canAddTriggers: input.permissions.canAddTriggers,
    canRemoveTriggers: input.permissions.canRemoveTriggers,
    canChangeTriggerSeverity: input.permissions.canChangeTriggerSeverity,
    canManageTriggerGroups: input.permissions.canManageTriggerGroups,
    canChangeAutomaticActions: input.permissions.canChangeAutomaticActions,
    canManageTrustedMembers: input.permissions.canManageTrustedMembers,
    canLockdown: input.permissions.canLockdown,
    addedByTelegramId: input.actorTelegramId,
    suspendedAt: null,
    removedAt: null
  };
  const after = await prisma.communityModerator.upsert({
    where: { groupId_telegramId: { groupId: input.groupId, telegramId: input.identity.telegramId } },
    create: { groupId: input.groupId, telegramId: input.identity.telegramId, ...data },
    update: data
  });
  return { before, after };
}

export async function removeCommunityModerator(groupId: string, moderatorId: string): Promise<CommunityModerator | null> {
  const existing = await communityModeratorById(groupId, moderatorId);
  if (!existing) return null;
  return prisma.communityModerator.update({
    where: { id: moderatorId },
    data: { status: CommunityModeratorStatus.REMOVED, removedAt: new Date() }
  });
}

export async function suspendCommunityModerator(groupId: string, telegramId: string): Promise<CommunityModerator | null> {
  const existing = await prisma.communityModerator.findUnique({ where: { groupId_telegramId: { groupId, telegramId } } });
  if (!existing || existing.status !== CommunityModeratorStatus.ACTIVE) return null;
  return prisma.communityModerator.update({
    where: { id: existing.id },
    data: { status: CommunityModeratorStatus.SUSPENDED, suspendedAt: new Date() }
  });
}

export async function startCommunityConversation(input: {
  groupId: string;
  actorTelegramId: string;
  kind: string;
  step: string;
  data?: Record<string, unknown>;
  messageId?: number;
  ttlMs?: number;
}): Promise<void> {
  const expiresAt = new Date(Date.now() + (input.ttlMs ?? CONVERSATION_TTL_MS));
  await prisma.communityConversation.upsert({
    where: { groupId_actorTelegramId: { groupId: input.groupId, actorTelegramId: input.actorTelegramId } },
    create: {
      groupId: input.groupId,
      actorTelegramId: input.actorTelegramId,
      kind: input.kind,
      step: input.step,
      data: (input.data ?? {}) as Prisma.InputJsonValue,
      messageId: input.messageId,
      expiresAt
    },
    update: {
      kind: input.kind,
      step: input.step,
      data: (input.data ?? {}) as Prisma.InputJsonValue,
      messageId: input.messageId,
      expiresAt
    }
  });
}

export async function activeCommunityConversation(groupId: string, actorTelegramId: string) {
  return prisma.communityConversation.findFirst({
    where: { groupId, actorTelegramId, expiresAt: { gt: new Date() } }
  });
}

export async function updateCommunityConversation(id: string, step: string, data: Record<string, unknown>): Promise<void> {
  await prisma.communityConversation.update({
    where: { id },
    data: { step, data: data as Prisma.InputJsonValue, expiresAt: new Date(Date.now() + CONVERSATION_TTL_MS) }
  });
}

export async function clearCommunityConversation(groupId: string, actorTelegramId: string): Promise<void> {
  await prisma.communityConversation.deleteMany({ where: { groupId, actorTelegramId } });
}

export async function listTriggerGroups(groupId: string) {
  return prisma.communityTriggerGroup.findMany({
    where: { groupId },
    include: { triggers: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "asc" }
  });
}

export async function createCommunityTriggerGroup(input: {
  groupId: string;
  name: string;
  description?: string;
}) {
  const name = input.name.trim();
  const description = input.description?.trim();
  const normalizedName = normalizedCategoryName(name);
  if (name.length < 2 || name.length > 40 || !normalizedName || (description?.length ?? 0) > 200) {
    throw new Error("INVALID_TRIGGER_GROUP");
  }
  return prisma.communityTriggerGroup.create({
    data: {
      groupId: input.groupId,
      name,
      normalizedName,
      description: description || null,
      action: CommunityModerationActionType.REVIEW,
      deleteMessage: false
    }
  });
}

export async function renameCommunityTriggerGroup(input: {
  groupId: string;
  triggerGroupId: string;
  name: string;
}) {
  const name = input.name.trim();
  const normalizedName = normalizedCategoryName(name);
  if (name.length < 2 || name.length > 40 || !normalizedName) throw new Error("INVALID_TRIGGER_GROUP");
  return prisma.communityTriggerGroup.updateMany({
    where: { id: input.triggerGroupId, groupId: input.groupId },
    data: { name, normalizedName }
  });
}

export async function deleteEmptyCommunityTriggerGroup(groupId: string, triggerGroupId: string): Promise<"DELETED" | "NOT_EMPTY" | "NOT_FOUND"> {
  const category = await prisma.communityTriggerGroup.findFirst({
    where: { id: triggerGroupId, groupId },
    include: { _count: { select: { triggers: true } } }
  });
  if (!category) return "NOT_FOUND";
  if (category._count.triggers > 0) return "NOT_EMPTY";
  await prisma.communityTriggerGroup.delete({ where: { id: category.id } });
  return "DELETED";
}

export async function triggerGroupById(groupId: string, id: string) {
  return prisma.communityTriggerGroup.findFirst({
    where: { id, groupId },
    include: { triggers: { orderBy: { createdAt: "asc" } } }
  });
}

export async function triggerGroupByName(groupId: string, name: string) {
  return prisma.communityTriggerGroup.findUnique({
    where: { groupId_normalizedName: { groupId, normalizedName: normalizedCategoryName(name) } }
  });
}

export async function addCommunityTrigger(input: {
  groupId: string;
  triggerGroupId: string;
  pattern: string;
  actorTelegramId: string;
  pendingApproval?: boolean;
}) {
  const category = await prisma.communityTriggerGroup.findFirst({ where: { id: input.triggerGroupId, groupId: input.groupId } });
  if (!category) throw new Error("TRIGGER_GROUP_NOT_FOUND");
  const normalizedPattern = normalizeCommunityText(input.pattern).replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
  if (!normalizedPattern || normalizedPattern.length > 300) throw new Error("INVALID_TRIGGER");
  if (input.pendingApproval) {
    return prisma.communityTrigger.create({
      data: {
        groupId: input.groupId,
        triggerGroupId: input.triggerGroupId,
        pattern: input.pattern.trim(),
        normalizedPattern,
        matchType: inferTriggerMatchType(input.pattern) as CommunityTriggerMatchType,
        createdByTelegramId: input.actorTelegramId,
        pendingApproval: true
      }
    });
  }
  return prisma.communityTrigger.upsert({
    where: { groupId_normalizedPattern: { groupId: input.groupId, normalizedPattern } },
    create: {
      groupId: input.groupId,
      triggerGroupId: input.triggerGroupId,
      pattern: input.pattern.trim(),
      normalizedPattern,
      matchType: inferTriggerMatchType(input.pattern) as CommunityTriggerMatchType,
      createdByTelegramId: input.actorTelegramId,
      pendingApproval: input.pendingApproval ?? false,
      approvedByTelegramId: input.pendingApproval ? null : input.actorTelegramId,
      approvedAt: input.pendingApproval ? null : new Date()
    },
    update: {
      triggerGroupId: input.triggerGroupId,
      pattern: input.pattern.trim(),
      pendingApproval: input.pendingApproval ?? false,
      approvedByTelegramId: input.pendingApproval ? null : input.actorTelegramId,
      approvedAt: input.pendingApproval ? null : new Date()
    }
  });
}

export async function communityTriggerById(groupId: string, id: string) {
  return prisma.communityTrigger.findFirst({ where: { id, groupId }, include: { triggerGroup: true } });
}

export async function communityTriggerByGlobalId(id: string) {
  return prisma.communityTrigger.findUnique({ where: { id }, include: { triggerGroup: true, group: true } });
}

export async function approveCommunityTrigger(id: string, actorTelegramId: string) {
  return prisma.communityTrigger.update({
    where: { id },
    data: { pendingApproval: false, approvedByTelegramId: actorTelegramId, approvedAt: new Date() },
    include: { triggerGroup: true, group: true }
  });
}

export async function reviewCommunityTriggerGroup(groupId: string) {
  return prisma.communityTriggerGroup.findUnique({
    where: { groupId_normalizedName: { groupId, normalizedName: normalizedCategoryName("Watchlist") } }
  });
}

export async function listCommunityTriggerLibrary(input: {
  groupId: string;
  query?: string | null;
  action?: CommunityModerationActionType | null;
  triggerGroupId?: string | null;
  pendingApproval?: boolean;
  page?: number;
  pageSize?: number;
}) {
  const pageSize = Math.min(10, Math.max(1, input.pageSize ?? 6));
  const page = Math.max(0, input.page ?? 0);
  const query = input.query?.trim();
  const where: Prisma.CommunityTriggerWhereInput = {
    groupId: input.groupId,
    pendingApproval: input.pendingApproval,
    triggerGroupId: input.triggerGroupId || undefined,
    triggerGroup: input.action ? { action: input.action } : undefined,
    OR: query
      ? [
          { pattern: { contains: query, mode: "insensitive" } },
          { triggerGroup: { name: { contains: query, mode: "insensitive" } } }
        ]
      : undefined
  };
  const [items, total] = await prisma.$transaction([
    prisma.communityTrigger.findMany({
      where,
      include: { triggerGroup: true },
      orderBy: [{ pendingApproval: "desc" }, { updatedAt: "desc" }],
      skip: page * pageSize,
      take: pageSize
    }),
    prisma.communityTrigger.count({ where })
  ]);
  return { items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function removeCommunityTrigger(groupId: string, id: string): Promise<boolean> {
  const result = await prisma.communityTrigger.deleteMany({ where: { id, groupId } });
  return result.count === 1;
}

export async function moveCommunityTrigger(groupId: string, id: string, targetGroupId: string): Promise<boolean> {
  const target = await prisma.communityTriggerGroup.findFirst({ where: { id: targetGroupId, groupId } });
  if (!target) return false;
  const result = await prisma.communityTrigger.updateMany({ where: { id, groupId }, data: { triggerGroupId: targetGroupId } });
  return result.count === 1;
}

export async function moveAndApproveCommunityTrigger(groupId: string, id: string, targetGroupId: string, actorTelegramId: string): Promise<boolean> {
  const target = await prisma.communityTriggerGroup.findFirst({ where: { id: targetGroupId, groupId } });
  if (!target) return false;
  const result = await prisma.communityTrigger.updateMany({
    where: { id, groupId },
    data: {
      triggerGroupId: targetGroupId,
      pendingApproval: false,
      approvedByTelegramId: actorTelegramId,
      approvedAt: new Date()
    }
  });
  return result.count === 1;
}

export async function updateTriggerGroupAction(input: {
  groupId: string;
  triggerGroupId: string;
  action: CommunityModerationActionType;
  deleteMessage: boolean;
  muteDurationMinutes?: number | null;
}) {
  return prisma.communityTriggerGroup.updateMany({
    where: { id: input.triggerGroupId, groupId: input.groupId },
    data: {
      action: input.action,
      deleteMessage: input.deleteMessage,
      muteDurationMinutes: input.action === CommunityModerationActionType.MUTE ? input.muteDurationMinutes ?? 60 : null
    }
  });
}

export async function policyTriggersForGroup(groupId: string) {
  return prisma.communityTrigger.findMany({
    where: { groupId, pendingApproval: false, triggerGroup: { enabled: true } },
    include: { triggerGroup: true }
  });
}

export async function isTrustedCommunityMember(groupId: string, telegramId: string): Promise<boolean> {
  return Boolean(await prisma.communityTrustedMember.findUnique({ where: { groupId_telegramId: { groupId, telegramId } } }));
}

export async function listTrustedCommunityMembers(groupId: string) {
  return prisma.communityTrustedMember.findMany({ where: { groupId }, orderBy: [{ displayName: "asc" }, { createdAt: "asc" }] });
}

export async function addTrustedCommunityMember(input: {
  groupId: string;
  telegramId: string;
  username?: string;
  displayName?: string;
  actorTelegramId: string;
}) {
  return prisma.communityTrustedMember.upsert({
    where: { groupId_telegramId: { groupId: input.groupId, telegramId: input.telegramId } },
    create: {
      groupId: input.groupId,
      telegramId: input.telegramId,
      username: input.username,
      displayName: input.displayName,
      addedByTelegramId: input.actorTelegramId
    },
    update: { username: input.username, displayName: input.displayName, addedByTelegramId: input.actorTelegramId }
  });
}

export async function removeTrustedCommunityMember(groupId: string, trustedId: string): Promise<boolean> {
  const result = await prisma.communityTrustedMember.deleteMany({ where: { id: trustedId, groupId } });
  return result.count === 1;
}

export async function upsertCommunityMember(input: {
  groupId: string;
  telegramId: string;
  username?: string;
  displayName?: string;
  joined?: boolean;
  active?: boolean;
}) {
  return prisma.communityMember.upsert({
    where: { groupId_telegramId: { groupId: input.groupId, telegramId: input.telegramId } },
    create: {
      groupId: input.groupId,
      telegramId: input.telegramId,
      username: input.username,
      displayName: input.displayName,
      active: input.active ?? true,
      joinedAt: new Date(),
      leftAt: input.active === false ? new Date() : null
    },
    update: {
      username: input.username,
      displayName: input.displayName,
      active: input.active ?? true,
      joinedAt: input.joined ? new Date() : undefined,
      leftAt: input.active === false ? new Date() : null,
      lastSeenAt: new Date()
    }
  });
}

export async function isNewCommunityMemberPaused(group: CommunityGroup, telegramId: string): Promise<boolean> {
  if (!group.pauseNewMemberPosting) return false;
  const member = await prisma.communityMember.findUnique({ where: { groupId_telegramId: { groupId: group.id, telegramId } } });
  return Boolean(member?.active && member.joinedAt.getTime() > Date.now() - group.newMemberPauseHours * 60 * 60_000);
}

export async function createOrIncrementCommunityReport(input: {
  groupId: string;
  sourceChatId: string;
  sourceMessageId: number;
  sourceMessageThreadId?: number;
  sourceTopicName?: string;
  reporterTelegramId: string;
  reportedTelegramId?: string;
  reportedUsername?: string;
  reportedDisplayName?: string;
  evidenceText?: string;
  reason?: string;
}) {
  const existing = await prisma.communityReport.findUnique({
    where: { groupId_sourceMessageId: { groupId: input.groupId, sourceMessageId: input.sourceMessageId } },
    include: { reporters: true }
  });
  if (existing) {
    const alreadyReported = existing.reporters.some((reporter) => reporter.reporterTelegramId === input.reporterTelegramId);
    if (alreadyReported) return { report: existing, incremented: false };
    const report = await prisma.communityReport.update({
      where: { id: existing.id },
      data: {
        reportCount: { increment: 1 },
        reporters: { create: { reporterTelegramId: input.reporterTelegramId } }
      },
      include: { reporters: true }
    });
    return { report, incremented: true };
  }
  const report = await prisma.communityReport.create({
    data: {
      groupId: input.groupId,
      sourceChatId: input.sourceChatId,
      sourceMessageId: input.sourceMessageId,
      sourceMessageThreadId: input.sourceMessageThreadId,
      sourceTopicName: input.sourceTopicName,
      reportedTelegramId: input.reportedTelegramId,
      reportedUsername: input.reportedUsername,
      reportedDisplayName: input.reportedDisplayName,
      evidenceText: input.evidenceText?.slice(0, 8_000),
      evidenceExpiresAt: new Date(Date.now() + EVIDENCE_TTL_MS),
      reason: input.reason?.slice(0, 500),
      reporters: { create: { reporterTelegramId: input.reporterTelegramId } }
    },
    include: { reporters: true }
  });
  return { report, incremented: true };
}

export async function communitySeverityRules(groupId: string) {
  await ensureDefaultSeverityRules(groupId);
  return prisma.communitySeverityRule.findMany({ where: { groupId }, orderBy: { points: "asc" } });
}

export async function communitySeverityPoints(groupId: string, severity: CommunityOffenceSeverity): Promise<number> {
  await ensureDefaultSeverityRules(groupId);
  const rule = await prisma.communitySeverityRule.findUnique({ where: { groupId_severity: { groupId, severity } } });
  return rule?.points ?? DEFAULT_SEVERITY_POINTS[severity];
}

export async function updateCommunitySeverityPoints(groupId: string, severity: CommunityOffenceSeverity, points: number) {
  return prisma.communitySeverityRule.upsert({
    where: { groupId_severity: { groupId, severity } },
    create: { groupId, severity, points },
    update: { points }
  });
}

export async function updateCommunityScoreThreshold(groupId: string, kind: "WARNING" | "MUTE" | "BAN", points: number) {
  const data = kind === "WARNING" ? { warningScoreThreshold: points }
    : kind === "MUTE" ? { muteScoreThreshold: points }
      : { banScoreThreshold: points };
  return prisma.communityGroup.update({ where: { id: groupId }, data });
}

export async function createCommunityOffenceProposal(input: {
  reportId: string;
  severity: CommunityOffenceSeverity;
  policyPoints: number;
  proposedPoints: number;
  proposedByTelegramId: string;
  proposalReason?: string;
}) {
  const report = await communityReportById(input.reportId);
  if (!report?.reportedTelegramId) throw new Error("OFFENCE_TARGET_REQUIRED");
  const existing = await prisma.communityOffence.findUnique({ where: { reportId: report.id }, include: { group: true, report: true } });
  if (existing && (existing.status === CommunityOffenceStatus.PENDING || existing.status === CommunityOffenceStatus.ACTIVE)) {
    return { offence: existing, created: false };
  }
  const offence = await prisma.communityOffence.upsert({
    where: { reportId: report.id },
    create: {
      groupId: report.groupId,
      reportId: report.id,
      targetTelegramId: report.reportedTelegramId,
      targetUsername: report.reportedUsername,
      targetDisplayName: report.reportedDisplayName,
      sourceChatId: report.sourceChatId,
      sourceMessageId: report.sourceMessageId,
      sourceMessageThreadId: report.sourceMessageThreadId,
      sourceTopicName: report.sourceTopicName,
      categoryName: report.reason,
      severity: input.severity,
      policyPoints: input.policyPoints,
      proposedPoints: input.proposedPoints,
      proposedByTelegramId: input.proposedByTelegramId,
      proposalReason: input.proposalReason,
      status: CommunityOffenceStatus.PENDING
    },
    update: {
      severity: input.severity,
      policyPoints: input.policyPoints,
      proposedPoints: input.proposedPoints,
      proposedByTelegramId: input.proposedByTelegramId,
      proposalReason: input.proposalReason,
      appliedPoints: null,
      status: CommunityOffenceStatus.PENDING,
      confirmedByTelegramId: null,
      confirmedAt: null,
      pardonedByTelegramId: null,
      pardonedAt: null,
      pardonReason: null
    },
    include: { group: true, report: true }
  });
  return { offence, created: true };
}

export async function communityOffenceById(id: string) {
  return prisma.communityOffence.findUnique({ where: { id }, include: { group: true, report: true } });
}

export async function confirmCommunityOffence(id: string, actorTelegramId: string, points: number) {
  return prisma.$transaction(async (tx) => {
    const offence = await tx.communityOffence.findUnique({ where: { id } });
    if (!offence || offence.status !== CommunityOffenceStatus.PENDING) return null;
    const active = await tx.communityOffence.update({
      where: { id },
      data: {
        status: CommunityOffenceStatus.ACTIVE,
        appliedPoints: points,
        confirmedByTelegramId: actorTelegramId,
        confirmedAt: new Date()
      },
      include: { group: true, report: true }
    });
    const score = await tx.communityOffence.aggregate({
      where: { groupId: active.groupId, targetTelegramId: active.targetTelegramId, status: CommunityOffenceStatus.ACTIVE },
      _sum: { appliedPoints: true }
    });
    return { offence: active, score: score._sum.appliedPoints ?? 0 };
  });
}

export async function rejectCommunityOffence(id: string, actorTelegramId: string) {
  return prisma.communityOffence.updateMany({
    where: { id, status: CommunityOffenceStatus.PENDING },
    data: { status: CommunityOffenceStatus.REJECTED, confirmedByTelegramId: actorTelegramId, confirmedAt: new Date() }
  });
}

export async function communityMemberOffenceScore(groupId: string, telegramId: string): Promise<number> {
  const result = await prisma.communityOffence.aggregate({
    where: { groupId, targetTelegramId: telegramId, status: CommunityOffenceStatus.ACTIVE },
    _sum: { appliedPoints: true }
  });
  return result._sum.appliedPoints ?? 0;
}

export async function communityMemberOffences(groupId: string, telegramId: string, take = 10) {
  return prisma.communityOffence.findMany({
    where: { groupId, targetTelegramId: telegramId },
    orderBy: { createdAt: "desc" },
    take
  });
}

export async function pardonCommunityOffence(id: string, actorTelegramId: string, reason?: string) {
  return prisma.communityOffence.updateMany({
    where: { id, status: CommunityOffenceStatus.ACTIVE },
    data: {
      status: CommunityOffenceStatus.PARDONED,
      pardonedByTelegramId: actorTelegramId,
      pardonedAt: new Date(),
      pardonReason: reason?.slice(0, 500)
    }
  });
}

export async function reduceCommunityOffence(id: string, points: number) {
  return prisma.communityOffence.updateMany({
    where: { id, status: CommunityOffenceStatus.ACTIVE },
    data: { appliedPoints: points }
  });
}

export async function pardonAllCommunityOffences(groupId: string, telegramId: string, actorTelegramId: string, reason?: string) {
  return prisma.communityOffence.updateMany({
    where: { groupId, targetTelegramId: telegramId, status: CommunityOffenceStatus.ACTIVE },
    data: {
      status: CommunityOffenceStatus.PARDONED,
      pardonedByTelegramId: actorTelegramId,
      pardonedAt: new Date(),
      pardonReason: reason?.slice(0, 500)
    }
  });
}

export async function markCommunityOffencePermanentBan(id: string): Promise<void> {
  await prisma.communityOffence.update({ where: { id }, data: { permanentBanApplied: true } });
}

export async function hasPermanentCommunityBan(groupId: string, telegramId: string): Promise<boolean> {
  return Boolean(await prisma.communityOffence.findFirst({
    where: {
      groupId,
      targetTelegramId: telegramId,
      status: CommunityOffenceStatus.ACTIVE,
      permanentBanApplied: true
    },
    select: { id: true }
  }));
}

export async function upsertCommunityForumTopic(input: {
  groupId: string;
  messageThreadId: number;
  name: string;
  iconColor?: number;
  iconCustomEmojiId?: string;
}) {
  return prisma.communityForumTopic.upsert({
    where: { groupId_messageThreadId: { groupId: input.groupId, messageThreadId: input.messageThreadId } },
    create: input,
    update: { name: input.name, iconColor: input.iconColor, iconCustomEmojiId: input.iconCustomEmojiId, active: true }
  });
}

export async function communityForumTopic(groupId: string, messageThreadId: number) {
  return prisma.communityForumTopic.findUnique({ where: { groupId_messageThreadId: { groupId, messageThreadId } } });
}

export async function markCommunityForumTopicReplaced(groupId: string, messageThreadId: number, replacementThreadId: number): Promise<void> {
  await prisma.communityForumTopic.updateMany({
    where: { groupId, messageThreadId },
    data: { active: false, replacedByThreadId: replacementThreadId }
  });
}

export async function communityReportById(id: string) {
  return prisma.communityReport.findUnique({ where: { id }, include: { group: true, reporters: true } });
}

export async function attachCommunityReportMessage(id: string, chatId: string, messageId: number): Promise<void> {
  await prisma.communityReport.update({ where: { id }, data: { moderatorChatId: chatId, moderatorMessageId: messageId } });
}

export async function resolveCommunityReport(id: string, status: CommunityReportStatus, actorTelegramId: string): Promise<void> {
  await prisma.communityReport.update({
    where: { id },
    data: { status, resolvedByTelegramId: actorTelegramId, resolvedAt: new Date() }
  });
}

export async function recordCommunityAction(input: {
  groupId: string;
  actorTelegramId: string;
  targetTelegramId?: string;
  action: CommunityModerationActionType;
  source: string;
  sourceMessageId?: number;
  sourceMessageThreadId?: number;
  sourceTopicName?: string;
  reportId?: string;
  reason?: string;
  muteUntil?: Date;
  reversible?: boolean;
}) {
  return prisma.communityModerationAction.create({ data: input });
}

export async function communityActionById(id: string) {
  return prisma.communityModerationAction.findUnique({ where: { id }, include: { group: true } });
}

export async function markCommunityActionUndone(id: string, actorTelegramId: string): Promise<void> {
  await prisma.communityModerationAction.update({ where: { id }, data: { undoneAt: new Date(), undoneByTelegramId: actorTelegramId } });
}

export async function recentCommunityActions(groupId: string, take = 8) {
  return prisma.communityModerationAction.findMany({ where: { groupId }, orderBy: { createdAt: "desc" }, take });
}

export async function recordCommunityAudit(input: {
  groupId: string;
  actorTelegramId: string;
  action: string;
  targetTelegramId?: string;
  details?: Record<string, unknown>;
  ownerNotificationStatus?: string;
}) {
  return prisma.communityAudit.create({
    data: { ...input, details: input.details as Prisma.InputJsonValue | undefined }
  });
}

export async function recentCommunityAudits(groupId: string, take = 8) {
  return prisma.communityAudit.findMany({ where: { groupId }, orderBy: { createdAt: "desc" }, take });
}

export async function setCommunityOwnerNotificationStatus(id: string, status: string): Promise<void> {
  await prisma.communityAudit.update({ where: { id }, data: { ownerNotificationStatus: status } });
}

export async function setCommunityObserveMode(groupId: string, observeMode: boolean) {
  return prisma.communityGroup.update({ where: { id: groupId }, data: { observeMode } });
}

export async function setCommunityLockdownMode(groupId: string, lockdownMode: boolean) {
  return prisma.communityGroup.update({ where: { id: groupId }, data: { lockdownMode } });
}

export async function setCommunityNewMemberPause(groupId: string, pauseNewMemberPosting: boolean) {
  return prisma.communityGroup.update({ where: { id: groupId }, data: { pauseNewMemberPosting } });
}

export async function setCommunityRules(groupId: string, language: "EN" | "MY", text: string) {
  return prisma.communityGroup.update({
    where: { id: groupId },
    data: language === "EN" ? { rulesEnglish: text } : { rulesBurmese: text }
  });
}

export async function cycleCommunityFloodPreset(group: CommunityGroup) {
  const next = group.floodMessageLimit <= 4
    ? { floodMessageLimit: 10, floodWindowSeconds: 10 }
    : group.floodMessageLimit >= 10
      ? { floodMessageLimit: 6, floodWindowSeconds: 10 }
      : { floodMessageLimit: 4, floodWindowSeconds: 10 };
  return prisma.communityGroup.update({ where: { id: group.id }, data: next });
}

export async function cycleCommunityDuplicatePreset(group: CommunityGroup) {
  const nextLimit = group.duplicateMessageLimit <= 2 ? 5 : group.duplicateMessageLimit >= 5 ? 3 : 2;
  return prisma.communityGroup.update({ where: { id: group.id }, data: { duplicateMessageLimit: nextLimit, duplicateWindowSeconds: 60 } });
}

export async function cycleCommunityMentionLimit(group: CommunityGroup) {
  const nextLimit = group.massMentionLimit <= 3 ? 8 : group.massMentionLimit >= 8 ? 5 : 3;
  return prisma.communityGroup.update({ where: { id: group.id }, data: { massMentionLimit: nextLimit } });
}

export async function listOpenCommunityReports(groupId: string, take = 8) {
  return prisma.communityReport.findMany({ where: { groupId, status: CommunityReportStatus.OPEN }, orderBy: { createdAt: "desc" }, take });
}

export async function countOpenCommunityReports(groupId: string): Promise<number> {
  return prisma.communityReport.count({ where: { groupId, status: CommunityReportStatus.OPEN } });
}

export async function listPendingCommunityTriggers(groupId: string, take = 8) {
  return prisma.communityTrigger.findMany({
    where: { groupId, pendingApproval: true },
    include: { triggerGroup: true },
    orderBy: { createdAt: "asc" },
    take,
  });
}

export async function expireCommunityEvidence(): Promise<number> {
  const result = await prisma.communityReport.updateMany({
    where: { evidenceExpiresAt: { lte: new Date() }, evidenceText: { not: null } },
    data: { evidenceText: null }
  });
  await prisma.communityConversation.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  await prisma.communityProcessedUpdate.deleteMany({
    where: { createdAt: { lte: new Date(Date.now() - 30 * 24 * 60 * 60_000) } }
  });
  return result.count;
}
