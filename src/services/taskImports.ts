/**
 * Group "TODO:" list import. A member pastes a list under a TODO: or ACTION ITEMS:
 * heading; it becomes a pending review (one row per task) that the sender or a
 * group admin can edit in Telegram or the dashboard, then import as real tasks.
 * Used by src/bot/taskImports.ts and the dashboard routes in src/dashboard/route.ts.
 */
import {
  GroupMemberStatus,
  GroupActivityType,
  Prisma,
  TaskImportItemStatus,
  TaskImportStatus,
  TaskStatus,
  type PrismaClient,
} from "@prisma/client";
import { structureTaskDeterministically } from "../ai/deterministic";
import { prisma } from "../db/prisma";
import { parseDueDate } from "../utils/dates";
import { recordGroupTaskActivity, type CollaborationActor } from "./groupCollaboration";
import { createTask, type TaskEntityMention } from "./tasks";

const IMPORT_TTL_MS = 24 * 60 * 60 * 1_000;
const IMPORT_CLAIM_TTL_MS = 10 * 60 * 1_000;
export const MAX_TASK_IMPORT_ITEMS = 25;

export type TaskImportAssignee = {
  telegramId?: string;
  username?: string;
  displayName?: string;
};

type TaskImportMembership = {
  telegramId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
};

type MemberAliasMap = Map<string, TaskImportMembership | null>;

export type ParsedTaskImportItem = {
  title: string;
  sourceText: string;
  dueAt?: Date;
  assignees: TaskImportAssignee[];
  teamOwnerLabel?: string;
  initialStatus: TaskStatus;
  warnings: string[];
};

export type TaskImportReview = Prisma.PendingTaskImportGetPayload<{
  include: { items: { orderBy: { position: "asc" } }; workspace: { select: { title: true; telegramChatId: true } } };
}>;

/**
 * Import failure with a user-safe message and a code the dashboard maps to an
 * HTTP status (invalid, not_found, forbidden, expired, conflict).
 */
export class TaskImportError extends Error {
  constructor(
    message: string,
    public readonly code: "invalid" | "not_found" | "forbidden" | "expired" | "conflict",
  ) {
    super(message);
    this.name = "TaskImportError";
  }
}

/**
 * Returns the list body after a TODO: / TO DO: / ACTION ITEMS: heading, or
 * undefined when the message is not an import.
 */
export function stripTaskImportHeader(text: string): string | undefined {
  const match = text.match(/^\s*(?:TODO|TO\s+DO|ACTION\s+ITEMS?)\s*:\s*/iu);
  if (!match) return undefined;
  return text.slice(match[0].length).trim();
}

/**
 * Turns the list body into review rows, deterministically. For each line it
 * detects done markers, a trailing "(owner)" clause, @mentions and member names,
 * a due date and a title. Assignees are matched to active group members where
 * possible. Capped at MAX_TASK_IMPORT_ITEMS.
 */
