import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    studyWorkspace: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    studyScheduleBlock: { findMany: vi.fn(), findUnique: vi.fn() },
    studyScheduleCalendarLink: { findMany: vi.fn(), updateMany: vi.fn(), createMany: vi.fn(), count: vi.fn(), groupBy: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(),
  },
  upsert: vi.fn(), remove: vi.fn(), connection: vi.fn(),
}));
vi.mock("../db/prisma", () => ({ prisma: mocks.db }));
vi.mock("./googleCalendar", () => ({
  calendarConfigured: () => true,
  calendarConnectionStatus: mocks.connection,
  upsertStudyEventInGoogleCalendar: mocks.upsert,
  removeStudyEventFromGoogleCalendar: mocks.remove,
}));
import { runPendingStudyCalendarSyncs, studyCalendarSnapshot } from "./studyCalendar";
import type { StudyWorkspace } from "@prisma/client";

type Row = Record<string, any>;
const epoch = new Date("2026-09-12T10:00:00Z");
let workspace: Row;
let blocks: Row[];
let links: Row[];
let bulkQueues: number;

// Interpret the actual Prisma predicates, including due-time and version guards.
// Every DB call advances time: frozen zero-latency mocks hide the original bug.
function tick() { vi.setSystemTime(new Date(Date.now() + 10)); }
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return value.some((entry: Row) => matches(row, entry));
    if (key === "workspace") return matches(workspace, value);
    if (key === "calendarLink") return value === null && !links.some((link) => link.blockId === row.id);
    const actual = row[key];
    if (value instanceof Date) return actual?.getTime() === value.getTime();
    if (value && typeof value === "object") {
      return Object.entries(value).every(([op, wanted]: [string, any]) => {
        if (op === "in") return wanted.includes(actual);
        if (op === "lte") return actual != null && actual <= wanted;
        if (op === "lt") return actual < wanted;
        throw new Error(`Unhandled predicate ${op}`);
      });
    }
    return actual === value;
  });
}
function update(row: Row, data: Row) {
  for (const [key, value] of Object.entries(data)) if (value !== undefined) row[key] = value;
  row.updatedAt = new Date();
}
function seed(count = 49, status = "SYNCED") {
  workspace = {
    id: "workspace", ownerUserId: "owner", calendarSyncEnabled: true, calendarSyncStatus: "SYNCED",
    calendarLastSuccessfulAt: new Date(epoch.getTime() - 60 * 60_000), timezone: "Asia/Singapore",
    semesterStartDate: new Date("2026-09-07"),
  };
  blocks = Array.from({ length: count }, (_, index) => ({
    id: `block-${index}`, workspaceId: "workspace", active: true, dayOfWeek: 1,
    label: "Synthetic block", startTime: "10:00", endTime: "11:00", startWeek: 1, endWeek: 13,
    excludedDates: [], excludedWeeks: [], module: null,
  }));
  links = blocks.map((block) => ({
    id: `link-${block.id}`, blockId: block.id, eventId: `event-${block.id}`, workspaceId: "workspace",
    status, operation: "UPSERT", attemptCount: 0, nextAttemptAt: null, updatedAt: new Date(epoch.getTime() - 60_000),
  }));
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(epoch); vi.resetAllMocks(); seed(); bulkQueues = 0;
  mocks.connection.mockResolvedValue({ connected: true, reconnectRequired: false });
  mocks.upsert.mockImplementation(async (_owner, input) => ({ eventUrl: "https://example.test/event", eventId: input.eventId }));
  mocks.remove.mockResolvedValue(undefined);
  mocks.db.$transaction.mockImplementation(async (callback) => callback(mocks.db));
  mocks.db.studyWorkspace.findMany.mockImplementation(async ({ where }) => { tick(); return matches(workspace, where) ? [{ ...workspace }] : []; });
  mocks.db.studyWorkspace.findUnique.mockImplementation(async () => { tick(); return { ...workspace }; });
  mocks.db.studyWorkspace.updateMany.mockImplementation(async ({ where, data }) => {
    tick(); if (!matches(workspace, where)) return { count: 0 }; update(workspace, data); return { count: 1 };
  });
  mocks.db.studyScheduleBlock.findMany.mockImplementation(async ({ where }) => { tick(); return blocks.filter((block) => matches(block, where)); });
  mocks.db.studyScheduleBlock.findUnique.mockImplementation(async ({ where }) => { tick(); return blocks.find((block) => block.id === where.id); });
  mocks.db.studyScheduleCalendarLink.findMany.mockImplementation(async ({ where, distinct, take }) => {
    tick(); const found = links.filter((link) => matches(link, where)).map((link) => ({ ...link }));
    return distinct ? [...new Set(found.map((link) => link.workspaceId))].slice(0, take).map((workspaceId) => ({ workspaceId })) : found.slice(0, take);
  });
  mocks.db.studyScheduleCalendarLink.updateMany.mockImplementation(async ({ where, data }) => {
    tick(); const found = links.filter((link) => matches(link, where));
    if (where.status === "SYNCED") bulkQueues++;
    found.forEach((link) => update(link, data)); return { count: found.length };
  });
  mocks.db.studyScheduleCalendarLink.createMany.mockImplementation(async ({ data }) => {
    tick(); data.forEach((entry: Row) => { if (!links.some((link) => link.blockId === entry.blockId)) links.push({
      id: `link-${entry.blockId}`, attemptCount: 0, updatedAt: new Date(), ...entry,
    }); }); return { count: data.length };
  });
  mocks.db.studyScheduleCalendarLink.count.mockImplementation(async ({ where }) => { tick(); return links.filter((link) => matches(link, where)).length; });
  mocks.db.studyScheduleCalendarLink.groupBy.mockImplementation(async ({ where, by }) => {
    const found = links.filter((link) => matches(link, where));
    const groups = new Map<string, Row>();
    for (const link of found) {
      const key = by.map((field: string) => link[field]).join(":");
      const group = groups.get(key) ?? { status: link.status, attemptCount: link.attemptCount, _count: { _all: 0 } };
      group._count._all++; groups.set(key, group);
    }
    return [...groups.values()];
  });
});
afterEach(() => vi.useRealTimers());

