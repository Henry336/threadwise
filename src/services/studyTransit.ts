import type { StudyLocationOrigin, StudyScheduleBlock, StudyWorkspace } from "@prisma/client";
import { DateTime } from "luxon";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { academicWeekNumber, StudyModeError } from "./study";

export type TransitCoordinates = { latitude: number; longitude: number };
export type TransitStop = {
  id: string;
  title: string;
  subtitle?: string;
  shortLabel?: string;
  busStopCode?: string | null;
  coordinates: TransitCoordinates;
};
export type TransitVenue = {
  id: string;
  name: string;
  floor?: number | string | null;
  coordinates: TransitCoordinates;
};
export type TransitVenueDetail = TransitVenue & {
  nearbyStops: Array<TransitStop & { distanceMetres: number }>;
};
export type StudyOriginPlaceCandidate = {
  kind: "venue" | "stop";
  id: string;
  title: string;
  subtitle?: string;
};
type JourneyLeg = {
  service: string;
  fromStop: TransitStop;
  toStop: TransitStop;
  stops?: TransitStop[];
  nextArrival?: { minutes: number; display: string } | null;
};
type Journey = { fromStop: TransitStop; toStop: TransitStop; legs: JourneyLeg[]; transfers: number; status: string; message: string };
type JourneyAlternative = { journey: Journey; liveWaitMinutes: number | null; estimatedRideMinutes: number; estimatedTotalMinutes: number | null };
type BoardingRecommendation = { boardingStop: TransitStop; walkingDistanceMetres: number; estimatedWalkMinutes: number; journey: Journey };
type JourneySearchResponse = {
  journey: Journey | null;
  alternatives: JourneyAlternative[];
  recommendations: BoardingRecommendation[];
  directAvailable: boolean;
  message: string;
};

export type StudyJourneyEstimate = {
  origin: StudyLocationOrigin;
  destinationStop: TransitStop;
  boardingStop: TransitStop;
  services: string[];
  waitMinutes?: number;
  rideMinutes?: number;
  walkMinutes?: number;
  totalMinutes?: number;
  leaveBufferMinutes: number;
  message: string;
};

export type StudyTravelBlock = StudyScheduleBlock & {
  module: { id: string; code: string; name: string } | null;
  defaultOrigin: StudyLocationOrigin | null;
};

export type StudyDeparturePlan = {
  block: StudyTravelBlock;
  startsAt: Date;
  leaveAt: Date;
  journey: StudyJourneyEstimate;
  live: boolean;
  fallbackReason?: string;
};

const routeCache = new Map<string, { expiresAt: number; value: StudyJourneyEstimate }>();
const ROUTE_CACHE_TTL_MS = 3 * 60_000;
const FALLBACK_JOURNEY_MINUTES = 30;
const STUDY_PLACE_ALIASES: Record<string, string> = {
  pgpr: "PGP",
  "prince georges park residence": "PGP",
  "prince george park residence": "PGP",
  "prince georges park": "PGP",
  "kent ridge mrt station": "Kent Ridge MRT",
  krmrt: "Kent Ridge MRT",
};

export async function searchStudyVenues(query: string, limit = 8): Promise<TransitVenue[]> {
  const value = query.trim();
  if (!value) throw new StudyModeError("Give me a campus venue to search for.", "invalid");
  const result = await transitGet<{ venues: TransitVenue[] }>("venues", { q: value, limit: String(Math.min(20, Math.max(1, limit))) });
  return result.venues ?? [];
}

export async function getStudyVenue(venueId: string): Promise<TransitVenueDetail> {
  return transitGet<TransitVenueDetail>(`venues/${encodeURIComponent(venueId)}`);
}

export async function listStudyTransitStops(): Promise<TransitStop[]> {
  const result = await transitGet<{ stops: TransitStop[] }>("stops");
  return result.stops ?? [];
}

