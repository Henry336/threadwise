import crypto from "crypto";
import {
  AvailabilityPollStatus,
  GroupActivityType,
  GroupMemberStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { DateTime, IANAZone } from "luxon";
import { prisma } from "../db/prisma";
import { removeMeetingFromGoogleCalendar, syncMeetingToGoogleCalendar } from "./googleCalendar";

const MAX_POLL_DAYS = 14;
const REMINDER_COOLDOWN_MS = 15 * 60_000;
const PUBLIC_ID_ATTEMPTS = 5;

const pollInclude = {
  responses: { orderBy: { updatedAt: "asc" as const } },
  calendarEvents: true,
  workspace: {
    include: {
      members: {
        where: { status: GroupMemberStatus.ACTIVE },
        orderBy: { lastSeenAt: "desc" as const },
      },
    },
  },
} satisfies Prisma.AvailabilityPollInclude;

type PollRecord = Prisma.AvailabilityPollGetPayload<{ include: typeof pollInclude }>;

export type SchedulingActor = {
  telegramId: string;
  displayName: string;
};

export type SchedulingScope = {
  workspaceId: string;
  ownerTelegramId: string;
  telegramChatId: string;
  viewerTelegramId: string;
  viewerRole: "OWNER" | "ADMIN" | "MEMBER";
};

export type AvailabilityPollInput = {
  title: string;
  startDate: string;
  endDate: string;
  timezone: string;
  durationMinutes: number;
  dayStartMinutes?: number;
  dayEndMinutes?: number;
  slotMinutes?: number;
};

export type AvailabilitySlotScore = {
  startAt: string;
  endAt: string;
  availableCount: number;
};

export type AvailabilityPollView = {
  id: string;
  publicId: string;
  title: string;
  status: "OPEN" | "FINALIZED" | "CANCELED";
  startDate: string;
  endDate: string;
  timezone: string;
  durationMinutes: number;
  dayStartMinutes: number;
  dayEndMinutes: number;
  slotMinutes: number;
  revision: number;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  telegramMessageId?: string;
  slots: string[];
  bestSlots: AvailabilitySlotScore[];
  respondentCount: number;
  memberCount: number;
  respondents: Array<{ telegramId: string; displayName: string }>;
  pendingMembers: Array<{ telegramId: string; displayName: string; username?: string }>;
  viewerResponse?: { timezone: string; availableStarts: string[]; wantsCalendar: boolean };
  finalStartAt?: string;
  finalEndAt?: string;
  finalizedAt?: string;
  viewerCalendar?: { connected: boolean; synced: boolean; eventUrl?: string };
};

export class GroupSchedulingError extends Error {
  constructor(
    public readonly code: "not_found" | "invalid" | "conflict" | "forbidden" | "not_connected" | "cooldown",
    message: string,
  ) {
    super(message);
    this.name = "GroupSchedulingError";
  }
}

export function validateAvailabilityPollInput(input: AvailabilityPollInput): Required<AvailabilityPollInput> {
  const title = input.title.replace(/\s+/g, " ").trim();
  if (!title || title.length > 160) throw new GroupSchedulingError("invalid", "Use a meeting title between 1 and 160 characters.");
  if (!IANAZone.isValidZone(input.timezone)) throw new GroupSchedulingError("invalid", "Choose a valid time zone.");
  const start = DateTime.fromISO(input.startDate, { zone: input.timezone }).startOf("day");
  const end = DateTime.fromISO(input.endDate, { zone: input.timezone }).startOf("day");
  if (!start.isValid || !end.isValid || end < start) throw new GroupSchedulingError("invalid", "Choose a valid date range.");
  if (Math.floor(end.diff(start, "days").days) + 1 > MAX_POLL_DAYS) {
    throw new GroupSchedulingError("invalid", `Keep availability polls to ${MAX_POLL_DAYS} days or fewer.`);
  }
  const durationMinutes = Math.round(input.durationMinutes);
  const slotMinutes = Math.round(input.slotMinutes ?? 30);
  const dayStartMinutes = Math.round(input.dayStartMinutes ?? 8 * 60);
  const dayEndMinutes = Math.round(input.dayEndMinutes ?? 22 * 60);
  if (durationMinutes < 15 || durationMinutes > 240 || durationMinutes % 15 !== 0) {
    throw new GroupSchedulingError("invalid", "Meeting duration must be 15 to 240 minutes, in 15-minute steps.");
  }
  if (![15, 30, 60].includes(slotMinutes) || durationMinutes % slotMinutes !== 0) {
    throw new GroupSchedulingError("invalid", "Choose 15, 30, or 60-minute availability cells that divide the meeting duration.");
  }
  if (dayStartMinutes < 0 || dayEndMinutes > 24 * 60 || dayEndMinutes - dayStartMinutes < durationMinutes) {
    throw new GroupSchedulingError("invalid", "The daily time window is too short for this meeting.");
  }
  return { title, startDate: start.toISODate()!, endDate: end.toISODate()!, timezone: input.timezone, durationMinutes, dayStartMinutes, dayEndMinutes, slotMinutes };
}

export function generateAvailabilitySlots(input: Pick<Required<AvailabilityPollInput>, "startDate" | "endDate" | "timezone" | "durationMinutes" | "dayStartMinutes" | "dayEndMinutes" | "slotMinutes">): Date[] {
  const start = DateTime.fromISO(input.startDate, { zone: input.timezone }).startOf("day");
  const end = DateTime.fromISO(input.endDate, { zone: input.timezone }).startOf("day");
  if (!start.isValid || !end.isValid || end < start || !IANAZone.isValidZone(input.timezone)) return [];
  const slots: Date[] = [];
  for (let day = start; day <= end && slots.length < 2_000; day = day.plus({ days: 1 })) {
    for (let minute = input.dayStartMinutes; minute + input.slotMinutes <= input.dayEndMinutes; minute += input.slotMinutes) {
      const local = day.plus({ minutes: minute });
      if (local.isValid) slots.push(local.toUTC().toJSDate());
    }
  }
  return slots;
}

export function rankAvailabilitySlots(
  slots: Date[],
  responses: Array<{ availableStarts: Date[] }>,
  durationMinutes: number,
  slotMinutes: number,
  timezone: string,
): AvailabilitySlotScore[] {
  const cellsRequired = Math.max(1, durationMinutes / slotMinutes);
  const allSlots = new Set(slots.map((slot) => slot.getTime()));
  const responseSets = responses.map((response) => new Set(response.availableStarts.map((date) => date.getTime())));
  return slots.filter((slot) => {
    const endTime = slot.getTime() + durationMinutes * 60_000;
    const startDay = DateTime.fromJSDate(slot, { zone: timezone }).toISODate();
    const endDay = DateTime.fromMillis(endTime - 1, { zone: timezone }).toISODate();
    if (startDay !== endDay) return false;
    for (let index = 0; index < cellsRequired; index += 1) {
      if (!allSlots.has(slot.getTime() + index * slotMinutes * 60_000)) return false;
    }
    return true;
  }).map((slot) => {
    const startMs = slot.getTime();
    const availableCount = responseSets.reduce((count, set) => {
      for (let index = 0; index < cellsRequired; index += 1) {
        if (!set.has(startMs + index * slotMinutes * 60_000)) return count;
      }
      return count + 1;
    }, 0);
    return {
      startAt: slot.toISOString(),
      endAt: new Date(startMs + durationMinutes * 60_000).toISOString(),
      availableCount,
    };
  }).sort((left, right) => right.availableCount - left.availableCount || left.startAt.localeCompare(right.startAt));
}

export function parseFindTimeRequest(text: string, timezone: string, now = new Date()): AvailabilityPollInput {
  const clean = text.replace(/^\s*(?:\/findtime|\/schedule|find\s+a\s+time(?:\s+for)?|when\s+can\s+we)\s*/i, "").trim();
  const localNow = DateTime.fromJSDate(now).setZone(timezone);
  let start = localNow.plus({ days: 1 }).startOf("day");
  let end = start.plus({ days: 6 });
  if (/\bnext\s+week\b/i.test(text)) {
    start = localNow.plus({ weeks: 1 }).startOf("week");
    end = start.plus({ days: 6 });
  } else if (/\bthis\s+week\b/i.test(text)) {
    start = localNow.startOf("day");
    end = localNow.endOf("week").startOf("day");
  } else if (/\bweekend\b/i.test(text)) {
    const daysUntilSaturday = (6 - localNow.weekday + 7) % 7 || 7;
    start = localNow.plus({ days: daysUntilSaturday }).startOf("day");
    end = start.plus({ days: 1 });
  } else if (/\btomorrow\b/i.test(text)) {
    start = localNow.plus({ days: 1 }).startOf("day");
    end = start;
  }
  const isoDates = [...text.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)].map((match) => match[1]!);
  if (isoDates[0]) start = DateTime.fromISO(isoDates[0], { zone: timezone }).startOf("day");
  if (isoDates[1]) end = DateTime.fromISO(isoDates[1], { zone: timezone }).startOf("day");
  else if (isoDates[0]) end = start;
  const days = text.match(/\bnext\s+(\d{1,2})\s+days?\b/i);
  if (days) {
    start = localNow.plus({ days: 1 }).startOf("day");
    end = start.plus({ days: Math.min(MAX_POLL_DAYS, Number(days[1])) - 1 });
  }
  let durationMinutes = 60;
  const minutes = text.match(/\b(15|30|45|60|90|120|180|240)\s*(?:minutes?|mins?)\b/i);
  const hours = text.match(/\b(\d(?:\.5)?)\s*(?:hours?|hrs?)\b/i);
  if (minutes) durationMinutes = Number(minutes[1]);
  else if (hours) durationMinutes = Math.round(Number(hours[1]) * 60);
  let title = clean
    .replace(/\b(?:next|this)\s+week\b|\bweekend\b|\btomorrow\b|\bnext\s+\d{1,2}\s+days?\b/gi, "")
    .replace(/\b20\d{2}-\d{2}-\d{2}\b/g, "")
    .replace(/\b(?:15|30|45|60|90|120|180|240)\s*(?:minutes?|mins?)\b/gi, "")
    .replace(/\b\d(?:\.5)?\s*(?:hours?|hrs?)\b/gi, "")
    .replace(/\b(?:for|during|on|from|between)\b\s*$/i, "")
    .replace(/\s+/g, " ").trim();
  title = title.replace(/^(?:a|an|the)\s+/i, "");
  if (!title) title = "Group meeting";
  return validateAvailabilityPollInput({ title, startDate: start.toISODate()!, endDate: end.toISODate()!, timezone, durationMinutes });
}