export function parseTaskImportText(
  sourceText: string,
  timezone: string,
  mentions: TaskEntityMention[] = [],
  memberships: TaskImportMembership[] = [],
): ParsedTaskImportItem[] {
  const body = stripTaskImportHeader(sourceText);
  if (body === undefined) return [];
  const candidates = splitTaskCandidates(body).slice(0, MAX_TASK_IMPORT_ITEMS);
  const membersByUsername = new Map(
    memberships
      .filter((member) => member.username)
      .map((member) => [member.username!.toLowerCase(), member]),
  );
  const memberAliases = buildMemberAliases(memberships);

  return candidates.map((candidate) => {
    const status = completedTaskText(candidate) ? TaskStatus.DONE : TaskStatus.OPEN;
    const withoutStatus = stripCompletionMarkers(candidate);
    const owner = extractOwnerClause(withoutStatus, memberAliases);
    const taskText = owner.taskText || withoutStatus;
    const assignees: TaskImportAssignee[] = [];

    for (const username of `${owner.ownerText ?? ""} ${taskText}`.matchAll(/@([A-Za-z0-9_]{3,32})\b/g)) {
      const value = username[1];
      if (!value) continue;
      const member = membersByUsername.get(value.toLowerCase());
      addImportAssignee(assignees, {
        username: value,
        ...(member ? {
          telegramId: member.telegramId,
          displayName: memberDisplayName(member) || value,
        } : { displayName: value }),
      });
    }

    for (const mention of mentions) {
      const labels = [mention.username ? `@${mention.username}` : undefined, mention.displayName].filter(Boolean) as string[];
      if (!labels.some((label) => candidate.toLocaleLowerCase().includes(label.toLocaleLowerCase()))) continue;
      addImportAssignee(assignees, {
        telegramId: mention.telegramId,
        username: mention.username,
        displayName: mention.displayName,
      });
    }

    for (const member of membersFromOwnerClause(owner.ownerText, memberAliases)) {
      addImportAssignee(assignees, {
        telegramId: member.telegramId,
        username: member.username ?? undefined,
        displayName: memberDisplayName(member) || member.username || undefined,
      });
    }

    const teamOwnerLabel = normalizeTeamOwner(owner.ownerText, assignees, memberAliases);
    const structuredInput = taskText
      .replace(/^\s*(?:@\w+\s*(?:,|&|and)?\s*)+/iu, "")
      .replace(/\s+/g, " ")
      .trim();
    const structured = structureTaskDeterministically(structuredInput || withoutStatus);
    const title = (structured.title || structuredInput || candidate).trim().slice(0, 500);
    const dueAt = parseDueDate(taskText, timezone);
    const warnings = buildTaskImportWarnings(assignees, teamOwnerLabel, status);

    return {
      title,
      sourceText: candidate.trim(),
      ...(dueAt ? { dueAt } : {}),
      assignees,
      ...(teamOwnerLabel ? { teamOwnerLabel } : {}),
      initialStatus: status,
      warnings,
    };
  }).filter((item) => item.title.length > 0);
}

/**
 * Parses the message against the group's active members and stores a pending
 * import with its rows. Nothing becomes a task yet. The review expires after 24 hours.
 */
export async function createPendingTaskImport(input: {
  ownerUserId: string;
  workspaceId: string;
  requestedByTelegramId: string;
  requestedByName: string;
  sourceText: string;
  timezone: string;
  mentions?: TaskEntityMention[];
  telegramMessageId?: number;
  telegramThreadId?: number;
}, database: PrismaClient = prisma): Promise<TaskImportReview> {
  const members = await database.groupMembership.findMany({
    where: { workspaceId: input.workspaceId, status: GroupMemberStatus.ACTIVE },
    select: { telegramId: true, username: true, firstName: true, lastName: true },
  });
  const parsed = parseTaskImportText(input.sourceText, input.timezone, input.mentions, members);
  if (parsed.length === 0) {
    throw new TaskImportError("Add at least one task under the TODO: or ACTION ITEMS: heading.", "invalid");
  }

  return database.pendingTaskImport.create({
    data: {
      ownerUserId: input.ownerUserId,
      workspaceId: input.workspaceId,
      requestedByTelegramId: input.requestedByTelegramId,
      requestedByName: input.requestedByName.slice(0, 120),
      sourceText: input.sourceText,
      telegramMessageId: input.telegramMessageId,
      telegramThreadId: input.telegramThreadId,
      expiresAt: new Date(Date.now() + IMPORT_TTL_MS),
      items: {
        create: parsed.map((item, index) => ({
          position: index + 1,
          title: item.title,
          sourceText: item.sourceText,
          dueAt: item.dueAt,
          assignees: item.assignees as Prisma.InputJsonValue,
          teamOwnerLabel: item.teamOwnerLabel,
          initialStatus: item.initialStatus,
          warnings: item.warnings,
        })),
      },
    },
    include: reviewInclude,
  });
}

/**
 * Loads an import review, optionally limited to one workspace. A pending review
 * past its expiry is marked EXPIRED on read.
 */
export async function getTaskImportReview(importId: string, workspaceId?: string, database: PrismaClient = prisma): Promise<TaskImportReview> {
  const taskImport = await database.pendingTaskImport.findFirst({
    where: { id: importId, ...(workspaceId ? { workspaceId } : {}) },
    include: reviewInclude,
  });
  if (!taskImport) throw new TaskImportError("That task import no longer exists.", "not_found");
  if (taskImport.expiresAt.getTime() <= Date.now() && (taskImport.status === TaskImportStatus.PENDING || taskImport.status === TaskImportStatus.PARTIAL)) {
    const expired = await database.pendingTaskImport.update({
      where: { id: taskImport.id },
      data: { status: TaskImportStatus.EXPIRED },
      include: reviewInclude,
    });
    return expired;
  }
  return taskImport;
}