export function normalizeStudyPlaceQuery(query: string): string {
  const clean = normalizePlaceText(query);
  return STUDY_PLACE_ALIASES[clean] ?? query.replace(/\s+/g, " ").trim();
}

export async function searchStudyOriginPlaces(query: string, limit = 8): Promise<StudyOriginPlaceCandidate[]> {
  const original = query.replace(/\s+/g, " ").trim();
  if (!original) throw new StudyModeError("Give me a campus venue or NUS bus stop to search for.", "invalid");
  const resolved = normalizeStudyPlaceQuery(original);
  const [venueResult, stopResult] = await Promise.allSettled([
    searchStudyVenues(resolved, Math.max(limit, 8)),
    listStudyTransitStops(),
  ]);
  const venues = venueResult.status === "fulfilled" ? venueResult.value : [];
  const stops = stopResult.status === "fulfilled" ? stopResult.value : [];
  if (venues.length === 0 && stops.length === 0) {
    const reason = venueResult.status === "rejected" ? venueResult.reason : stopResult.status === "rejected" ? stopResult.reason : undefined;
    if (reason instanceof Error) throw reason;
  }
  const candidates: Array<StudyOriginPlaceCandidate & { score: number }> = [
    ...venues.map((venue, index) => ({
      kind: "venue" as const,
      id: venue.id,
      title: venue.name,
      subtitle: "Campus venue",
      score: placeMatchScore(resolved, [venue.id, venue.name]) + index / 100,
    })),
    ...stops.map((stop) => ({
      kind: "stop" as const,
      id: stop.id,
      title: stop.title,
      subtitle: [stop.shortLabel, stop.busStopCode, stop.subtitle].filter(Boolean).join(" · ") || "NUS bus stop",
      score: placeMatchScore(resolved, [stop.id, stop.title, stop.shortLabel, stop.busStopCode, stop.subtitle]),
    })).filter((candidate) => candidate.score < 100),
  ];
  const seen = new Set<string>();
  return candidates
    .filter((candidate) => candidate.score < 100)
    .sort((a, b) => a.score - b.score || a.title.localeCompare(b.title))
    .filter((candidate) => {
      const key = `${candidate.kind}:${candidate.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Math.min(10, Math.max(1, limit)))
    .map(({ score: _score, ...candidate }) => candidate);
}

async function resolveStudyVenueLegacy(query: string): Promise<TransitVenueDetail> {
  const venues = await searchStudyVenues(query, 8);
  if (venues.length === 0) throw new StudyModeError(`I couldn't find a campus venue matching “${query.trim()}”.`, "not_found");
  const normalized = query.trim().toLowerCase();
  const exact = venues.find((venue) => venue.id.toLowerCase() === normalized || venue.name.toLowerCase() === normalized);
  return getStudyVenue((exact ?? venues[0]!).id);
}

export async function resolveStudyVenue(query: string): Promise<TransitVenueDetail> {
  const candidates = await searchStudyOriginPlaces(query, 8);
  const candidate = candidates[0];
  if (!candidate) return resolveStudyVenueLegacy(query);
  if (candidate.kind === "venue") return getStudyVenue(candidate.id);
  const stop = (await listStudyTransitStops()).find((item) => item.id === candidate.id);
  if (!stop) throw new StudyModeError("That NUS bus stop is no longer available.", "not_found");
  return {
    id: stop.id,
    name: stop.title,
    coordinates: stop.coordinates,
    nearbyStops: [{ ...stop, distanceMetres: 0 }],
  };
}

export async function addStudyOriginFromCandidate(
  workspace: StudyWorkspace,
  name: string,
  candidate: StudyOriginPlaceCandidate,
  options: { makeDefault?: boolean; activateHours?: number } = {},
): Promise<StudyLocationOrigin> {
  if (candidate.kind === "venue") {
    const venue = await getStudyVenue(candidate.id);
    const stop = venue.nearbyStops[0];
    if (!stop) throw new StudyModeError(`${venue.name} has no nearby NUS bus stop in Improved NextBus.`, "not_found");
    return saveStudyOrigin(workspace, {
      name,
      providerVenueId: venue.id,
      providerStopId: stop.id,
      latitude: venue.coordinates.latitude,
      longitude: venue.coordinates.longitude,
      makeDefault: options.makeDefault,
      activateHours: options.activateHours,
    });
  }
  const stop = (await listStudyTransitStops()).find((item) => item.id === candidate.id);
  if (!stop) throw new StudyModeError("That NUS bus stop is no longer available.", "not_found");
  return saveStudyOrigin(workspace, {
    name,
    providerStopId: stop.id,
    latitude: stop.coordinates.latitude,
    longitude: stop.coordinates.longitude,
    makeDefault: options.makeDefault,
    activateHours: options.activateHours,
  });
}

export async function addStudyOriginFromVenue(
  workspace: StudyWorkspace,
  name: string,
  venueQuery: string,
  options: { makeDefault?: boolean; activateHours?: number } = {},
): Promise<StudyLocationOrigin> {
  const candidate = (await searchStudyOriginPlaces(venueQuery, 1))[0];
  if (!candidate) throw new StudyModeError(`I couldn't find a campus venue or NUS bus stop matching "${venueQuery.trim()}".`, "not_found");
  return addStudyOriginFromCandidate(workspace, name, candidate, options);
}

export async function addStudyOriginFromLocation(
  workspace: StudyWorkspace,
  name: string,
  coordinates: TransitCoordinates,
  options: { makeDefault?: boolean; activateHours?: number } = {},
): Promise<StudyLocationOrigin> {
  validateCoordinates(coordinates);
  const stops = await listStudyTransitStops();
  const stop = stops
    .map((candidate) => ({ candidate, metres: distanceMetres(coordinates, candidate.coordinates) }))
    .sort((a, b) => a.metres - b.metres)[0];
  if (!stop || stop.metres > 3_000) {
    throw new StudyModeError("That location is too far from a known NUS bus stop. Save a campus venue instead.", "invalid");
  }
  return saveStudyOrigin(workspace, {
    name,
    providerStopId: stop.candidate.id,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    makeDefault: options.makeDefault,
    activateHours: options.activateHours,
  });
}

export async function listStudyOrigins(workspaceId: string): Promise<StudyLocationOrigin[]> {
  return prisma.studyLocationOrigin.findMany({
    where: { workspaceId, active: true },
    orderBy: [{ isDefault: "desc" }, { displayOrder: "asc" }, { name: "asc" }],
  });
}

export async function renameStudyOrigin(workspace: StudyWorkspace, reference: string, name: string) {
  const origin = await findStudyOrigin(workspace.id, reference);
  const clean = originName(name);
  const updated = await prisma.studyLocationOrigin.update({ where: { id: origin.id }, data: { name: clean } });
  await auditOrigin(workspace, "study.origin.renamed", origin.id, { from: origin.name, to: clean });
  return updated;
}

export async function deleteStudyOrigin(workspace: StudyWorkspace, reference: string): Promise<void> {
  const origin = await findStudyOrigin(workspace.id, reference);
  await prisma.$transaction([
    prisma.studyWorkspace.updateMany({
      where: { id: workspace.id, activeOriginId: origin.id },
      data: { activeOriginId: null, activeOriginUntil: null },
    }),
    prisma.studyScheduleBlock.updateMany({ where: { defaultOriginId: origin.id }, data: { defaultOriginId: null } }),
    prisma.studyLocationOrigin.update({ where: { id: origin.id }, data: { active: false, isDefault: false } }),
  ]);
  await auditOrigin(workspace, "study.origin.removed", origin.id, { name: origin.name });
}

export async function activateStudyOrigin(workspace: StudyWorkspace, reference: string, hours = 4) {
  const origin = await findStudyOrigin(workspace.id, reference);
  const safeHours = Math.min(24, Math.max(1, Math.round(hours)));
  const until = new Date(Date.now() + safeHours * 3_600_000);
  await prisma.studyWorkspace.update({
    where: { id: workspace.id },
    data: { activeOriginId: origin.id, activeOriginUntil: until },
  });
  await auditOrigin(workspace, "study.origin.activated", origin.id, { hours: safeHours, until: until.toISOString() });
  return { origin, until };
}

export async function setDefaultStudyOrigin(workspace: StudyWorkspace, reference: string) {
  const origin = await findStudyOrigin(workspace.id, reference);
  await prisma.$transaction([
    prisma.studyLocationOrigin.updateMany({ where: { workspaceId: workspace.id, isDefault: true }, data: { isDefault: false } }),
    prisma.studyLocationOrigin.update({ where: { id: origin.id }, data: { isDefault: true, active: true } }),
  ]);
  await auditOrigin(workspace, "study.origin.defaulted", origin.id, { name: origin.name });
  return { ...origin, isDefault: true };
}

export async function currentStudyOrigin(workspace: StudyWorkspace, now = new Date()): Promise<StudyLocationOrigin | undefined> {
  if (workspace.activeOriginId && workspace.activeOriginUntil && workspace.activeOriginUntil > now) {
    const active = await prisma.studyLocationOrigin.findFirst({
      where: { id: workspace.activeOriginId, workspaceId: workspace.id, active: true },
    });
    if (active) return active;
  }
  return (await prisma.studyLocationOrigin.findFirst({
    where: { workspaceId: workspace.id, active: true, isDefault: true },
  })) ?? (await prisma.studyLocationOrigin.findFirst({
    where: { workspaceId: workspace.id, active: true },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
  })) ?? undefined;
}

export async function estimateStudyJourney(
  workspace: StudyWorkspace,
  destination: string,
  originReference?: string,
): Promise<StudyJourneyEstimate> {
  const origin = originReference
    ? await findStudyOrigin(workspace.id, originReference)
    : await currentStudyOrigin(workspace);
  if (!origin?.providerStopId) throw new StudyModeError("Add a travel origin first, then try the route again.", "invalid");
  const venue = await resolveStudyVenue(destination);
  const destinationStop = venue.nearbyStops[0];
  if (!destinationStop) throw new StudyModeError(`${venue.name} has no nearby NUS bus stop.`, "not_found");
  const response = await transitGet<JourneySearchResponse>("directions", {
    fromStopId: origin.providerStopId,
    toStopId: destinationStop.id,
    ...(origin.latitude !== null && origin.longitude !== null
      ? { latitude: String(origin.latitude), longitude: String(origin.longitude) }
      : {}),
  });
  return journeyEstimate(origin, destinationStop, response);
}

export async function estimateStudyJourneyByStops(
  workspace: StudyWorkspace,
  destinationStopId: string,
  originReference?: string,
): Promise<StudyJourneyEstimate> {
  const origin = originReference
    ? await findStudyOrigin(workspace.id, originReference)
    : await currentStudyOrigin(workspace);
  if (!origin?.providerStopId) throw new StudyModeError("Add a travel origin first.", "invalid");
  const response = await transitGet<JourneySearchResponse>("directions", {
    fromStopId: origin.providerStopId,
    toStopId: destinationStopId,
    ...(origin.latitude !== null && origin.longitude !== null
      ? { latitude: String(origin.latitude), longitude: String(origin.longitude) }
      : {}),
  });
  const stops = await listStudyTransitStops();
  const destination = stops.find((stop) => stop.id === destinationStopId);
  if (!destination) throw new StudyModeError("That destination stop is no longer available.", "not_found");
  return journeyEstimate(origin, destination, response);
}

export async function configureStudyScheduleTravel(
  workspace: StudyWorkspace,
  blockId: string,
  input: { destination: string; originReference?: string | null; travelBufferMinutes?: number },
): Promise<StudyTravelBlock> {
  const block = await requireTravelBlock(workspace.id, blockId);
  const venue = await resolveStudyVenue(input.destination);
  const stop = venue.nearbyStops[0];
  if (!stop) throw new StudyModeError(`${venue.name} has no nearby NUS bus stop.`, "not_found");
  const origin = input.originReference === null
    ? undefined
    : input.originReference
    ? await findStudyOrigin(workspace.id, input.originReference)
    : block.defaultOrigin ?? await currentStudyOrigin(workspace);
  const travelBufferMinutes = Math.min(90, Math.max(0, Math.round(input.travelBufferMinutes ?? block.travelBufferMinutes)));
  await prisma.studyScheduleBlock.update({
    where: { id: block.id },
    data: {
      venueId: venue.id,
      venueName: venue.name,
      destinationStopId: stop.id,
      defaultOriginId: input.originReference === null ? null : origin?.id ?? null,
      travelBufferMinutes,
      blockType: block.blockType === "study" ? "timetable" : block.blockType,
    },
  });
  await auditOrigin(workspace, "study.schedule.travel_configured", block.id, {
    destination: venue.name,
    destinationStopId: stop.id,
    travelBufferMinutes,
  });
  return requireTravelBlock(workspace.id, block.id);
}

export async function clearStudyScheduleTravel(workspace: StudyWorkspace, blockId: string): Promise<StudyTravelBlock> {
  const block = await requireTravelBlock(workspace.id, blockId);
  await prisma.studyScheduleBlock.update({
    where: { id: block.id },
    data: { venueId: null, venueName: null, destinationStopId: null, defaultOriginId: null },
  });
  await auditOrigin(workspace, "study.schedule.travel_cleared", block.id, { label: block.label });
  return requireTravelBlock(workspace.id, block.id);
}

export async function listUpcomingStudyTravelBlocks(
  workspace: StudyWorkspace,
  now = new Date(),
  days = 14,
): Promise<Array<{ block: StudyTravelBlock; startsAt: Date }>> {
  const blocks = await prisma.studyScheduleBlock.findMany({
    where: {
      workspaceId: workspace.id,
      active: true,
      destinationStopId: { not: null },
      OR: [{ moduleId: null }, { module: { active: true } }],
    },
    include: { module: { select: { id: true, code: true, name: true } }, defaultOrigin: true },
    orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
  });
  const localNow = DateTime.fromJSDate(now).setZone(workspace.timezone);
  const end = localNow.plus({ days });
  const results: Array<{ block: StudyTravelBlock; startsAt: Date }> = [];
  for (let cursor = localNow.startOf("day"); cursor <= end.startOf("day"); cursor = cursor.plus({ days: 1 })) {
    for (const block of blocks) {
      if (block.dayOfWeek !== cursor.weekday) continue;
      const clock = parseClock(block.startTime);
      if (!clock) continue;
      const starts = cursor.set(clock);
      if (starts <= localNow) continue;
      const weekNumber = academicWeekNumber(workspace, starts.toUTC().toJSDate());
      if ((block.startWeek && weekNumber < block.startWeek) || (block.endWeek && weekNumber > block.endWeek)) continue;
      results.push({ block, startsAt: starts.toUTC().toJSDate() });
    }
  }
  return results.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()).slice(0, 12);
}

export async function buildStudyDeparturePlan(
  workspace: StudyWorkspace,
  blockId: string,
  options: { startsAt?: Date; force?: boolean } = {},
): Promise<StudyDeparturePlan> {
  const block = await requireTravelBlock(workspace.id, blockId);
  if (!block.destinationStopId || !block.venueName) {
    throw new StudyModeError("Add a destination to this timetable block first.", "invalid");
  }
  const startsAt = options.startsAt ?? nextBlockOccurrence(workspace, block);
  const originReference = block.defaultOriginId ?? undefined;
  const cacheKey = `${workspace.id}:${block.id}:${originReference ?? "current"}:${block.destinationStopId}`;
  let journey: StudyJourneyEstimate | undefined;
  let fallbackReason: string | undefined;
  if (!options.force) {
    const cached = routeCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) journey = cached.value;
  }
  if (!journey) {
    try {
      journey = await estimateStudyJourneyByStops(workspace, block.destinationStopId, originReference);
      routeCache.set(cacheKey, { expiresAt: Date.now() + ROUTE_CACHE_TTL_MS, value: journey });
    } catch (error) {
      const origin = originReference
        ? await findStudyOrigin(workspace.id, originReference)
        : await currentStudyOrigin(workspace);
      if (!origin?.providerStopId) throw error;
      const destinationStop = {
        id: block.destinationStopId,
        title: block.venueName,
        coordinates: { latitude: 0, longitude: 0 },
      };
      fallbackReason = error instanceof Error ? error.message : "Live bus information is unavailable.";
      journey = {
        origin,
        destinationStop,
        boardingStop: { id: origin.providerStopId, title: origin.name, coordinates: { latitude: origin.latitude ?? 0, longitude: origin.longitude ?? 0 } },
        services: [],
        totalMinutes: FALLBACK_JOURNEY_MINUTES,
        leaveBufferMinutes: block.travelBufferMinutes,
        message: "Live buses are unavailable. Using the normal travel estimate.",
      };
    }
  }
  const leaveAt = computeStudyLeaveAt(startsAt, journey.totalMinutes, block.travelBufferMinutes);
  return {
    block,
    startsAt,
    leaveAt,
    journey: { ...journey, leaveBufferMinutes: block.travelBufferMinutes },
    live: !fallbackReason,
    fallbackReason,
  };
}