export function isFindTimeIntent(text: string): boolean {
  return /(?:^|\b)(?:find\s+a\s+time|availability\s+poll|when\s+can\s+we|what\s+time\s+works\s+for\s+everyone)(?:\b|$)/i.test(text);
}

export async function createAvailabilityPoll(scope: SchedulingScope, actor: SchedulingActor, rawInput: AvailabilityPollInput, database: PrismaClient = prisma): Promise<AvailabilityPollView> {
  assertGroupScope(scope);
  const input = validateAvailabilityPollInput(rawInput);
  for (let attempt = 0; attempt < PUBLIC_ID_ATTEMPTS; attempt += 1) {
    const publicId = `TIME-${crypto.randomBytes(4).toString("hex").slice(0, 6).toUpperCase()}`;
    try {
      const poll = await database.$transaction(async (tx) => {
        const created = await tx.availabilityPoll.create({ data: { workspaceId: scope.workspaceId, publicId, createdByTelegramId: actor.telegramId, createdByName: actor.displayName, ...input }, include: pollInclude });
        await tx.groupActivity.create({ data: { workspaceId: scope.workspaceId, actorTelegramId: actor.telegramId, actorName: actor.displayName, type: GroupActivityType.SCHEDULE_CREATED, summary: `${actor.displayName} started ${publicId}: ${input.title}.`, metadata: { pollId: created.id, publicId } } });
        return created;
      });
      return serializePoll(poll, scope.viewerTelegramId, await viewerCalendarConnected(scope.viewerTelegramId, database));
    } catch (error) {
      if (attempt + 1 >= PUBLIC_ID_ATTEMPTS || !isUniqueConflict(error)) throw error;
    }
  }
  throw new GroupSchedulingError("conflict", "Could not allocate a poll ID. Try again.");
}