/**
 * Builds the acting member's name from the stored group membership, for
 * permission checks and activity entries.
 */
export async function resolveTaskImportActor(
  workspaceId: string,
  telegramId: string,
  isManager: boolean,
  database: PrismaClient = prisma,
): Promise<CollaborationActor & { isManager: boolean }> {
  const membership = await database.groupMembership.findUnique({
    where: { workspaceId_telegramId: { workspaceId, telegramId } },
    select: { username: true, firstName: true, lastName: true },
  });
  const displayName = [membership?.firstName, membership?.lastName].filter(Boolean).join(" ").trim()
    || membership?.username
    || "Group member";
  return {
    telegramId,
    ...(membership?.username ? { username: membership.username } : {}),
    displayName,
    isManager,
  };
}

/**
 * Edits one review row (title, due date, assignees, owner label, done state,
 * include or skip). Only the sender or an admin may edit, and only while the
 * review is still pending. Warnings are recalculated on every edit.
 */
export async function updateTaskImportItem(
  importId: string,
  itemId: string,
  actor: { telegramId: string; isManager: boolean },
  input: {
    title?: string;
    dueAt?: Date | null;
    assignees?: TaskImportAssignee[];
    teamOwnerLabel?: string | null;
    initialStatus?: TaskStatus;
    included?: boolean;
  },
  workspaceId?: string,
  database: PrismaClient = prisma,
): Promise<TaskImportReview> {
  const taskImport = await getTaskImportReview(importId, workspaceId, database);
  assertImportControl(taskImport, actor);
  assertReviewEditable(taskImport);
  const item = taskImport.items.find((entry) => entry.id === itemId);
  if (!item) throw new TaskImportError("That import row no longer exists.", "not_found");
  if (item.status === TaskImportItemStatus.IMPORTED) throw new TaskImportError("That row has already been imported.", "conflict");
  const title = input.title?.replace(/\s+/g, " ").trim();
  if (input.title !== undefined && !title) throw new TaskImportError("A task title cannot be empty.", "invalid");
  const assignees = input.assignees !== undefined ? input.assignees : readAssignees(item.assignees);
  const teamOwnerLabel = input.teamOwnerLabel !== undefined
    ? input.teamOwnerLabel?.trim().slice(0, 120) || null
    : item.teamOwnerLabel;
  const initialStatus = input.initialStatus ?? item.initialStatus;
  const included = input.included ?? item.included;

  await database.pendingTaskImportItem.update({
    where: { id: item.id },
    data: {
      ...(title ? { title: title.slice(0, 500) } : {}),
      ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
      ...(input.assignees !== undefined ? { assignees: assignees as Prisma.InputJsonValue } : {}),
      ...(input.teamOwnerLabel !== undefined ? { teamOwnerLabel } : {}),
      ...(input.initialStatus ? { initialStatus: input.initialStatus } : {}),
      ...(input.included !== undefined ? { included: input.included } : {}),
      warnings: buildTaskImportWarnings(assignees, teamOwnerLabel, initialStatus),
      status: included ? TaskImportItemStatus.READY : TaskImportItemStatus.SKIPPED,
      errorMessage: null,
    },
  });
  return getTaskImportReview(importId, workspaceId, database);
}

/**
 * Cancels the review. Repeating a cancel, or cancelling a finished import,
 * returns it unchanged; a review that is importing right now cannot be cancelled.
 */
export async function cancelTaskImport(
  importId: string,
  actor: { telegramId: string; isManager: boolean },
  workspaceId?: string,
  database: PrismaClient = prisma,
): Promise<TaskImportReview> {
  const taskImport = await getTaskImportReview(importId, workspaceId, database);
  assertImportControl(taskImport, actor);
  if (taskImport.status === TaskImportStatus.IMPORTED || taskImport.status === TaskImportStatus.CANCELED) return taskImport;
  if (taskImport.status === TaskImportStatus.IMPORTING) throw new TaskImportError("This import is already being processed.", "conflict");
  return database.pendingTaskImport.update({
    where: { id: taskImport.id },
    data: { status: TaskImportStatus.CANCELED, canceledAt: new Date() },
    include: reviewInclude,
  });
}

/**
 * Creates tasks from the included rows. The import is claimed by moving it to
 * IMPORTING with a conditional update, so two presses cannot run it twice. A
 * claim older than ten minutes (a crashed run) can be taken over. Each row is
 * linked to its task through importSourceItemId, so a retry never creates a
 * duplicate. Failed rows leave the import PARTIAL so they can be retried.
 */
