import type { StudyLocationOrigin, StudyWorkspace } from "@prisma/client";
import { DateTime } from "luxon";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { logger } from "../logger";
import { academicWeekNumber } from "./study";
import {
  addStudyOriginFromVenue,
  currentStudyOrigin,
  estimateStudyJourneyByStops,
  resolveStudyVenue,
} from "./studyTransit";

const TEST_PREFIX = "[TEST TODAY]";
const TEST_DESTINATION = "COM3";
const TEST_ORIGIN_NAME = "[TEST] PGP origin";

export type StudySmokeSeedResult = {
  date: string;
  studyBlock: { id: string; startsAt: Date; reminderAt: Date };
  classBlock: { id: string; startsAt: Date; estimatedLeaveAt: Date };
  route: { origin: string; destination: string; services: string[]; totalMinutes: number };
};

/**
 * Seeds two idempotent, Week-scoped Study blocks only when Render explicitly
 * requests today's local date. The rows cannot recur in later academic weeks.
 * A later restart on another date archives them automatically.
 */
export async function seedStudySmokeTestIfRequested(now = new Date()): Promise<StudySmokeSeedResult | undefined> {
  const requestedDate = env.STUDY_SMOKE_TEST_DATE;
  if (!requestedDate) return undefined;

  try {
    const workspace = await prisma.studyWorkspace.findUnique({
      where: { ownerTelegramId: env.STUDY_OWNER_TELEGRAM_ID ?? "" },
    });
    if (!workspace?.active || !workspace.boundChatId) {
      logger.warn("Study smoke seed skipped because the private workspace is not active and bound.");
      return undefined;
    }

    const localNow = DateTime.fromJSDate(now).setZone(workspace.timezone);
    const localDate = localNow.toISODate();
    if (!localDate) return undefined;
    if (localDate !== requestedDate) {
      if (localDate > requestedDate) {
        const archived = await prisma.studyScheduleBlock.updateMany({
          where: { workspaceId: workspace.id, active: true, label: { startsWith: TEST_PREFIX } },
          data: { active: false },
        });
        logger.info("Expired Study smoke blocks archived.", { requestedDate, archived: archived.count });
      }
      return undefined;
    }

    const weekNumber = academicWeekNumber(workspace, now);
    if (weekNumber < 1) {
      logger.warn("Study smoke seed skipped because the semester has not started.", { requestedDate });
      return undefined;
    }

    const module = await prisma.studyModule.findFirst({
      where: { workspaceId: workspace.id, active: true },
      orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
    });
    if (!module) {
      logger.warn("Study smoke seed skipped because no active Study module exists.");
      return undefined;
    }

    const origin = await requireSmokeOrigin(workspace, now);
    const venue = await resolveStudyVenue(TEST_DESTINATION);
    const destinationStop = venue.nearbyStops[0];
    if (!destinationStop) {
      logger.warn("Study smoke seed skipped because COM3 has no routable NUS stop.");
      return undefined;
    }
    const journey = await estimateStudyJourneyByStops(workspace, destinationStop.id, origin.id);
    const routeMinutes = Math.max(1, journey.totalMinutes ?? 30);

    const seedClock = localNow.startOf("minute");
    const studyStarts = seedClock.plus({ minutes: 7 });
    const studyReminderLeadMinutes = 3;
    const travelBufferMinutes = 5;
    // Route length + buffer + six minutes means the live departure candidate
    // becomes eligible soon after deployment, regardless of route length.
    const classStarts = seedClock.plus({ minutes: routeMinutes + travelBufferMinutes + 6 });

    const studyLabel = `${TEST_PREFIX} Study-block reminder check · ${requestedDate}`;
    const classLabel = `${TEST_PREFIX} COM3 class & route check · ${requestedDate}`;
    const studyBlock = await createSmokeBlockOnce({
      workspace,
      label: studyLabel,
      moduleId: module.id,
      start: studyStarts,
      end: studyStarts.plus({ minutes: 30 }),
      weekNumber,
      blockType: "study",
      reminderLeadMinutes: studyReminderLeadMinutes,
    });
    const classBlock = await createSmokeBlockOnce({
      workspace,
      label: classLabel,
      moduleId: module.id,
      start: classStarts,
      end: classStarts.plus({ minutes: 50 }),
      weekNumber,
      blockType: "timetable",
      reminderLeadMinutes: 10,
      venueId: venue.id,
      venueName: venue.name,
      destinationStopId: destinationStop.id,
      defaultOriginId: origin.id,
      travelBufferMinutes,
    });

    if (!workspace.studyBlockRemindersEnabled) {
      await prisma.studyWorkspace.update({
        where: { id: workspace.id },
        data: { studyBlockRemindersEnabled: true },
      });
    }

    const result: StudySmokeSeedResult = {
      date: requestedDate,
      studyBlock: {
        id: studyBlock.id,
        startsAt: studyStarts.toUTC().toJSDate(),
        reminderAt: studyStarts.minus({ minutes: studyReminderLeadMinutes }).toUTC().toJSDate(),
      },
      classBlock: {
        id: classBlock.id,
        startsAt: classStarts.toUTC().toJSDate(),
        estimatedLeaveAt: classStarts.minus({ minutes: routeMinutes + travelBufferMinutes }).toUTC().toJSDate(),
      },
      route: {
        origin: origin.name,
        destination: venue.name,
        services: journey.services,
        totalMinutes: routeMinutes,
      },
    };
    logger.info("Today's Study smoke test was seeded.", result);
    return result;
  } catch (error) {
    // A smoke seed must never take down the live bot. The regular service starts
    // normally and Render logs retain a credential-free diagnostic.
    logger.error("Study smoke seed failed without interrupting startup.", { error: String(error) });
    return undefined;
  }
}

