import { afterEach, describe, expect, it, vi } from "vitest";
import { computeStudyLeaveAt, isStudyTravelMuted, normalizeStudyPlaceQuery, searchStudyOriginPlaces } from "./studyTransit";

describe("study travel timing", () => {
  afterEach(() => vi.unstubAllGlobals());
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
      id: "stop-pgp",
      title: "Prince George's Park",
    })]);
  });
});