export async function resolveSchedulingActor(scope: SchedulingScope, database: PrismaClient = prisma): Promise<SchedulingActor> {
  const member = await database.groupMembership.findUnique({
    where: { workspaceId_telegramId: { workspaceId: scope.workspaceId, telegramId: scope.viewerTelegramId } },
  });
  if (!member || member.status !== GroupMemberStatus.ACTIVE) throw new GroupSchedulingError("forbidden", "Threadwise could not verify your active group membership.");
  return { telegramId: member.telegramId, displayName: memberDisplayName(member) };
}

export async function listAvailabilityPolls(scope: SchedulingScope, database: PrismaClient = prisma): Promise<AvailabilityPollView[]> {
  assertGroupScope(scope);
  const [polls, calendarConnected] = await Promise.all([
    database.availabilityPoll.findMany({ where: { workspaceId: scope.workspaceId }, include: pollInclude, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 50 }),
    viewerCalendarConnected(scope.viewerTelegramId, database),
  ]);
  return polls.map((poll) => serializePoll(poll, scope.viewerTelegramId, calendarConnected));
}

export async function getAvailabilityPoll(scope: SchedulingScope, reference: string, database: PrismaClient = prisma): Promise<AvailabilityPollView> {
  const [poll, calendarConnected] = await Promise.all([
    findPoll(scope.workspaceId, reference, database),
    viewerCalendarConnected(scope.viewerTelegramId, database),
  ]);
  return serializePoll(poll, scope.viewerTelegramId, calendarConnected);
}