async function requireSmokeOrigin(workspace: StudyWorkspace, now: Date): Promise<StudyLocationOrigin> {
  const current = await currentStudyOrigin(workspace, now);
  if (current?.providerStopId) return current;
  const routable = await prisma.studyLocationOrigin.findFirst({
    where: { workspaceId: workspace.id, active: true, providerStopId: { not: null } },
    orderBy: [{ isDefault: "desc" }, { displayOrder: "asc" }, { createdAt: "asc" }],
  });
  if (routable) return routable;
  return addStudyOriginFromVenue(workspace, TEST_ORIGIN_NAME, "PGPR", { activateHours: 12 });
}

async function createSmokeBlockOnce(input: {
  workspace: StudyWorkspace;
  label: string;
  moduleId: string;
  start: DateTime;
  end: DateTime;
  weekNumber: number;
  blockType: string;
  reminderLeadMinutes: number;
  venueId?: string;
  venueName?: string;
  destinationStopId?: string;
  defaultOriginId?: string;
  travelBufferMinutes?: number;
}) {
  const existing = await prisma.studyScheduleBlock.findFirst({
    where: { workspaceId: input.workspace.id, label: input.label },
  });
  if (existing) return existing;
  return prisma.studyScheduleBlock.create({
    data: {
      workspaceId: input.workspace.id,
      moduleId: input.moduleId,
      dayOfWeek: input.start.weekday,
      startTime: input.start.toFormat("HH:mm"),
      endTime: input.end.toFormat("HH:mm"),
      startWeek: input.weekNumber,
      endWeek: input.weekNumber,
      label: input.label,
      blockType: input.blockType,
      reminderLeadMinutes: input.reminderLeadMinutes,
      venueId: input.venueId,
      venueName: input.venueName,
      destinationStopId: input.destinationStopId,
      defaultOriginId: input.defaultOriginId,
      travelBufferMinutes: input.travelBufferMinutes,
      preparation: ["Owner-requested production smoke test", `Expires after ${input.start.toISODate()}`],
    },
  });
}
