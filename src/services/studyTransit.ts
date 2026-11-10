/**
 * Campus travel for Study Mode, built on the public Improved NextBus service (NUS shuttle buses).
 * This is the single place boundary: venue and stop search, saved/default/temporary travel origins,
 * per-block destinations, and journey plans with walking, waiting and riding legs. Callers include the
 * Study bot handlers, dashboard Study routes, the NUSMods importer, and studyReminders (leave-by times).
 * Live data is advisory: when the provider fails, a labelled 30-minute fallback is used, never an invented arrival.
 */
import type { StudyLocationOrigin, StudyScheduleBlock, StudyWorkspace } from "@prisma/client";
import { DateTime } from "luxon";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { academicWeekNumber, StudyModeError } from "./study";
import { queueStudyCalendarBlockSync } from "./studyCalendar";

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
/**
 * A resolved campus place. id is canonical ("venue:X" or "stop:Y") and can be passed back to
 * resolveStudyPlace; providerId is the raw Improved NextBus id. nearbyStops are ranked boarding options.
 */
export type StudyPlace = {
  id: string;
  providerId: string;
  kind: "venue" | "stop";
  displayName: string;
  subtitle?: string;
  aliases: string[];
  coordinates: TransitCoordinates;
  nearbyStops: Array<TransitStop & { distanceMetres: number; walkMinutes: number }>;
};
export type StudyJourneyLeg = {
  service: string;
  fromStop: TransitStop;
  toStop: TransitStop;
  stops: TransitStop[];
  nextArrival?: { minutes: number; display: string } | null;
};
export type StudyJourneyAlternative = {
  services: string[];
  boardingStop: TransitStop;
  alightStop: TransitStop;
  waitMinutes?: number;
  rideMinutes: number;
  firstWalkMinutes: number;
  finalWalkMinutes: number;
  totalMinutes: number;
};
// The types below mirror the Improved NextBus v1 "journeys" response (inside its `data` envelope).
type JourneyLeg = {
  service: string;
  fromStop: TransitStop;
  toStop: TransitStop;
  stops?: TransitStop[];
  nextArrival?: { minutes: number; display: string } | null;
};
type Journey = { fromStop: TransitStop; toStop: TransitStop; legs: JourneyLeg[]; transfers: number; freshness?: string };
type JourneyAlternative = { journey: Journey; liveWaitMinutes: number | null; estimatedRideMinutes: number; estimatedTotalMinutes: number | null };
type BoardingRecommendation = { boardingStop: TransitStop; walkingDistanceMetres: number; estimatedWalkMinutes: number; journey: Journey };
type JourneySearchResponse = {
  journey: Journey | null;
  alternatives: JourneyAlternative[];
  recommendations: BoardingRecommendation[];
  message: string;
};