export function computeStudyLeaveAt(startsAt: Date, totalMinutes: number | undefined, travelBufferMinutes: number): Date {
  const travelMinutes = Math.max(1, totalMinutes ?? FALLBACK_JOURNEY_MINUTES) + Math.max(0, travelBufferMinutes);
  return new Date(startsAt.getTime() - travelMinutes * 60_000);
}

export async function muteStudyTravelForToday(workspace: StudyWorkspace, now = new Date()): Promise<Date> {
  const until = DateTime.fromJSDate(now).setZone(workspace.timezone).endOf("day").toUTC().toJSDate();
  // The cast keeps local development usable when another running process has
  // Windows' generated Prisma client locked. Render regenerates from schema.
  await prisma.studyWorkspace.update({ where: { id: workspace.id }, data: { travelMutedUntil: until } as never });
  await auditOrigin(workspace, "study.travel.muted", workspace.id, { until: until.toISOString() });
  return until;
}

export async function resumeStudyTravelReminders(workspace: StudyWorkspace): Promise<void> {
  await prisma.studyWorkspace.update({ where: { id: workspace.id }, data: { travelMutedUntil: null } as never });
  await auditOrigin(workspace, "study.travel.resumed", workspace.id, {});
}

export function isStudyTravelMuted(workspace: StudyWorkspace, now = new Date()): boolean {
  const mutedUntil = (workspace as StudyWorkspace & { travelMutedUntil?: Date | null }).travelMutedUntil;
  return Boolean(mutedUntil && mutedUntil > now);
}