export async function submitAvailability(
  scope: SchedulingScope,
  reference: string,
  input: { timezone: string; availableStarts: string[]; wantsCalendar?: boolean },
  database: PrismaClient = prisma,
): Promise<AvailabilityPollView> {
  assertGroupScope(scope);
  if (!IANAZone.isValidZone(input.timezone)) throw new GroupSchedulingError("invalid", "Choose a valid time zone.");
  const current = await findPoll(scope.workspaceId, reference, database);
  if (current.status !== AvailabilityPollStatus.OPEN) throw new GroupSchedulingError("conflict", "This availability poll is already closed.");
  const allowed = new Set(slotDates(current).map((date) => date.getTime()));
  const selected = [...new Set(input.availableStarts.map((value) => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()) || !allowed.has(date.getTime())) throw new GroupSchedulingError("invalid", "One or more selected times are outside this poll.");
    return date.getTime();
  }))].sort((a, b) => a - b).map((time) => new Date(time));
  const existing = current.responses.find((response) => response.telegramId === scope.viewerTelegramId);
  const wantsCalendar = input.wantsCalendar ?? existing?.wantsCalendar ?? false;
  if (existing && existing.timezone === input.timezone && existing.wantsCalendar === wantsCalendar && sameDates(existing.availableStarts, selected)) {
    return serializePoll(current, scope.viewerTelegramId, await viewerCalendarConnected(scope.viewerTelegramId, database));
  }
  await database.$transaction(async (tx) => {
    const changed = await tx.availabilityPoll.updateMany({ where: { id: current.id, status: AvailabilityPollStatus.OPEN }, data: { revision: { increment: 1 }, updatedAt: new Date() } });
    if (changed.count !== 1) throw new GroupSchedulingError("conflict", "This poll changed while you were responding. Refresh it and try again.");
    await tx.availabilityResponse.upsert({
      where: { pollId_telegramId: { pollId: current.id, telegramId: scope.viewerTelegramId } },
      update: { timezone: input.timezone, availableStarts: selected, wantsCalendar, respondedAt: new Date() },
      create: { pollId: current.id, telegramId: scope.viewerTelegramId, timezone: input.timezone, availableStarts: selected, wantsCalendar },
    });
  });
  return getAvailabilityPoll(scope, current.id, database);
}