/** A complete route plan from an origin to a destination, in the shape the bot and dashboard display. */
export type StudyJourneyEstimate = {
  origin: StudyLocationOrigin;
  destinationStop: TransitStop;
  boardingStop: TransitStop;
  services: string[];
  destinationPlace?: StudyPlace;
  alightStop?: TransitStop;
  legs?: StudyJourneyLeg[];
  transfers?: number;
  firstWalkMinutes?: number;
  finalWalkMinutes?: number;
  waitMinutes?: number;
  rideMinutes?: number;
  walkMinutes?: number;
  totalMinutes?: number;
  leaveBufferMinutes: number;
  message: string;
  freshness?: string;
  updatedAt: Date;
  live?: boolean;
  alternatives?: StudyJourneyAlternative[];
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

/** In-process cache of departure-plan routes for three minutes, so repeated reminder passes do not re-query the provider. Lost on restart, which is fine. */
const routeCache = new Map<string, { expiresAt: number; value: StudyJourneyEstimate }>();
const ROUTE_CACHE_TTL_MS = 3 * 60_000;
const FALLBACK_JOURNEY_MINUTES = 30;
/** Local nicknames the provider's search does not know, mapped to a query it does. */
const STUDY_PLACE_ALIASES: Record<string, string> = {
  pgpr: "PGP",
  "prince georges park residence": "PGP",
  "prince george park residence": "PGP",
  "prince georges park": "PGP",
  "kent ridge mrt station": "Kent Ridge MRT",
  krmrt: "Kent Ridge MRT",
};

/** Thrown when a place name matches several places; carries the candidates so the caller can show a picker. */
export class StudyPlaceAmbiguityError extends StudyModeError {
  constructor(public readonly candidates: StudyPlace[]) {
    super("Choose the NUS place you meant.", "invalid");
    this.name = "StudyPlaceAmbiguityError";
  }
}

export async function searchStudyVenues(query: string, limit = 8): Promise<TransitVenue[]> {
  const value = query.trim();
  if (!value) throw new StudyModeError("Give me a campus venue to search for.", "invalid");
  const result = await transitRequest<{ places: TransitVenue[] }>("places/search", { query: { q: value, limit: String(Math.min(20, Math.max(1, limit))) } });
  return result.places ?? [];
}

/**
 * One campus place plus its closest stops. v1 has no place-by-id route, so this searches by the id
 * (an exact id match is required) and then asks for the stops nearest the place's coordinates.
 */
export async function getStudyVenue(venueId: string): Promise<TransitVenueDetail> {
  const { places } = await transitRequest<{ places: TransitVenue[] }>("places/search", { query: { q: venueId, limit: "5" } });
  const venue = (places ?? []).find((place) => place.id === venueId);
  if (!venue) throw new StudyModeError("That campus place is no longer listed by Improved NextBus.", "not_found");
  const { stops } = await transitRequest<{ stops: Array<TransitStop & { distanceMetres: number }> }>("stops/nearby", {
    query: { latitude: String(venue.coordinates.latitude), longitude: String(venue.coordinates.longitude), limit: "5" },
  });
  return { ...venue, nearbyStops: stops ?? [] };
}

/** Every campus stop (33 today, one page); follows the cursor for up to five pages in case that grows. */
export async function listStudyTransitStops(): Promise<TransitStop[]> {
  const stops: TransitStop[] = [];
  let cursor: string | null | undefined;
  for (let page = 0; page < 5; page += 1) {
    const result = await transitRequest<{ stops: TransitStop[]; nextCursor?: string | null }>("stops", { query: { limit: "100", ...(cursor ? { cursor } : {}) } });
    stops.push(...(result.stops ?? []));
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  return stops;
}

/** Rewrites a known nickname (e.g. "pgpr") to its search term; otherwise just collapses whitespace. */
export function normalizeStudyPlaceQuery(query: string): string {
  const clean = normalizePlaceText(query);
  return STUDY_PLACE_ALIASES[clean] ?? query.replace(/\s+/g, " ").trim();
}

export async function searchStudyOriginPlaces(query: string, limit = 8): Promise<StudyOriginPlaceCandidate[]> {
  return (await searchStudyPlaces(query, limit)).map((place) => ({
    kind: place.kind,
    id: place.id,
    title: place.displayName,
    subtitle: place.subtitle,
  }));
}

/**
 * Searches venues and bus stops together and ranks them by match quality (exact, prefix, all words,
 * substring). Either provider call may fail on its own; an error is thrown only when both return
 * nothing. Venue results are expanded with a detail call to get coordinates and nearby stops.
 */
export async function searchStudyPlaces(query: string, limit = 8): Promise<StudyPlace[]> {
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
  const ranked: Array<StudyOriginPlaceCandidate & { providerId: string; score: number }> = [
    ...venues.map((venue, index) => ({
      kind: "venue" as const,
      id: `venue:${venue.id}`,
      providerId: venue.id,
      title: venue.name,
      subtitle: "Campus venue",
      score: placeMatchScore(resolved, [venue.id, venue.name]) + index / 100,
    })),
    ...stops.map((stop) => ({
      kind: "stop" as const,
      id: `stop:${stop.id}`,
      providerId: stop.id,
      title: stop.title,
      subtitle: [stop.shortLabel, stop.busStopCode, stop.subtitle].filter(Boolean).join(" · ") || "NUS bus stop",
      score: placeMatchScore(resolved, [stop.id, stop.title, stop.shortLabel, stop.busStopCode, stop.subtitle]),
    })).filter((candidate) => candidate.score < 100),
  ];
  const seen = new Set<string>();
  const candidates = ranked
    .filter((candidate) => candidate.score < 100)
    .sort((a, b) => a.score - b.score || a.title.localeCompare(b.title))
    .filter((candidate) => {
      const key = candidate.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Math.min(10, Math.max(1, limit)))
    .map(async ({ score: _score, providerId, ...candidate }) => {
      if (candidate.kind === "venue") {
        const detail = await getStudyVenue(providerId);
        return {
          id: candidate.id,
          providerId,
          kind: candidate.kind,
          displayName: candidate.title,
          subtitle: candidate.subtitle,
          aliases: placeAliases(candidate.title, providerId),
          coordinates: detail.coordinates,
          nearbyStops: detail.nearbyStops.map((stop) => ({ ...stop, walkMinutes: walkingMinutes(stop.distanceMetres) })),
        } satisfies StudyPlace;
      }
      const stop = stops.find((value) => value.id === providerId)!;
      return {
        id: candidate.id,
        providerId,
        kind: candidate.kind,
        displayName: candidate.title,
        subtitle: candidate.subtitle,
        aliases: placeAliases(candidate.title, providerId, stop.shortLabel, stop.busStopCode),
        coordinates: stop.coordinates,
        nearbyStops: [{ ...stop, distanceMetres: 0, walkMinutes: 0 }],
      } satisfies StudyPlace;
    });
  return Promise.all(candidates);
}

/** Resolves a place and returns it in venue-detail form; a bus stop becomes a venue whose only nearby stop is itself. */
export async function resolveStudyVenue(query: string): Promise<TransitVenueDetail> {
  const place = await resolveStudyPlace(query);
  if (place.kind === "venue") return getStudyVenue(place.providerId);
  const stop = place.nearbyStops[0];
  if (!stop) throw new StudyModeError("That NUS bus stop is no longer available.", "not_found");
  return {
    id: place.providerId,
    name: place.displayName,
    coordinates: place.coordinates,
    nearbyStops: [{ ...stop, distanceMetres: 0 }],
  };
}

/**
 * Turns user text or a canonical "venue:"/"stop:" id into exactly one place. A canonical id is looked up
 * directly. Free text resolves only on a single exact name or alias match; several matches throw
 * StudyPlaceAmbiguityError so the user picks, instead of the bot guessing a destination.
 */
export async function resolveStudyPlace(reference: string): Promise<StudyPlace> {
  const value = reference.trim();
  const canonical = /^(venue|stop):(.+)$/.exec(value);
  if (canonical?.[1] === "venue") {
    const detail = await getStudyVenue(canonical[2]!);
    return venueToPlace(detail);
  }
  if (canonical?.[1] === "stop") {
    const stop = (await listStudyTransitStops()).find((item) => item.id === canonical[2]);
    if (!stop) throw new StudyModeError("That NUS bus stop is no longer available.", "not_found");
    return stopToPlace(stop);
  }
  const candidates = await searchStudyPlaces(value, 8);
  if (!candidates.length) throw new StudyModeError(`I couldn't find an NUS place matching “${value}”.`, "not_found");
  const needle = normalizePlaceText(normalizeStudyPlaceQuery(value));
  const exact = candidates.filter((candidate) => [candidate.displayName, candidate.providerId, ...candidate.aliases]
    .some((name) => normalizePlaceText(name) === needle));
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) throw new StudyPlaceAmbiguityError(exact);
  if (candidates.length > 1) throw new StudyPlaceAmbiguityError(candidates.slice(0, 6));
  return candidates[0]!;
}

/** Saves a named origin from a picked venue or stop. A venue origin boards at its nearest stop. */
export async function addStudyOriginFromCandidate(
  workspace: StudyWorkspace,
  name: string,
  candidate: StudyOriginPlaceCandidate,
  options: { makeDefault?: boolean; activateHours?: number } = {},
): Promise<StudyLocationOrigin> {
  if (candidate.kind === "venue") {
    const venue = await getStudyVenue(candidate.id.replace(/^venue:/, ""));
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
  const stop = (await listStudyTransitStops()).find((item) => item.id === candidate.id.replace(/^stop:/, ""));
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
  const place = await resolveStudyPlace(venueQuery);
  return addStudyOriginFromCandidate(workspace, name, {
    kind: place.kind,
    id: place.id,
    title: place.displayName,
    subtitle: place.subtitle,
  }, options);
}

/**
 * Saves a temporary origin from a Telegram location share, snapped to the closest stop within 3 km.
 * It is marked temporary so it is deleted when it expires or the owner taps "I'm here"; the bot does
 * not keep tracking location.
 */
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
    temporary: true,
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

/** Deactivates an origin and, in one transaction, detaches it from the workspace and from any timetable block. */
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

/** Makes an origin the current starting point for 1 to 24 hours (default 4), overriding the default. */
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

/** Sets the single default origin, clearing the flag on all others in the same transaction. */
export async function setDefaultStudyOrigin(workspace: StudyWorkspace, reference: string) {
  const origin = await findStudyOrigin(workspace.id, reference);
  await prisma.$transaction([
    prisma.studyLocationOrigin.updateMany({ where: { workspaceId: workspace.id, isDefault: true }, data: { isDefault: false } }),
    prisma.studyLocationOrigin.update({ where: { id: origin.id }, data: { isDefault: true, active: true } }),
  ]);
  await auditOrigin(workspace, "study.origin.defaulted", origin.id, { name: origin.name });
  return { ...origin, isDefault: true };
}

/**
 * Where the owner is starting from right now: an unexpired activated origin, else the default.
 * An expired activation is cleared as a side effect, and an expired temporary location is deleted.
 */
export async function currentStudyOrigin(workspace: StudyWorkspace, now = new Date()): Promise<StudyLocationOrigin | undefined> {
  const current = await prisma.studyWorkspace.findUnique({
    where: { id: workspace.id },
    select: { activeOriginId: true, activeOriginUntil: true },
  });
  if (current?.activeOriginId && current.activeOriginUntil && current.activeOriginUntil > now) {
    const active = await prisma.studyLocationOrigin.findFirst({
      where: { id: current.activeOriginId, workspaceId: workspace.id, active: true },
    });
    if (active) return active;
  }
  if (current?.activeOriginId) {
    const expired = await prisma.studyLocationOrigin.findFirst({ where: { id: current.activeOriginId, workspaceId: workspace.id } });
    await prisma.studyWorkspace.updateMany({ where: { id: workspace.id, activeOriginId: current.activeOriginId }, data: { activeOriginId: null, activeOriginUntil: null } });
    if (expired?.temporary) await prisma.studyLocationOrigin.delete({ where: { id: expired.id } });
  }
  return (await prisma.studyLocationOrigin.findFirst({
    where: { workspaceId: workspace.id, active: true, isDefault: true },
  })) ?? undefined;
}

/** Clears the active origin and deletes it if it was a temporary shared location (used by "I'm here"). */
export async function clearTemporaryStudyOrigin(workspace: StudyWorkspace): Promise<void> {
  const current = await prisma.studyWorkspace.findUnique({
    where: { id: workspace.id },
    select: { activeOriginId: true },
  });
  if (!current?.activeOriginId) return;
  const origin = await prisma.studyLocationOrigin.findFirst({
    where: { id: current.activeOriginId, workspaceId: workspace.id, temporary: true },
  });
  await prisma.studyWorkspace.updateMany({
    where: { id: workspace.id, activeOriginId: current.activeOriginId },
    data: { activeOriginId: null, activeOriginUntil: null },
  });
  if (origin) await prisma.studyLocationOrigin.delete({ where: { id: origin.id } });
}

/** Route to a named destination from a given origin or the current one. Used for "how do I get to X". */
export async function estimateStudyJourney(
  workspace: StudyWorkspace,
  destination: string,
  originReference?: string,
): Promise<StudyJourneyEstimate> {
  const origin = originReference
    ? await findStudyOrigin(workspace.id, originReference)
    : await currentStudyOrigin(workspace);
  if (!origin?.providerStopId) throw new StudyModeError("Add a travel origin first, then try the route again.", "invalid");
  const place = await resolveStudyPlace(destination);
  return estimateJourneyToPlace(origin, place);
}

/** Route to a known destination stop id, for blocks that have a stop but no resolved venue. */
export async function estimateStudyJourneyByStops(
  workspace: StudyWorkspace,
  destinationStopId: string,
  originReference?: string,
  destinationPlaceReference?: string,
): Promise<StudyJourneyEstimate> {
  const origin = originReference
    ? await findStudyOrigin(workspace.id, originReference)
    : await currentStudyOrigin(workspace);
  if (!origin?.providerStopId) throw new StudyModeError("Add a travel origin first.", "invalid");
  const response = await planStopJourney(origin, destinationStopId);
  const stops = await listStudyTransitStops();
  const destination = stops.find((stop) => stop.id === destinationStopId);
  if (!destination) throw new StudyModeError("That destination stop is no longer available.", "not_found");
  const place = destinationPlaceReference ? await resolveStudyPlace(destinationPlaceReference) : undefined;
  return journeyEstimate(origin, destination, response, place);
}

/**
 * Sets a timetable block's destination (resolved place plus its nearest stop), optional fixed origin,
 * and extra buffer (0 to 90 minutes). This is what enables class-departure reminders for the block.
 * Audited, and queues a Google Calendar mirror update since the event location changed.
 */
export async function configureStudyScheduleTravel(
  workspace: StudyWorkspace,
  blockId: string,
  input: { destination: string; destinationPlaceId?: string; originReference?: string | null; travelBufferMinutes?: number },
): Promise<StudyTravelBlock> {
  const block = await requireTravelBlock(workspace.id, blockId);
  const place = await resolveStudyPlace(input.destinationPlaceId ?? input.destination);
  const stop = place.nearbyStops[0];
  if (!stop) throw new StudyModeError(`${place.displayName} has no nearby NUS bus stop.`, "not_found");
  const origin = input.originReference === null
    ? undefined
    : input.originReference
    ? await findStudyOrigin(workspace.id, input.originReference)
    : block.defaultOrigin ?? await currentStudyOrigin(workspace);
  const travelBufferMinutes = Math.min(90, Math.max(0, Math.round(input.travelBufferMinutes ?? block.travelBufferMinutes)));
  await prisma.studyScheduleBlock.update({
    where: { id: block.id },
    data: {
      venueId: place.id,
      venueName: place.displayName,
      destinationStopId: stop.id,
      defaultOriginId: input.originReference === null ? null : origin?.id ?? null,
      travelBufferMinutes,
      blockType: block.blockType === "study" ? "timetable" : block.blockType,
    },
  });
  await auditOrigin(workspace, "study.schedule.travel_configured", block.id, {
    destination: place.displayName,
    destinationStopId: stop.id,
    travelBufferMinutes,
  });
  await queueStudyCalendarBlockSync(workspace, block.id);
  return requireTravelBlock(workspace.id, block.id);
}

/**
 * Stores a free-text location label without a resolved place. The label stays visible but clears the
 * destination stop, so an unrecognised place can never silently enable a travel reminder.
 */
export async function setStudyScheduleDestinationLabel(workspace: StudyWorkspace, blockId: string, label: string): Promise<StudyTravelBlock> {
  const block = await requireTravelBlock(workspace.id, blockId);
  const venueName = label.replace(/\s+/g, " ").trim().slice(0, 200);
  await prisma.studyScheduleBlock.update({ where: { id: block.id }, data: { venueId: null, venueName: venueName || null, destinationStopId: null } });
  await queueStudyCalendarBlockSync(workspace, block.id);
  return requireTravelBlock(workspace.id, block.id);
}

export async function clearStudyScheduleTravel(workspace: StudyWorkspace, blockId: string): Promise<StudyTravelBlock> {
  const block = await requireTravelBlock(workspace.id, blockId);
  await prisma.studyScheduleBlock.update({
    where: { id: block.id },
    data: { venueId: null, venueName: null, destinationStopId: null, defaultOriginId: null },
  });
  await auditOrigin(workspace, "study.schedule.travel_cleared", block.id, { label: block.label });
  await queueStudyCalendarBlockSync(workspace, block.id);
  return requireTravelBlock(workspace.id, block.id);
}

/**
 * Next occurrences (up to 12, within the given days) of blocks that have a travel destination.
 * Applies either calendar-date recurrence or academic-week limits and exclusions, matching the reminder logic.
 */
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
      const dateKey = starts.toISODate();
      const usesCalendarRecurrence = Boolean(block.recurrenceStartDate || block.recurrenceEndDate || block.excludedDates.length);
      if (usesCalendarRecurrence) {
        if (!dateKey
          || (block.recurrenceStartDate && dateKey < block.recurrenceStartDate.toISOString().slice(0, 10))
          || (block.recurrenceEndDate && dateKey > block.recurrenceEndDate.toISOString().slice(0, 10))
          || block.excludedDates.some((date) => date.toISOString().slice(0, 10) === dateKey)) continue;
      } else if ((block.startWeek && weekNumber < block.startWeek)
        || (block.endWeek && weekNumber > block.endWeek)
        || block.excludedWeeks.includes(weekNumber)) continue;
      results.push({ block, startsAt: starts.toUTC().toJSDate() });
    }
  }
  return results.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()).slice(0, 12);
}