async function saveStudyOrigin(workspace: StudyWorkspace, input: {
  name: string;
  providerVenueId?: string;
  providerStopId: string;
  latitude: number;
  longitude: number;
  makeDefault?: boolean;
  activateHours?: number;
}): Promise<StudyLocationOrigin> {
  const name = originName(input.name);
  const displayOrder = await prisma.studyLocationOrigin.count({ where: { workspaceId: workspace.id } });
  const existing = await prisma.studyLocationOrigin.findUnique({
    where: { workspaceId_name: { workspaceId: workspace.id, name } },
  });
  const origin = existing
    ? await prisma.studyLocationOrigin.update({
      where: { id: existing.id },
      data: {
        providerVenueId: input.providerVenueId,
        providerStopId: input.providerStopId,
        latitude: input.latitude,
        longitude: input.longitude,
        active: true,
      },
    })
    : await prisma.studyLocationOrigin.create({
      data: {
        workspaceId: workspace.id,
        name,
        providerVenueId: input.providerVenueId,
        providerStopId: input.providerStopId,
        latitude: input.latitude,
        longitude: input.longitude,
        displayOrder,
      },
    });
  if (input.makeDefault) await setDefaultStudyOrigin(workspace, origin.id);
  if (input.activateHours) await activateStudyOrigin(workspace, origin.id, input.activateHours);
  await prisma.auditLog.create({
    data: {
      userId: workspace.ownerUserId,
      action: "study.origin.saved",
      metadata: { workspaceId: workspace.id, originId: origin.id, name, providerStopId: input.providerStopId },
    },
  });
  return { ...origin, isDefault: input.makeDefault ? true : origin.isDefault };
}