export async function finalizeAvailabilityPoll(scope: SchedulingScope, actor: SchedulingActor, reference: string, startAt: string, expectedRevision: number, database: PrismaClient = prisma): Promise<AvailabilityPollView> {
  const current = await findPoll(scope.workspaceId, reference, database);
  const chosen = new Date(startAt);
  const ranking = rankAvailabilitySlots(slotDates(current), activeResponses(current), current.durationMinutes, current.slotMinutes, current.timezone);
  const candidate = ranking.find((slot) => new Date(slot.startAt).getTime() === chosen.getTime());
  if (!candidate || candidate.availableCount < 1) throw new GroupSchedulingError("invalid", "Choose a time that at least one member marked available.");
  const finalEndAt = new Date(chosen.getTime() + current.durationMinutes * 60_000);
  await database.$transaction(async (tx) => {
    const changed = await tx.availabilityPoll.updateMany({ where: { id: current.id, status: AvailabilityPollStatus.OPEN, revision: expectedRevision }, data: { status: AvailabilityPollStatus.FINALIZED, finalStartAt: chosen, finalEndAt, finalizedByTelegramId: actor.telegramId, finalizedAt: new Date(), revision: { increment: 1 } } });
    if (changed.count !== 1) throw new GroupSchedulingError("conflict", "This poll changed. Refresh before finalizing it.");
    await tx.groupActivity.create({ data: { workspaceId: scope.workspaceId, actorTelegramId: actor.telegramId, actorName: actor.displayName, type: GroupActivityType.SCHEDULE_FINALIZED, summary: `${actor.displayName} finalized ${current.publicId}: ${current.title}.`, metadata: { pollId: current.id, publicId: current.publicId, startAt: chosen.toISOString() } } });
  });
  const view = await getAvailabilityPoll(scope, current.id, database);
  await syncOptedInCalendars(view, database);
  return getAvailabilityPoll(scope, current.id, database);
}

export async function cancelAvailabilityPoll(scope: SchedulingScope, actor: SchedulingActor, reference: string, expectedRevision: number, database: PrismaClient = prisma): Promise<AvailabilityPollView> {
  const current = await findPoll(scope.workspaceId, reference, database);
  await database.$transaction(async (tx) => {
    const changed = await tx.availabilityPoll.updateMany({ where: { id: current.id, status: AvailabilityPollStatus.OPEN, revision: expectedRevision }, data: { status: AvailabilityPollStatus.CANCELED, revision: { increment: 1 } } });
    if (changed.count !== 1) throw new GroupSchedulingError("conflict", "This poll changed. Refresh before closing it.");
    await tx.groupActivity.create({ data: { workspaceId: scope.workspaceId, actorTelegramId: actor.telegramId, actorName: actor.displayName, type: GroupActivityType.SCHEDULE_CANCELED, summary: `${actor.displayName} closed ${current.publicId}: ${current.title}.`, metadata: { pollId: current.id, publicId: current.publicId } } });
  });
  return getAvailabilityPoll(scope, current.id, database);
}

export async function prepareAvailabilityReminder(scope: SchedulingScope, reference: string, database: PrismaClient = prisma): Promise<{ poll: AvailabilityPollView; pendingMembers: AvailabilityPollView["pendingMembers"]; reservationAt?: Date }> {
  const current = await findPoll(scope.workspaceId, reference, database);
  if (current.status !== AvailabilityPollStatus.OPEN) throw new GroupSchedulingError("conflict", "This availability poll is already closed.");
  const currentView = await getAvailabilityPoll(scope, current.id, database);
  if (currentView.pendingMembers.length === 0) return { poll: currentView, pendingMembers: [] };
  const threshold = new Date(Date.now() - REMINDER_COOLDOWN_MS);
  const reservationAt = new Date();
  const changed = await database.availabilityPoll.updateMany({ where: { id: current.id, status: AvailabilityPollStatus.OPEN, OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: threshold } }] }, data: { lastReminderAt: reservationAt } });
  if (changed.count !== 1) throw new GroupSchedulingError("cooldown", "A reminder was sent recently. Try again in a few minutes.");
  const poll = await getAvailabilityPoll(scope, current.id, database);
  return { poll, pendingMembers: poll.pendingMembers, reservationAt };
}

export async function releaseAvailabilityReminderReservation(scope: SchedulingScope, reference: string, reservationAt: Date | undefined, database: PrismaClient = prisma): Promise<void> {
  if (!reservationAt) return;
  const current = await findPoll(scope.workspaceId, reference, database);
  await database.availabilityPoll.updateMany({
    where: { id: current.id, lastReminderAt: reservationAt },
    data: { lastReminderAt: null },
  });
}