/**
 * Works out when to leave for a block's next (or given) occurrence. Origin choice: a temporary shared
 * location wins, then the block's own origin, then the current origin. Uses the 3-minute route cache
 * unless force is set. If the live route fails, it falls back to a fixed 30-minute estimate and returns
 * live=false with fallbackReason so the message can say the timing is not live.
 */
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
  const currentOrigin = await currentStudyOrigin(workspace);
  const originReference = currentOrigin?.temporary
    ? currentOrigin.id
    : block.defaultOriginId ?? currentOrigin?.id;
  const cacheKey = `${workspace.id}:${block.id}:${originReference ?? "current"}:${block.destinationStopId}`;
  let journey: StudyJourneyEstimate | undefined;
  let fallbackReason: string | undefined;
  if (!options.force) {
    const cached = routeCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) journey = cached.value;
  }
  if (!journey) {
    try {
      journey = block.venueId
        ? await estimateStudyJourney(workspace, block.venueId, originReference)
        : await estimateStudyJourneyByStops(workspace, block.destinationStopId, originReference);
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
        freshness: "fallback",
        updatedAt: new Date(),
        live: false,
      };
    }
  }
  const leaveAt = computeStudyLeaveAt(startsAt, journey.totalMinutes, block.travelBufferMinutes);
  return {
    block,
    startsAt,
    leaveAt,
    journey: { ...journey, leaveBufferMinutes: block.travelBufferMinutes },
    live: Boolean(journey.live) && !fallbackReason,
    fallbackReason,
  };
}