describe("Study Calendar durable queue lifecycle", () => {
  it("drains all 49 links across delayed scheduler passes without requeue churn", async () => {
    for (let pass = 0; pass < 7; pass++) {
      await runPendingStudyCalendarSyncs(new Date());
      vi.setSystemTime(new Date(epoch.getTime() + (pass + 1) * 60_000));
    }
    expect(mocks.upsert).toHaveBeenCalledTimes(49);
    expect(bulkQueues).toBe(1);
    expect(links.every((link) => link.status === "SYNCED")).toBe(true);
    expect(workspace.calendarSyncStatus).toBe("SYNCED");
    await runPendingStudyCalendarSyncs(new Date());
    expect(mocks.upsert).toHaveBeenCalledTimes(49);
  });

  it("recovers the production-shaped false-SYNCED workspace without changing pending due times", async () => {
    seed(49, "PENDING");
    links.forEach((link) => { link.nextAttemptAt = new Date(epoch.getTime() - 1_000); });
    await runPendingStudyCalendarSyncs(epoch);
    expect(mocks.upsert).toHaveBeenCalledTimes(8);
    expect(links[8]!.nextAttemptAt).toEqual(new Date(epoch.getTime() - 1_000));
    expect(workspace.calendarSyncStatus).toBe("PENDING");
  });

  it("preserves failed-job backoff and exhausts after six attempts without retrying forever", async () => {
    seed(1, "FAILED"); links[0]!.attemptCount = 5;
    links[0]!.nextAttemptAt = new Date(epoch.getTime() + 60_000);
    mocks.upsert.mockRejectedValue(new Error("provider unavailable"));
    await runPendingStudyCalendarSyncs(epoch);
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(links[0]!.attemptCount).toBe(5);
    vi.setSystemTime(new Date(epoch.getTime() + 60_000));
    await runPendingStudyCalendarSyncs(new Date());
    expect(links[0]!.attemptCount).toBe(6);
    expect(workspace.calendarSyncStatus).toBe("FAILED");
    expect(workspace.calendarLastError).toContain("Sync now");
    vi.setSystemTime(new Date(epoch.getTime() + 120 * 60_000));
    await runPendingStudyCalendarSyncs(new Date());
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
  });

  it("does not settle a newer edit queued while Google is responding", async () => {
    seed(1, "PENDING"); workspace.calendarSyncStatus = "PENDING";
    mocks.upsert.mockImplementationOnce(async () => { tick(); update(links[0]!, { status: "PENDING" }); return { eventUrl: "https://example.test/event" }; });
    await runPendingStudyCalendarSyncs(epoch);
    expect(links[0]!.status).toBe("PENDING");
    await runPendingStudyCalendarSyncs(new Date());
    expect(links[0]!.status).toBe("SYNCED");
  });

  it("coalesces overlapping scheduler drains instead of sending a duplicate provider request", async () => {
    seed(1, "PENDING"); workspace.calendarSyncStatus = "PENDING";
    let release!: () => void;
    mocks.upsert.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ eventUrl: "https://example.test/event" }); }));
    const first = runPendingStudyCalendarSyncs(epoch);
    await vi.waitFor(() => expect(mocks.upsert).toHaveBeenCalledTimes(1));
    const second = runPendingStudyCalendarSyncs(new Date());
    await Promise.resolve(); await Promise.resolve();
    release(); await Promise.all([first, second]);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
  });

  it("creates missing active links but never requeues already removed series", async () => {
    seed(2); links.splice(0, 1); blocks[1]!.active = false; links[0]!.status = "REMOVED";
    await runPendingStudyCalendarSyncs(epoch);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(workspace.calendarSyncStatus).toBe("SYNCED");
  });

  it("settles an empty workspace and does no work for disabled synchronization", async () => {
    seed(0); await runPendingStudyCalendarSyncs(epoch);
    expect(workspace.calendarSyncStatus).toBe("SYNCED");
    seed(1); workspace.calendarSyncEnabled = false;
    await runPendingStudyCalendarSyncs(epoch);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("reports pending counts rather than trusting a stale success flag", async () => {
    seed(1, "PENDING");
    const snapshot = await studyCalendarSnapshot(workspace as StudyWorkspace);
    expect(snapshot.status).toBe("PENDING"); expect(snapshot.pendingBlocks).toBe(1);
  });
});