export async function setAvailabilityTelegramMessage(scope: SchedulingScope, reference: string, messageId: string, database: PrismaClient = prisma): Promise<void> {
  const current = await findPoll(scope.workspaceId, reference, database);
  await database.availabilityPoll.update({ where: { id: current.id }, data: { telegramMessageId: messageId } });
}

export async function updateAvailabilityCalendar(scope: SchedulingScope, reference: string, action: "sync" | "remove", database: PrismaClient = prisma): Promise<AvailabilityPollView> {
  const poll = await findPoll(scope.workspaceId, reference, database);
  if (poll.status !== AvailabilityPollStatus.FINALIZED || !poll.finalStartAt || !poll.finalEndAt) throw new GroupSchedulingError("conflict", "Finalize the meeting before adding it to Calendar.");
  const user = await database.user.findUnique({ where: { telegramId: scope.viewerTelegramId }, include: { calendarConnection: true } });
  if (!user?.calendarConnection) throw new GroupSchedulingError("not_connected", "Connect Google Calendar from your Personal workspace first.");
  const existing = poll.calendarEvents.find((event) => event.telegramId === scope.viewerTelegramId);
  if (action === "remove") {
    if (existing) {
      await removeMeetingFromGoogleCalendar(user.id, existing.eventId);
      await database.availabilityCalendarEvent.delete({ where: { id: existing.id } });
    }
  } else {
    const result = await syncMeetingToGoogleCalendar(user.id, meetingInput(poll), existing?.eventId);
    if (!result) throw new GroupSchedulingError("not_connected", "Connect Google Calendar from your Personal workspace first.");
    await database.availabilityCalendarEvent.upsert({ where: { pollId_telegramId: { pollId: poll.id, telegramId: scope.viewerTelegramId } }, update: { userId: user.id, eventId: result.eventId, eventUrl: result.eventUrl, syncedAt: new Date() }, create: { pollId: poll.id, userId: user.id, telegramId: scope.viewerTelegramId, eventId: result.eventId, eventUrl: result.eventUrl } });
  }
  await database.availabilityPoll.update({ where: { id: poll.id }, data: { revision: { increment: 1 }, updatedAt: new Date() } });
  return getAvailabilityPoll(scope, poll.id, database);
}

async function syncOptedInCalendars(view: AvailabilityPollView, database: PrismaClient): Promise<void> {
  if (!view.finalStartAt || !view.finalEndAt) return;
  const poll = await database.availabilityPoll.findUnique({ where: { id: view.id }, include: pollInclude });
  if (!poll) return;
  for (const response of activeResponses(poll).filter((item) => item.wantsCalendar)) {
    const user = await database.user.findUnique({ where: { telegramId: response.telegramId }, include: { calendarConnection: true } });
    if (!user?.calendarConnection) continue;
    const existing = poll.calendarEvents.find((event) => event.telegramId === response.telegramId);
    try {
      const synced = await syncMeetingToGoogleCalendar(user.id, meetingInput(poll), existing?.eventId);
      if (!synced) continue;
      await database.availabilityCalendarEvent.upsert({ where: { pollId_telegramId: { pollId: poll.id, telegramId: response.telegramId } }, update: { userId: user.id, eventId: synced.eventId, eventUrl: synced.eventUrl, syncedAt: new Date() }, create: { pollId: poll.id, userId: user.id, telegramId: response.telegramId, eventId: synced.eventId, eventUrl: synced.eventUrl } });
    } catch {
      // Calendar sync is optional and must never block finalising the group decision.
    }
  }
}