/** Leave time = start minus (journey minutes, or 30 if unknown) minus the block's buffer. */
export function computeStudyLeaveAt(startsAt: Date, totalMinutes: number | undefined, travelBufferMinutes: number): Date {
  const travelMinutes = Math.max(1, totalMinutes ?? FALLBACK_JOURNEY_MINUTES) + Math.max(0, travelBufferMinutes);
  return new Date(startsAt.getTime() - travelMinutes * 60_000);
}

/** Mutes travel reminders until the end of the local day and marks today's pending travel states MUTED. */
export async function muteStudyTravelForToday(workspace: StudyWorkspace, now = new Date()): Promise<Date> {
  const until = DateTime.fromJSDate(now).setZone(workspace.timezone).endOf("day").toUTC().toJSDate();
  const localDate = DateTime.fromJSDate(now).setZone(workspace.timezone).toISODate();
  const occurrenceDate = localDate ? new Date(`${localDate}T00:00:00.000Z`) : now;
  // The cast keeps local development usable when another running process has
  // Windows' generated Prisma client locked. Render regenerates from schema.
  await prisma.studyWorkspace.update({ where: { id: workspace.id }, data: { travelMutedUntil: until } as never });
  await prisma.studyTravelReminderState.updateMany({
    where: { workspaceId: workspace.id, occurrenceDate, status: { in: ["READY", "PENDING"] } },
    data: { status: "MUTED", mutedAt: now },
  });
  await auditOrigin(workspace, "study.travel.muted", workspace.id, { until: until.toISOString() });
  return until;
}

