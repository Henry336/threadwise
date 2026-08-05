import { describe, expect, it } from "vitest";
import { computeStudyLeaveAt, isStudyTravelMuted } from "./studyTransit";

describe("study travel timing", () => {
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
});