async function findStudyOrigin(workspaceId: string, reference: string): Promise<StudyLocationOrigin> {
  const normalized = reference.trim();
  const origin = await prisma.studyLocationOrigin.findFirst({
    where: {
      workspaceId,
      active: true,
      OR: [
        { name: { equals: normalized, mode: "insensitive" } },
        ...(isUuid(normalized) ? [{ id: normalized }] : []),
      ],
    },
  });
  if (!origin) throw new StudyModeError(`I couldn't find the origin “${normalized}”.`, "not_found");
  return origin;
}

async function requireTravelBlock(workspaceId: string, blockId: string): Promise<StudyTravelBlock> {
  const block = await prisma.studyScheduleBlock.findFirst({
    where: { id: blockId, workspaceId, active: true },
    include: { module: { select: { id: true, code: true, name: true } }, defaultOrigin: true },
  });
  if (!block) throw new StudyModeError("That timetable block was not found.", "not_found");
  return block;
}

function nextBlockOccurrence(workspace: StudyWorkspace, block: StudyScheduleBlock, now = new Date()): Date {
  const local = DateTime.fromJSDate(now).setZone(workspace.timezone);
  const clock = parseClock(block.startTime);
  if (!clock) throw new StudyModeError("That timetable block has an invalid start time.", "invalid");
  const daysAhead = (block.dayOfWeek - local.weekday + 7) % 7;
  let starts = local.startOf("day").plus({ days: daysAhead }).set(clock);
  if (starts <= local) starts = starts.plus({ weeks: 1 });
  for (let attempt = 0; attempt < 52; attempt += 1) {
    const startsAt = starts.toUTC().toJSDate();
    const weekNumber = academicWeekNumber(workspace, startsAt);
    const withinStart = !block.startWeek || weekNumber >= block.startWeek;
    const withinEnd = !block.endWeek || weekNumber <= block.endWeek;
    if (withinStart && withinEnd) return startsAt;
    if (block.endWeek && weekNumber > block.endWeek) break;
    starts = starts.plus({ weeks: 1 });
  }
  throw new StudyModeError("That class has no upcoming occurrence in its configured semester weeks.", "not_found");
}