/** Records arrival for today's occurrence of a block (upsert, so it works even before any reminder was sent). */
export async function markStudyTravelArrived(workspace: StudyWorkspace, blockId: string, now = new Date()): Promise<void> {
  const localDate = DateTime.fromJSDate(now).setZone(workspace.timezone).toISODate();
  const occurrenceDate = localDate ? new Date(`${localDate}T00:00:00.000Z`) : now;
  await prisma.studyTravelReminderState.upsert({
    where: { blockId_occurrenceDate: { blockId, occurrenceDate } },
    update: { status: "ARRIVED", arrivedAt: now },
    create: { workspaceId: workspace.id, blockId, occurrenceDate, status: "ARRIVED", arrivedAt: now },
  });
  await auditOrigin(workspace, "study.travel.arrived", blockId, { occurrenceDate: occurrenceDate.toISOString() });
}

export async function resumeStudyTravelReminders(workspace: StudyWorkspace): Promise<void> {
  await prisma.studyWorkspace.update({ where: { id: workspace.id }, data: { travelMutedUntil: null } as never });
  await auditOrigin(workspace, "study.travel.resumed", workspace.id, {});
}

export function isStudyTravelMuted(workspace: StudyWorkspace, now = new Date()): boolean {
  const mutedUntil = (workspace as StudyWorkspace & { travelMutedUntil?: Date | null }).travelMutedUntil;
  return Boolean(mutedUntil && mutedUntil > now);
}