export async function importReviewedTasks(
  importId: string,
  actor: CollaborationActor & { isManager: boolean },
  workspaceId?: string,
  database: PrismaClient = prisma,
): Promise<{ taskImport: TaskImportReview; imported: number; failed: number; skipped: number }> {
  const initial = await getTaskImportReview(importId, workspaceId, database);
  assertImportControl(initial, actor);
  if (initial.status === TaskImportStatus.EXPIRED) throw new TaskImportError("This review expired. Send the TODO list again.", "expired");
  if (initial.status === TaskImportStatus.CANCELED) throw new TaskImportError("This import was canceled.", "conflict");
  if (initial.status === TaskImportStatus.IMPORTED) return importCounts(initial);
  if (initial.status === TaskImportStatus.IMPORTING && importClaimExpired(initial.updatedAt)) {
    await database.pendingTaskImport.updateMany({
      where: { id: initial.id, status: TaskImportStatus.IMPORTING, updatedAt: initial.updatedAt },
      data: { status: TaskImportStatus.PARTIAL },
    });
  }
  const claimed = await database.pendingTaskImport.updateMany({
    where: { id: initial.id, status: { in: [TaskImportStatus.PENDING, TaskImportStatus.PARTIAL] } },
    data: { status: TaskImportStatus.IMPORTING },
  });
  if (claimed.count === 0) throw new TaskImportError("This import is already being processed.", "conflict");

  for (const item of initial.items) {
    await heartbeatTaskImport(initial.id, database);
    if (!item.included) {
      if (item.status !== TaskImportItemStatus.IMPORTED) {
        await database.pendingTaskImportItem.update({ where: { id: item.id }, data: { status: TaskImportItemStatus.SKIPPED, errorMessage: null } });
      }
      continue;
    }
    if (item.taskId) {
      if (item.status !== TaskImportItemStatus.IMPORTED) {
        await database.pendingTaskImportItem.update({
          where: { id: item.id },
          data: { status: TaskImportItemStatus.IMPORTED, errorMessage: null },
        });
      }
      continue;
    }
    try {
      const assignees = readAssignees(item.assignees);
      const existingTask = await database.task.findUnique({ where: { importSourceItemId: item.id } });
      if (existingTask) {
        await database.pendingTaskImportItem.update({
          where: { id: item.id },
          data: { status: TaskImportItemStatus.IMPORTED, taskId: existingTask.id, errorMessage: null },
        });
        continue;
      }
      const task = await createTask(initial.ownerUserId, item.sourceText, {
        titleOverride: item.title,
        dueAt: item.dueAt ?? undefined,
        importItemId: item.id,
        teamOwnerLabel: item.teamOwnerLabel ?? undefined,
        initialStatus: item.initialStatus,
        assignees,
      });
      await database.pendingTaskImportItem.update({
        where: { id: item.id },
        data: { status: TaskImportItemStatus.IMPORTED, taskId: task.id, errorMessage: null },
      });
      await recordGroupTaskActivity(
        initial.ownerUserId,
        actor,
        item.initialStatus === TaskStatus.DONE ? GroupActivityType.TASK_COMPLETED : GroupActivityType.TASK_CREATED,
        task,
        `${actor.displayName} imported ${task.publicId}: ${task.title}.`,
        database,
      );
    } catch (error) {
      const existingTask = await database.task.findUnique({ where: { importSourceItemId: item.id } });
      if (existingTask) {
        await database.pendingTaskImportItem.update({
          where: { id: item.id },
          data: { status: TaskImportItemStatus.IMPORTED, taskId: existingTask.id, errorMessage: null },
        });
        continue;
      }
      await database.pendingTaskImportItem.update({
        where: { id: item.id },
        data: {
          status: TaskImportItemStatus.FAILED,
          errorMessage: importFailureMessage(error),
        },
      });
    }
  }

  const refreshedItems = await database.pendingTaskImportItem.findMany({ where: { importId: initial.id } });
  const failed = refreshedItems.filter((item) => item.included && item.status === TaskImportItemStatus.FAILED).length;
  const nextStatus = failed > 0 ? TaskImportStatus.PARTIAL : TaskImportStatus.IMPORTED;
  const taskImport = await database.pendingTaskImport.update({
    where: { id: initial.id },
    data: { status: nextStatus, importedAt: nextStatus === TaskImportStatus.IMPORTED ? new Date() : null },
    include: reviewInclude,
  });
  return importCounts(taskImport);
}

