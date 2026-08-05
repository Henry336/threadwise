import type { StudyLocationOrigin, StudyWorkspace } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { StudyModeError } from "./study";

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

export async function resolveStudyVenue(query: string): Promise<TransitVenueDetail> {
  const venues = await searchStudyVenues(query, 8);
  if (venues.length === 0) throw new StudyModeError(`I couldn't find a campus venue matching “${query.trim()}”.`, "not_found");
  const normalized = query.trim().toLowerCase();
  const exact = venues.find((venue) => venue.id.toLowerCase() === normalized || venue.name.toLowerCase() === normalized);
  return getStudyVenue((exact ?? venues[0]!).id);
}

export async function addStudyOriginFromVenue(
  workspace: StudyWorkspace,
  name: string,
  venueQuery: string,
  options: { makeDefault?: boolean; activateHours?: number } = {},
): Promise<StudyLocationOrigin> {
  const venue = await resolveStudyVenue(venueQuery);
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