/**
 * Creates or updates an origin by its name (names are unique per workspace), then optionally makes it
 * the default or activates it. Re-saving a deleted name reactivates it. Audited.
 */
async function saveStudyOrigin(workspace: StudyWorkspace, input: {
  name: string;
  providerVenueId?: string;
  providerStopId: string;
  latitude: number;
  longitude: number;
  makeDefault?: boolean;
  activateHours?: number;
  temporary?: boolean;
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
        temporary: input.temporary ?? false,
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
        temporary: input.temporary ?? false,
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

/** Finds an active origin in this workspace by case-insensitive name or id. */
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

/** Next future start of a weekly block within its start/end academic weeks, searching up to 52 weeks ahead. */
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

/**
 * Converts a provider directions response into a StudyJourneyEstimate. Prefers the first direct
 * alternative, then a "walk to another stop" recommendation, then the plain journey. Adds walking time
 * from the origin and to the final place. The result counts as live only when a real wait time exists.
 */
function journeyEstimate(origin: StudyLocationOrigin, destinationStop: TransitStop, result: JourneySearchResponse, place?: StudyPlace): StudyJourneyEstimate {
  const originCoordinates = origin.latitude !== null && origin.longitude !== null
    ? { latitude: origin.latitude, longitude: origin.longitude }
    : undefined;
  const finishWalk = place ? walkingMinutes(distanceMetres(destinationStop.coordinates, place.coordinates)) : 0;
  const common = (journey: Journey, firstWalk: number, wait: number | undefined, ride: number) => ({
    destinationPlace: place,
    alightStop: journey.toStop,
    legs: journey.legs.map((leg) => ({ ...leg, stops: leg.stops ?? [] })),
    transfers: journey.transfers,
    firstWalkMinutes: firstWalk,
    finalWalkMinutes: finishWalk,
    walkMinutes: firstWalk + finishWalk,
    totalMinutes: firstWalk + (wait ?? 0) + ride + finishWalk,
    freshness: journey.freshness ?? "estimated",
    updatedAt: new Date(),
    live: wait !== undefined,
  });
  const direct = result.alternatives[0];
  if (direct) {
    const wait = direct.liveWaitMinutes ?? undefined;
    const firstWalk = originCoordinates ? walkingMinutes(distanceMetres(originCoordinates, direct.journey.fromStop.coordinates)) : 0;
    return {
      origin,
      destinationStop,
      boardingStop: direct.journey.fromStop,
      services: direct.journey.legs.map((leg) => leg.service),
      waitMinutes: wait,
      rideMinutes: direct.estimatedRideMinutes,
      leaveBufferMinutes: 15,
      message: result.message,
      ...common(direct.journey, firstWalk, wait, direct.estimatedRideMinutes),
      alternatives: result.alternatives.slice(1, 4).map((alternative) => alternativeEstimate(origin, place, alternative)),
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
      rideMinutes: ride,
      leaveBufferMinutes: 15,
      message: result.message,
      ...common(recommendation.journey, recommendation.estimatedWalkMinutes, wait, ride),
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
      leaveBufferMinutes: 15,
      message: result.message,
      ...common(result.journey, originCoordinates ? walkingMinutes(distanceMetres(originCoordinates, result.journey.fromStop.coordinates)) : 0, wait, ride),
    };
  }
  throw new StudyModeError(result.message || "Improved NextBus could not find a usable route.", "not_found");
}

/** Rough ride time when the provider gives none: about 3 minutes per stop, at least 5 minutes. */
function estimatedRideMinutes(journey: Journey): number {
  return Math.max(5, journey.legs.reduce((sum, leg) => sum + Math.max(1, (leg.stops?.length ?? 2) - 1) * 3, 0));
}

/**
 * Plans a ride between two stops (v1 POST /journeys). With the origin's own coordinates the provider
 * also ranks nearby stops worth walking to. Alternatives come back ranked best-first.
 */
async function planStopJourney(origin: StudyLocationOrigin, toStopId: string): Promise<JourneySearchResponse> {
  const data = await transitRequest<JourneySearchResponse>("journeys", {
    body: {
      origin: { kind: "stop", id: origin.providerStopId },
      destination: { kind: "stop", id: toStopId },
      ...(origin.latitude !== null && origin.longitude !== null
        ? { originCoordinates: { latitude: origin.latitude, longitude: origin.longitude } }
        : {}),
    },
  });
  return {
    journey: data.journey ?? null,
    alternatives: (data.alternatives ?? []).filter((alternative) => alternative.journey),
    recommendations: (data.recommendations ?? []).filter((recommendation) => recommendation.journey),
    message: data.message ?? "",
  };
}

/**
 * The only HTTP call to Improved NextBus (v1, under /api/v1 on STUDY_TRANSIT_BASE_URL): GET with
 * `query`, or POST with a JSON `body`. Unwraps the `{ data, meta }` envelope, reads `{ error }`
 * failures and Retry-After on 429, sends the optional STUDY_TRANSIT_API_KEY, enforces the configured
 * timeout, and turns every failure into a user-facing StudyModeError.
 */
async function transitRequest<T>(path: string, options: { query?: Record<string, string>; body?: unknown } = {}): Promise<T> {
  const url = new URL(`/api/v1/${path.replace(/^\//, "")}`, env.STUDY_TRANSIT_BASE_URL);
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (env.STUDY_TRANSIT_API_KEY) headers.Authorization = `Bearer ${env.STUDY_TRANSIT_API_KEY}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.STUDY_EXTERNAL_REQUEST_TIMEOUT_MS);
  timeout.unref?.();
  try {
    const response = await fetch(url, {
      method: options.body === undefined ? "GET" : "POST",
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: controller.signal,
    });
    const value = await response.json().catch(() => ({})) as { data?: T; error?: { code?: string; message?: string } };
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after"));
      throw new StudyModeError(`Improved NextBus is busy. Try again in ${Number.isFinite(retryAfter) && retryAfter > 0 ? `${retryAfter} seconds` : "a minute"}.`, "invalid");
    }
    if (!response.ok) throw new Error(value.error?.message || `Improved NextBus returned ${response.status}.`);
    if (value.data === undefined) throw new Error("Improved NextBus sent an unexpected response.");
    return value.data;
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

/** Straight-line distance in metres (haversine formula). */
function distanceMetres(a: TransitCoordinates, b: TransitCoordinates): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const deltaLat = radians(b.latitude - a.latitude);
  const deltaLon = radians(b.longitude - a.longitude);
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Tries the three closest stops to a venue (one for a stop) in parallel and returns the fastest
 * route. A failed stop is skipped; an error is thrown only when every attempt fails.
 */
async function estimateJourneyToPlace(origin: StudyLocationOrigin, place: StudyPlace): Promise<StudyJourneyEstimate> {
  if (!origin.providerStopId) throw new StudyModeError("Add a travel origin first, then try the route again.", "invalid");
  const candidates = place.nearbyStops
    .slice()
    .sort((a, b) => a.distanceMetres - b.distanceMetres)
    .slice(0, place.kind === "stop" ? 1 : 3);
  if (!candidates.length) throw new StudyModeError(`${place.displayName} has no nearby NUS bus stop.`, "not_found");
  const searches = await Promise.allSettled(candidates.map(async (destinationStop) => {
    const response = await planStopJourney(origin, destinationStop.id);
    return journeyEstimate(origin, destinationStop, response, place);
  }));
  const viable = searches
    .filter((result): result is PromiseFulfilledResult<StudyJourneyEstimate> => result.status === "fulfilled")
    .map((result) => result.value)
    .sort((a, b) => (a.totalMinutes ?? Number.MAX_SAFE_INTEGER) - (b.totalMinutes ?? Number.MAX_SAFE_INTEGER));
  if (viable.length) return viable[0]!;
  const failure = searches.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failure?.reason instanceof Error) throw failure.reason;
  throw new StudyModeError("Improved NextBus could not find a usable route to that place.", "not_found");
}

/** Summarises a secondary route option with its own walking, waiting and riding totals. */
function alternativeEstimate(origin: StudyLocationOrigin, place: StudyPlace | undefined, value: JourneyAlternative): StudyJourneyAlternative {
  const wait = value.liveWaitMinutes ?? undefined;
  const originCoordinates = origin.latitude !== null && origin.longitude !== null
    ? { latitude: origin.latitude, longitude: origin.longitude }
    : value.journey.fromStop.coordinates;
  const firstWalkMinutes = walkingMinutes(distanceMetres(originCoordinates, value.journey.fromStop.coordinates));
  const finalWalkMinutes = place ? walkingMinutes(distanceMetres(value.journey.toStop.coordinates, place.coordinates)) : 0;
  return {
    services: value.journey.legs.map((leg) => leg.service),
    boardingStop: value.journey.fromStop,
    alightStop: value.journey.toStop,
    waitMinutes: wait,
    rideMinutes: value.estimatedRideMinutes,
    firstWalkMinutes,
    finalWalkMinutes,
    totalMinutes: firstWalkMinutes + (wait ?? 0) + value.estimatedRideMinutes + finalWalkMinutes,
  };
}

/** Walking time at about 75 metres per minute, rounded up. */
function walkingMinutes(metres: number): number {
  return Math.max(0, Math.ceil(metres / 75));
}

/** Normalized names a place answers to, plus any local nickname that points at one of them. */
function placeAliases(...values: Array<string | null | undefined>): string[] {
  const aliases = new Set(values.filter((value): value is string => Boolean(value)).map(normalizePlaceText));
  for (const [alias, target] of Object.entries(STUDY_PLACE_ALIASES)) {
    if ([...aliases].includes(normalizePlaceText(target))) aliases.add(alias);
  }
  return [...aliases];
}

function venueToPlace(detail: TransitVenueDetail): StudyPlace {
  return {
    id: `venue:${detail.id}`,
    providerId: detail.id,
    kind: "venue",
    displayName: detail.name,
    subtitle: "Campus venue",
    aliases: placeAliases(detail.name, detail.id),
    coordinates: detail.coordinates,
    nearbyStops: detail.nearbyStops.map((stop) => ({ ...stop, walkMinutes: walkingMinutes(stop.distanceMetres) })),
  };
}

function stopToPlace(stop: TransitStop): StudyPlace {
  return {
    id: `stop:${stop.id}`,
    providerId: stop.id,
    kind: "stop",
    displayName: stop.title,
    subtitle: [stop.shortLabel, stop.busStopCode, stop.subtitle].filter(Boolean).join(" · ") || "NUS bus stop",
    aliases: placeAliases(stop.title, stop.id, stop.shortLabel, stop.busStopCode),
    coordinates: stop.coordinates,
    nearbyStops: [{ ...stop, distanceMetres: 0, walkMinutes: 0 }],
  };
}

function normalizePlaceText(value: string): string {
  return value.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Lower is better: 0 exact, 1 prefix, 1.5 query starts with name, 2 all words present, 3 substring, 100 no match. */
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