/** True when an IMPORTING claim has not been refreshed for ten minutes. */
export function importClaimExpired(updatedAt: Date, now = new Date()): boolean {
  return now.getTime() - updatedAt.getTime() >= IMPORT_CLAIM_TTL_MS;
}

/**
 * Touches the import's updatedAt between rows so a long import is not seen as
 * abandoned. Throws if another run has taken over the import.
 */
async function heartbeatTaskImport(importId: string, database: PrismaClient): Promise<void> {
  const heartbeat = await database.pendingTaskImport.updateMany({
    where: { id: importId, status: TaskImportStatus.IMPORTING },
    data: { status: TaskImportStatus.IMPORTING },
  });
  if (heartbeat.count === 0) throw new TaskImportError("This import is no longer active. Refresh the review before trying again.", "conflict");
}

/**
 * Splits the list body into items. Bullets, numbers and checkboxes start a new
 * item; plain lines continue the previous one; blank lines end it. Ticked
 * checkboxes are kept as "[x]" so the item imports as done.
 */
function splitTaskCandidates(body: string): string[] {
  const lines = body.replace(/\r/g, "").split("\n");
  const items: string[] = [];
  let current: string[] = [];
  const flush = () => {
    const value = current.join(" ").replace(/\s+/g, " ").trim();
    if (value) items.push(value);
    current = [];
  };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }
    const checkbox = line.match(/^(\[(?: |x|X)\]|☐|(?:☑|✅)\uFE0F?)\s+(.+)$/u);
    if (checkbox?.[2]) {
      flush();
      current.push(/^(?:\[[xX]\]|(?:☑|✅)\uFE0F?)$/u.test(checkbox[1] ?? "") ? `[x] ${checkbox[2]}` : checkbox[2]);
      continue;
    }
    const bullet = line.match(/^(?:[-*•–—]|\d+[.)]|[A-Za-z][.)])\s+(.+)$/u);
    if (bullet?.[1]) {
      flush();
      current.push(bullet[1]);
    } else {
      current.push(line);
    }
  }
  flush();
  return items;
}

/** True when an item is marked done (a tick, [x], or a trailing "(done)"). */
function completedTaskText(value: string): boolean {
  return /^\s*(?:(?:✅|☑)\uFE0F?|\[x\]|\(x\))/iu.test(value)
    || /\s*(?:\((?:done|completed|sent already|already sent)\)|\[(?:done|completed)\])\s*$/iu.test(value);
}

/** Removes the done markers so they do not end up in the title. */
function stripCompletionMarkers(value: string): string {
  return value
    .replace(/^\s*(?:(?:✅|☑)\uFE0F?|☐|\[[ x]\]|\(x\))\s*/iu, "")
    .replace(/\s*(?:\((?:done|completed|sent already|already sent)\)|\[(?:done|completed)\])\s*$/iu, "")
    .trim();
}

/**
 * Splits a trailing "(...)" off the item when it looks like an owner (a mention,
 * "owner:", a known member name, or a team name such as "design team").
 * Other brackets stay part of the title.
 */
function extractOwnerClause(value: string, memberAliases: MemberAliasMap): { taskText: string; ownerText?: string } {
  const match = value.match(/\s*\(([^()\n]{1,100})\)\s*$/u);
  if (!match?.[1]) return { taskText: value };
  const ownerText = match[1].trim();
  const ownershipLike = /@[A-Za-z0-9_]{3,32}\b/u.test(ownerText)
    || /^(?:owner|team|by|assigned to)\s*:/iu.test(ownerText)
    || membersFromOwnerClause(ownerText, memberAliases).length > 0
    || isTeamOwnerPhrase(ownerText);
  if (!ownershipLike) return { taskText: value };
  return { taskText: value.slice(0, match.index).trim(), ownerText };
}

/** True for team-like owner labels such as "comms" or "marketing team". */
function isTeamOwnerPhrase(value: string): boolean {
  const normalized = value.replace(/^(?:owner|team|by|assigned to)\s*:\s*/iu, "").trim();
  return /^(?:(?:internal|external|brand|project|product|growth|community|customer|people|web|mobile|group)\s+)*(?:comms|communications|ops|operations|design|engineering|marketing|finance|logistics|product|content|social|legal|sales|events?|committee|crew|squad|department|dept)(?:\s+team)?$/iu.test(normalized);
}