function parseClock(value: string): { hour: number; minute: number } | undefined {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? { hour, minute } : undefined;
}

function journeyEstimate(origin: StudyLocationOrigin, destinationStop: TransitStop, result: JourneySearchResponse): StudyJourneyEstimate {
  const direct = result.alternatives[0];
  if (direct) {
    return {
      origin,
      destinationStop,
      boardingStop: direct.journey.fromStop,
      services: direct.journey.legs.map((leg) => leg.service),
      waitMinutes: direct.liveWaitMinutes ?? undefined,
      rideMinutes: direct.estimatedRideMinutes,
      totalMinutes: direct.estimatedTotalMinutes ?? undefined,
      leaveBufferMinutes: 15,
      message: result.message,
    };
  }
  const recommendation = result.recommendations[0];
  if (recommendation) {
    const wait = recommendation.journey.legs[0]?.nextArrival?.minutes;
    const ride = estimatedRideMinutes(recommendation.journey);
    return {
      origin,
      destinationStop,
      boardingStop: recommendation.boardingStop,
      services: recommendation.journey.legs.map((leg) => leg.service),
      waitMinutes: wait,
      walkMinutes: recommendation.estimatedWalkMinutes,
      rideMinutes: ride,
      totalMinutes: recommendation.estimatedWalkMinutes + (wait ?? 0) + ride,
      leaveBufferMinutes: 15,
      message: result.message,
    };
  }
  if (result.journey) {
    const wait = result.journey.legs[0]?.nextArrival?.minutes;
    const ride = estimatedRideMinutes(result.journey);
    return {
      origin,
      destinationStop,
      boardingStop: result.journey.fromStop,
      services: result.journey.legs.map((leg) => leg.service),
      waitMinutes: wait,
      rideMinutes: ride,
      totalMinutes: (wait ?? 0) + ride,
      leaveBufferMinutes: 15,
      message: result.message,
    };
  }
  throw new StudyModeError(result.message || "Improved NextBus could not find a usable route.", "not_found");
}

