import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => {
  const aggregate = vi.fn(async () => ({ _count: 0, _max: { updatedAt: null } }));
  return { aggregate, user: vi.fn(), resource: vi.fn(async () => ({ _count: 0, _max: { updatedAt: null } })) };
});
vi.mock("../db/prisma", () => ({ prisma: {
  user: { findUnique: mock.user },
  task: { aggregate: mock.aggregate }, note: { aggregate: mock.aggregate }, idea: { aggregate: mock.aggregate },
  storedImage: { aggregate: mock.aggregate }, expense: { aggregate: mock.aggregate },
  availabilityPoll: { aggregate: mock.aggregate }, pendingTaskImport: { aggregate: mock.aggregate },
  studyResource: { aggregate: mock.resource }, studyCanvasSync: { findUnique: async () => null },
  auditLog: { aggregate: async () => ({ _count: 0, _max: { createdAt: null } }) },
} }));
import { dashboardRevision, subscribeDashboardChanges } from "./realtime";
let cleanup: Array<() => void>;
let study: Record<string, unknown>;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); cleanup = [];
  study = { id: "study", updatedAt: new Date(), lastReminderCheckAt: new Date(), semesterName: "Semester", calendarSyncStatus: "SYNCED" };
  mock.user.mockImplementation(async ({ select }) => ({
    id: "owner", updatedAt: new Date("2026-09-01"),
    // Prisma returns only selected fields: preserve this contract in the fake.
    studyWorkspace: Object.fromEntries(Object.keys(select.studyWorkspace.select).map((key) => [key, study[key]])),
  }));
});
afterEach(() => { cleanup.forEach((stop) => stop()); vi.useRealTimers(); });
describe("dashboard live-sync egress budget", () => {
  it("shares one watcher per owner and limits a visible hour to 121 checks including initial", async () => {
    cleanup.push(subscribeDashboardChanges("owner", vi.fn())); cleanup.push(subscribeDashboardChanges("owner", vi.fn()));
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(mock.user).toHaveBeenCalledTimes(121);
    expect(mock.aggregate).toHaveBeenCalledTimes(121 * 7);
    cleanup.forEach((stop) => stop()); cleanup = [];
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(mock.user).toHaveBeenCalledTimes(121);
  });
  it("ignores diagnostic-only writes but detects semantic settings and Calendar status changes", async () => {
    const before = await dashboardRevision("owner");
    study.updatedAt = new Date(Date.now() + 60_000); study.lastReminderCheckAt = study.updatedAt;
    expect(await dashboardRevision("owner")).toBe(before);
    study.semesterName = "Updated semester";
    const changed = await dashboardRevision("owner"); expect(changed).not.toBe(before);
    study.calendarSyncStatus = "FAILED"; expect(await dashboardRevision("owner")).not.toBe(changed);
    expect(changed).toMatch(/^[a-f0-9]{64}$/u); // No workspace settings in SSE payloads.
  });
  it("does not overlap slow revision checks", async () => {
    let release!: (value: unknown) => void;
    mock.user.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    cleanup.push(subscribeDashboardChanges("slow", vi.fn()));
    await vi.advanceTimersByTimeAsync(90_000); expect(mock.user).toHaveBeenCalledTimes(1);
    release({ id: "owner", updatedAt: new Date("2026-09-01") });
    await vi.advanceTimersByTimeAsync(30_000); expect(mock.user).toHaveBeenCalledTimes(2);
  });
});