/**
 * Maps each member's username, full name and first name to that member. A name
 * shared by two members maps to null so it is never guessed.
 */
function buildMemberAliases(memberships: TaskImportMembership[]): MemberAliasMap {
  const aliases: MemberAliasMap = new Map();
  for (const member of memberships) {
    if (member.username) addMemberAlias(aliases, member.username, member);
    const displayName = memberDisplayName(member);
    if (displayName) addMemberAlias(aliases, displayName, member);
    if (member.firstName) addMemberAlias(aliases, member.firstName, member);
  }
  return aliases;
}

/** Adds one alias, marking it ambiguous (null) when it already points at someone else. */
function addMemberAlias(aliases: MemberAliasMap, label: string, member: TaskImportMembership): void {
  const key = normalizeMemberAlias(label);
  if (!key) return;
  const existing = aliases.get(key);
  if (existing && existing.telegramId !== member.telegramId) {
    aliases.set(key, null);
    return;
  }
  if (!aliases.has(key)) aliases.set(key, member);
}

/** Finds the group members named in an owner clause such as "Alex & Sam". */
function membersFromOwnerClause(ownerText: string | undefined, aliases: MemberAliasMap): TaskImportMembership[] {
  if (!ownerText) return [];
  const found: TaskImportMembership[] = [];
  const value = ownerText.replace(/^(?:owner|team|by|assigned to)\s*:\s*/iu, "");
  for (const segment of value.split(/\s*(?:&|,|;|\+|\band\b|\bwith\b)\s*/iu)) {
    const member = aliases.get(normalizeMemberAlias(segment));
    if (member && !found.some((item) => item.telegramId === member.telegramId)) found.push(member);
  }
  return found;
}