function estimatedRideMinutes(journey: Journey): number {
  return Math.max(5, journey.legs.reduce((sum, leg) => sum + Math.max(1, (leg.stops?.length ?? 2) - 1) * 3, 0));
}

async function transitGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`/api/${path.replace(/^\//, "")}`, env.STUDY_TRANSIT_BASE_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.STUDY_EXTERNAL_REQUEST_TIMEOUT_MS);
  timeout.unref?.();
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    const value = await response.json().catch(() => ({})) as { error?: string } & T;
    if (!response.ok) throw new Error(value.error || `Improved NextBus returned ${response.status}.`);
    return value;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new StudyModeError("Improved NextBus took too long to respond. Try again shortly.", "invalid");
    }
    if (error instanceof StudyModeError) throw error;
    throw new StudyModeError(error instanceof Error ? error.message : "Improved NextBus is unavailable right now.", "invalid");
  } finally {
    clearTimeout(timeout);
  }
}

function originName(value: string): string {
  const name = value.replace(/\s+/g, " ").trim();
  if (!name) throw new StudyModeError("Give the origin a short name such as Home or COM3.", "invalid");
  return name.slice(0, 80);
}

function validateCoordinates(value: TransitCoordinates): void {
  if (!Number.isFinite(value.latitude) || !Number.isFinite(value.longitude)
    || value.latitude < -90 || value.latitude > 90 || value.longitude < -180 || value.longitude > 180) {
    throw new StudyModeError("That location is invalid.", "invalid");
  }
}

function distanceMetres(a: TransitCoordinates, b: TransitCoordinates): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const deltaLat = radians(b.latitude - a.latitude);
  const deltaLon = radians(b.longitude - a.longitude);
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function normalizePlaceText(value: string): string {
  return value.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function placeMatchScore(query: string, values: Array<string | null | undefined>): number {
  const needle = normalizePlaceText(query);
  if (!needle) return 100;
  let best = 100;
  for (const value of values) {
    if (!value) continue;
    const haystack = normalizePlaceText(value);
    if (haystack === needle) best = Math.min(best, 0);
    else if (haystack.startsWith(needle)) best = Math.min(best, 1);
    else if (needle.startsWith(haystack) && haystack.length >= 3) best = Math.min(best, 1.5);
    else if (needle.split(" ").every((token) => haystack.includes(token))) best = Math.min(best, 2);
    else if (haystack.includes(needle)) best = Math.min(best, 3);
  }
  return best;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function auditOrigin(
  workspace: StudyWorkspace,
  action: string,
  originId: string,
  metadata: Record<string, string | number>,
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: workspace.ownerUserId,
      action,
      metadata: { workspaceId: workspace.id, originId, ...metadata },
    },
  });
}