function serializePoll(poll: PollRecord, viewerTelegramId: string, calendarConnected: boolean): AvailabilityPollView {
  const responses = activeResponses(poll);
  const responseIds = new Set(responses.map((response) => response.telegramId));
  const display = new Map(poll.workspace.members.map((member) => [member.telegramId, memberDisplayName(member)]));
  const viewerResponse = responses.find((response) => response.telegramId === viewerTelegramId);
  const event = poll.calendarEvents.find((item) => item.telegramId === viewerTelegramId);
  const slots = slotDates(poll);
  return {
    id: poll.id,
    publicId: poll.publicId,
    title: poll.title,
    status: poll.status,
    startDate: poll.startDate,
    endDate: poll.endDate,
    timezone: poll.timezone,
    durationMinutes: poll.durationMinutes,
    dayStartMinutes: poll.dayStartMinutes,
    dayEndMinutes: poll.dayEndMinutes,
    slotMinutes: poll.slotMinutes,
    revision: poll.revision,
    createdByName: poll.createdByName,
    createdAt: poll.createdAt.toISOString(),
    updatedAt: poll.updatedAt.toISOString(),
    ...(poll.telegramMessageId ? { telegramMessageId: poll.telegramMessageId } : {}),
    slots: slots.map((date) => date.toISOString()),
    bestSlots: rankAvailabilitySlots(slots, responses, poll.durationMinutes, poll.slotMinutes, poll.timezone).slice(0, 12),
    respondentCount: responses.length,
    memberCount: poll.workspace.members.length,
    respondents: responses.map((response) => ({ telegramId: response.telegramId, displayName: display.get(response.telegramId) ?? "Group member" })),
    pendingMembers: poll.workspace.members.filter((member) => !responseIds.has(member.telegramId)).map((member) => ({ telegramId: member.telegramId, displayName: memberDisplayName(member), ...(member.username ? { username: member.username } : {}) })),
    ...(viewerResponse ? { viewerResponse: { timezone: viewerResponse.timezone, availableStarts: viewerResponse.availableStarts.map((date) => date.toISOString()), wantsCalendar: viewerResponse.wantsCalendar } } : {}),
    ...(poll.finalStartAt ? { finalStartAt: poll.finalStartAt.toISOString() } : {}),
    ...(poll.finalEndAt ? { finalEndAt: poll.finalEndAt.toISOString() } : {}),
    ...(poll.finalizedAt ? { finalizedAt: poll.finalizedAt.toISOString() } : {}),
    viewerCalendar: { connected: calendarConnected, synced: Boolean(event), ...(event?.eventUrl ? { eventUrl: event.eventUrl } : {}) },
  };
}

async function viewerCalendarConnected(telegramId: string, database: PrismaClient): Promise<boolean> {
  const personal = await database.user.findUnique({ where: { telegramId }, select: { calendarConnection: { select: { id: true } } } });
  return Boolean(personal?.calendarConnection);
}

async function findPoll(workspaceId: string, reference: string, database: PrismaClient): Promise<PollRecord> {
  const poll = await database.availabilityPoll.findFirst({ where: { workspaceId, OR: [{ id: reference }, { publicId: reference.toUpperCase() }] }, include: pollInclude });
  if (!poll) throw new GroupSchedulingError("not_found", "I could not find that availability poll.");
  return poll;
}

function slotDates(poll: Pick<PollRecord, "startDate" | "endDate" | "timezone" | "durationMinutes" | "dayStartMinutes" | "dayEndMinutes" | "slotMinutes">): Date[] {
  return generateAvailabilitySlots(poll);
}

function activeResponses(poll: PollRecord) {
  const active = new Set(poll.workspace.members.map((member) => member.telegramId));
  return poll.responses.filter((response) => active.has(response.telegramId));
}

function memberDisplayName(member: { firstName: string | null; lastName: string | null; username: string | null }): string {
  return [member.firstName, member.lastName].filter(Boolean).join(" ") || (member.username ? `@${member.username}` : "Group member");
}

function meetingInput(poll: Pick<PollRecord, "title" | "publicId" | "finalStartAt" | "finalEndAt" | "timezone">) {
  if (!poll.finalStartAt || !poll.finalEndAt) throw new GroupSchedulingError("conflict", "Finalize the meeting first.");
  return { title: poll.title, details: `Finalized with Threadwise (${poll.publicId}).`, startAt: poll.finalStartAt, endAt: poll.finalEndAt, timezone: poll.timezone };
}

function assertGroupScope(scope: SchedulingScope): void {
  if (!scope.workspaceId || !scope.telegramChatId) throw new GroupSchedulingError("forbidden", "Find a time is available in group workspaces.");
}

function sameDates(left: Date[], right: Date[]): boolean {
  return left.length === right.length && left.every((date, index) => date.getTime() === right[index]?.getTime());
}

function isUniqueConflict(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: string }).code === "P2002");
}