function normalizeMemberAlias(value: string): string {
  return value.replace(/^@/u, "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

/**
 * What is left of the owner clause after removing the people who became
 * assignees, kept as a free-text team owner label.
 */
function normalizeTeamOwner(ownerText: string | undefined, assignees: TaskImportAssignee[], memberAliases: MemberAliasMap): string | undefined {
  if (!ownerText) return undefined;
  const segments = ownerText
    .replace(/^(?:owner|team|by|assigned to)\s*:\s*/iu, "")
    .split(/\s*(?:&|,|;|\+|\band\b|\bwith\b)\s*/iu);
  const remaining: string[] = [];
  for (const segment of segments) {
    const member = memberAliases.get(normalizeMemberAlias(segment));
    if (member && assignees.some((assignee) => assignee.telegramId === member.telegramId)) continue;
    let value = segment.replace(/@[A-Za-z0-9_]{3,32}\b/gu, " ");
    for (const assignee of assignees) {
      for (const label of [assignee.displayName, assignee.username].filter(Boolean) as string[]) {
        value = value.replace(new RegExp(`\\b${escapeRegExp(label)}\\b`, "giu"), " ");
      }
    }
    value = value.replace(/\s+/g, " ").trim();
    if (value) remaining.push(value);
  }
  const value = remaining.join(" ").trim();
  return value && !/^(?:done|completed|sent already|already sent)$/iu.test(value) ? value.slice(0, 120) : undefined;
}

function memberDisplayName(member: { firstName: string | null; lastName: string | null }): string {
  return [member.firstName, member.lastName].filter(Boolean).join(" ").trim();
}

/**
 * Adds an assignee unless the same person is already listed, merging the extra
 * identity details into the existing entry.
 */
function addImportAssignee(list: TaskImportAssignee[], assignee: TaskImportAssignee): void {
  if (!assignee.telegramId && !assignee.username && !assignee.displayName) return;
  const username = assignee.username?.toLocaleLowerCase();
  const displayName = assignee.displayName?.toLocaleLowerCase();
  const existing = list.find((item) => {
    if (assignee.telegramId && item.telegramId === assignee.telegramId) return true;
    if (username && item.username?.toLocaleLowerCase() === username) {
      return !assignee.telegramId || !item.telegramId || assignee.telegramId === item.telegramId;
    }
    const itemHasStableIdentity = Boolean(item.telegramId || item.username);
    const assigneeHasStableIdentity = Boolean(assignee.telegramId || assignee.username);
    return !itemHasStableIdentity
      && !assigneeHasStableIdentity
      && Boolean(displayName && item.displayName?.toLocaleLowerCase() === displayName);
  });
  if (!existing) {
    list.push(assignee);
    return;
  }

  // The text scan may discover @username before Telegram's entity supplies the
  // same person's stable ID. Merge the richer identity instead of rendering
  // both discoveries as separate assignees.
  existing.telegramId ??= assignee.telegramId;
  existing.username ??= assignee.username;
  const existingUsesUsernameAsName = existing.displayName?.toLocaleLowerCase() === existing.username?.toLocaleLowerCase();
  if (!existing.displayName || (existingUsesUsernameAsName && assignee.displayName)) {
    existing.displayName = assignee.displayName;
  }
}

/** Reads the assignee JSON stored on a review row, ignoring malformed entries. */
function readAssignees(value: Prisma.JsonValue): TaskImportAssignee[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Prisma.JsonObject => Boolean(item && typeof item === "object" && !Array.isArray(item))).map((item) => ({
    ...(typeof item.telegramId === "string" ? { telegramId: item.telegramId } : {}),
    ...(typeof item.username === "string" ? { username: item.username } : {}),
    ...(typeof item.displayName === "string" ? { displayName: item.displayName } : {}),
  }));
}

/**
 * Review warnings shown next to a row: unassigned, an @user the bot has not seen
 * in this group (so cannot be linked), or "will be imported as completed".
 */
export function buildTaskImportWarnings(
  assignees: TaskImportAssignee[],
  teamOwnerLabel: string | null | undefined,
  status: TaskStatus,
): string[] {
  const warnings: string[] = [];
  if (assignees.length === 0 && !teamOwnerLabel?.trim()) warnings.push("Unassigned");
  for (const assignee of assignees) {
    if (assignee.username && !assignee.telegramId) warnings.push(`@${assignee.username} has not used Threadwise in this group yet`);
  }
  if (status === TaskStatus.DONE) warnings.push("Will be imported as completed");
  return [...new Set(warnings)];
}

/** Only the member who sent the list, or a group admin, may change or run the import. */
export function canControlTaskImport(requestedByTelegramId: string, actor: { telegramId: string; isManager: boolean }): boolean {
  return requestedByTelegramId === actor.telegramId || actor.isManager;
}

/**
 * True when a button press comes from the same chat as the import, so an import
 * cannot be driven from another chat.
 */
export function taskImportBelongsToChat(workspaceTelegramChatId: string, currentChatId: string | number | undefined): boolean {
  return currentChatId !== undefined && workspaceTelegramChatId === String(currentChatId);
}

function assertImportControl(taskImport: TaskImportReview, actor: { telegramId: string; isManager: boolean }): void {
  if (!canControlTaskImport(taskImport.requestedByTelegramId, actor)) {
    throw new TaskImportError("Only the sender or a group administrator can change this import.", "forbidden");
  }
}

/** Throws unless the review is still pending or partly imported. */
function assertReviewEditable(taskImport: TaskImportReview): void {
  if (taskImport.status === TaskImportStatus.EXPIRED) throw new TaskImportError("This review expired. Send the TODO list again.", "expired");
  if (taskImport.status !== TaskImportStatus.PENDING && taskImport.status !== TaskImportStatus.PARTIAL) {
    throw new TaskImportError("This import can no longer be edited.", "conflict");
  }
}

/** Imported, failed and skipped row counts for the result message. */
function importCounts(taskImport: TaskImportReview) {
  return {
    taskImport,
    imported: taskImport.items.filter((item) => item.status === TaskImportItemStatus.IMPORTED).length,
    failed: taskImport.items.filter((item) => item.included && item.status === TaskImportItemStatus.FAILED).length,
    skipped: taskImport.items.filter((item) => !item.included || item.status === TaskImportItemStatus.SKIPPED).length,
  };
}

/**
 * Shows the original error only when it is a known validation message; anything
 * else becomes a generic message so internal errors are not shown to users.
 */
function importFailureMessage(error: unknown): string {
  if (error instanceof Error && /title|date|task|assignee/i.test(error.message)) return error.message.slice(0, 240);
  return "This row could not be imported. Review it and try again.";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const reviewInclude = {
  items: { orderBy: { position: "asc" as const } },
  workspace: { select: { title: true, telegramChatId: true } },
} satisfies Prisma.PendingTaskImportInclude;
