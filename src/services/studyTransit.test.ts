import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../db/prisma";
import {
  buildStudyDeparturePlan,
  computeStudyLeaveAt,
  estimateStudyJourney,
  isStudyTravelMuted,
  normalizeStudyPlaceQuery,
  searchStudyOriginPlaces,
} from "./studyTransit";

describe("study travel timing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it("subtracts the live journey and configured buffer from class time", () => {
    const starts = new Date("2026-08-05T06:00:00.000Z");
    expect(computeStudyLeaveAt(starts, 27, 15).toISOString()).toBe("2026-08-05T05:18:00.000Z");
  });

  it("uses a stable 30 minute fallback when live duration is unavailable", () => {
    const starts = new Date("2026-08-05T06:00:00.000Z");
    expect(computeStudyLeaveAt(starts, undefined, 10).toISOString()).toBe("2026-08-05T05:20:00.000Z");
  });

  it("treats a mute as active only until its expiry", () => {
    const workspace = { travelMutedUntil: new Date("2026-08-05T16:00:00.000Z") } as never;
    expect(isStudyTravelMuted(workspace, new Date("2026-08-05T12:00:00.000Z"))).toBe(true);
    expect(isStudyTravelMuted(workspace, new Date("2026-08-06T00:00:00.000Z"))).toBe(false);
  });

  it("normalises common campus aliases before venue and stop search", () => {
    expect(normalizeStudyPlaceQuery("PGPR")).toBe("PGP");
    expect(normalizeStudyPlaceQuery("Prince George's Park Residence")).toBe("PGP");
    expect(normalizeStudyPlaceQuery("Kent Ridge MRT station")).toBe("Kent Ridge MRT");
  });

  it("falls back to selectable direct bus-stop matches", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      return new Response(JSON.stringify(url.includes("/api/stops") ? {
        stops: [{
          id: "stop-pgp",
          title: "Prince George's Park",
          shortLabel: "PGP",
          busStopCode: "PGP",
          coordinates: { latitude: 1.2901, longitude: 103.7812 },
        }],
      } : { venues: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    await expect(searchStudyOriginPlaces("PGPR")).resolves.toEqual([expect.objectContaining({
      kind: "stop",
      id: "stop:stop-pgp",
      title: "Prince George's Park",
    })]);
  });

  it("keeps first-mile, transfers, last-mile, and live freshness in a place route", async () => {
    vi.spyOn(prisma.studyLocationOrigin, "findFirst").mockResolvedValue({
      id: "origin-1",
      workspaceId: "study-1",
      name: "Home",
      providerVenueId: null,
      providerStopId: "PGP",
      latitude: 1.2901,
      longitude: 103.7812,
      isDefault: true,
      temporary: false,
      active: true,
      displayOrder: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes("/api/venues/COM3")) return Response.json({
        id: "COM3",
        name: "COM3",
        coordinates: { latitude: 1.2948, longitude: 103.7736 },
        nearbyStops: [{ id: "COM3-STOP", title: "COM 3", coordinates: { latitude: 1.294, longitude: 103.773 }, distanceMetres: 120 }],
      });
      if (url.includes("/api/directions")) return Response.json({
        journey: null,
        alternatives: [{
          journey: {
            fromStop: { id: "PGP", title: "Prince George's Park", coordinates: { latitude: 1.2901, longitude: 103.7812 } },
            toStop: { id: "COM3-STOP", title: "COM 3", coordinates: { latitude: 1.294, longitude: 103.773 } },
            transfers: 1,
            status: "live",
            message: "Live route",
            legs: [
              { service: "R2", fromStop: { id: "PGP", title: "Prince George's Park", coordinates: { latitude: 1.2901, longitude: 103.7812 } }, toStop: { id: "HSSML", title: "Opp HSSML", coordinates: { latitude: 1.293, longitude: 103.776 } }, nextArrival: { minutes: 2, display: "2 min" } },
              { service: "D2", fromStop: { id: "HSSML", title: "Opp HSSML", coordinates: { latitude: 1.293, longitude: 103.776 } }, toStop: { id: "COM3-STOP", title: "COM 3", coordinates: { latitude: 1.294, longitude: 103.773 } }, nextArrival: { minutes: 5, display: "5 min" } },
            ],
          },
          liveWaitMinutes: 2,
          estimatedRideMinutes: 10,
          estimatedTotalMinutes: 14,
        }],
        recommendations: [],
        directAvailable: false,
        message: "Live route",
      });
      return new Response(null, { status: 404 });
    }));

    const journey = await estimateStudyJourney({ id: "study-1" } as never, "venue:COM3", "origin-1");
    expect(journey).toMatchObject({
      live: true,
      transfers: 1,
      services: ["R2", "D2"],
      firstWalkMinutes: 0,
      finalWalkMinutes: 2,
      totalMinutes: 14,
      freshness: "live",
    });
  });

  it("uses the normal 30-minute route estimate when the live provider fails", async () => {
    const origin = {
      id: "origin-1", workspaceId: "study-1", name: "Home", providerVenueId: null, providerStopId: "PGP",
      latitude: 1.29, longitude: 103.78, isDefault: true, temporary: false, active: true, displayOrder: 0,
      createdAt: new Date(), updatedAt: new Date(),
    };
    vi.spyOn(prisma.studyScheduleBlock, "findFirst").mockResolvedValue({
      id: "block-1", workspaceId: "study-1", moduleId: null, dayOfWeek: 3, startTime: "14:00", endTime: "16:00",
      label: "Lecture", blockType: "class", startWeek: 1, endWeek: 13, active: true, displayOrder: 0,
      venueId: "venue:COM3", venueName: "COM3", destinationStopId: "COM3-STOP", defaultOriginId: "origin-1",
      travelBufferMinutes: 15, createdAt: new Date(), updatedAt: new Date(), module: null, defaultOrigin: origin,
    } as never);
    vi.spyOn(prisma.studyWorkspace, "findUnique").mockResolvedValue({ activeOriginId: "origin-1", activeOriginUntil: new Date(Date.now() + 60_000) } as never);
    vi.spyOn(prisma.studyLocationOrigin, "findFirst").mockResolvedValue(origin);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "offline" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    })));

    const plan = await buildStudyDeparturePlan({ id: "study-1" } as never, "block-1", {
      startsAt: new Date("2026-08-12T06:00:00.000Z"),
      force: true,
    });
    expect(plan).toMatchObject({ live: false, journey: { totalMinutes: 30, freshness: "fallback" } });
    expect(plan.fallbackReason).toContain("offline");
  });
});
