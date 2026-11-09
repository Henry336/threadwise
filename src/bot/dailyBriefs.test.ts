import { DailyBriefDeliveryStatus, DailyBriefKind, PlanningScope } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { settings } from "../test/builders";

const mocks = vi.hoisted(() => ({
  agenda: vi.fn(),
  claim: vi.fn(),
  finish: vi.fn(),
  completions: vi.fn(),
}));

vi.mock("../services/dailyAgenda", async (original) => ({
  ...await original<typeof import("../services/dailyAgenda")>(),
  getDailyAgenda: mocks.agenda,
  claimDailyBriefDelivery: mocks.claim,
  finishDailyBriefDelivery: mocks.finish,
  countDailyAgendaCompletions: mocks.completions,
}));

import { formatMorningBrief, runDailyBriefPass } from "./dailyBriefs";

const agenda = {
  localDate: "2026-08-31",
  timezone: "Asia/Singapore",
  scope: PlanningScope.PERSONAL,
  orderRevision: 0,
  reorderable: true,
  today: [{ id: "task-1", publicId: "TASK-1", title: "Prepare tutorial", mode: "INDIVIDUAL" as const, plannedFor: "2026-08-31", status: "OPEN" }],
  carryover: [{ id: "task-2", publicId: "TASK-2", title: "Return book", mode: "GROUP" as const, workspaceName: "Project", plannedFor: "2026-08-30", firstPlannedFor: "2026-08-30", status: "OPEN" }],
  dueSoon: [{ id: "study-1", publicId: "STUDY-1", title: "Submit quiz", mode: "STUDY" as const, moduleCode: "CS2102", dueAt: "2026-09-01T10:00:00.000Z", status: "OPEN" }],
  overdue: [],
  unscheduledCount: 0,
};

describe("private daily brief delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.agenda.mockResolvedValue(agenda);
    mocks.claim.mockResolvedValue({ claimed: true, delivery: { id: "delivery-1", status: DailyBriefDeliveryStatus.PENDING } });
    mocks.finish.mockResolvedValue({});
    mocks.completions.mockResolvedValue(2);
  });

  it("delivers one bounded cross-mode morning brief with a private carryover decision", async () => {
    const sendMessage = vi.fn(async () => ({ message_id: 1 }));
    const database = { userSettings: { findMany: vi.fn(async () => [{
      ...settings({ reminderChatId: "123", morningBriefEnabled: true }),
      user: { id: "user-1", telegramId: "123" },
    }]) }, dailyBriefDelivery: { findUnique: vi.fn(async () => null) } } as never;
    const summary = await runDailyBriefPass({ api: { sendMessage } } as never, "123", new Date("2026-08-31T00:05:00.000Z"), database);
    expect(summary).toMatchObject({ checked: 1, sent: 1, failed: 0 });
    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({ kind: DailyBriefKind.MORNING, scope: PlanningScope.PERSONAL, scopeKey: "private-cross-mode" }), database);
    expect(sendMessage).toHaveBeenCalledWith("123", expect.stringContaining("Good morning"), expect.objectContaining({
      reply_markup: expect.objectContaining({ inline_keyboard: expect.arrayContaining([
        expect.arrayContaining([expect.objectContaining({ callback_data: "td:private-carry-prompt:task-2" })]),
      ]) }),
    }));
    expect(mocks.finish).toHaveBeenCalledWith("delivery-1", { status: DailyBriefDeliveryStatus.SENT }, database);
  });

  it("does not interrupt during quiet hours", async () => {
    const sendMessage = vi.fn();
    const database = { userSettings: { findMany: vi.fn(async () => [{
      ...settings({ reminderChatId: "123", morningBriefEnabled: true, morningBriefTime: "07:00" }),
      user: { id: "user-1", telegramId: "123" },
    }]) } } as never;
    const summary = await runDailyBriefPass({ api: { sendMessage } } as never, "123", new Date("2026-08-30T23:05:00.000Z"), database);
    expect(summary).toEqual({ checked: 1, sent: 0, skipped: 0, failed: 0 });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("skips a completely empty morning instead of sending noise", () => {
    expect(formatMorningBrief({ ...agenda, today: [], carryover: [], dueSoon: [] })).toBeUndefined();
  });

  it("does not send when the owner has no established private bot chat", async () => {
    const sendMessage = vi.fn();
    const database = { userSettings: { findMany: vi.fn(async () => [{
      ...settings({ quietHoursStart: null, quietHoursEnd: null, morningBriefEnabled: true }),
      user: { id: "user-1", telegramId: "123" },
    }]) } } as never;
    await expect(runDailyBriefPass({ api: { sendMessage } } as never, "123", new Date("2026-08-31T00:05:00.000Z"), database))
      .resolves.toEqual({ checked: 0, sent: 0, skipped: 0, failed: 0 });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("does not select an owner whose briefings are disabled", async () => {
    const findMany = vi.fn(async () => []);
    const sendMessage = vi.fn();
    await expect(runDailyBriefPass({ api: { sendMessage } } as never, "123", new Date("2026-08-31T00:05:00.000Z"), {
      userSettings: { findMany },
    } as never)).resolves.toEqual({ checked: 0, sent: 0, skipped: 0, failed: 0 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ OR: [{ morningBriefEnabled: true }, { eveningDebriefEnabled: true }] }),
    }));
    expect(sendMessage).not.toHaveBeenCalled();
  });

  /** A settings fake plus a delivery ledger that remembers each claimed (date, kind) key. */
  function briefDatabase(overrides: Parameters<typeof settings>[0]) {
    const claimed = new Set<string>();
    mocks.claim.mockImplementation(async (input: { localDate: Date; kind: string }) => {
      claimed.add(`${input.localDate.toISOString()}|${input.kind}`);
      return { claimed: true, delivery: { id: "delivery-1", status: DailyBriefDeliveryStatus.PENDING } };
    });
    const findUnique = vi.fn(async ({ where }: { where: { recipientTelegramId_localDate_kind_scopeKey: { localDate: Date; kind: string } } }) => {
      const key = where.recipientTelegramId_localDate_kind_scopeKey;
      return claimed.has(`${key.localDate.toISOString()}|${key.kind}`) ? { id: "delivery-1" } : null;
    });
    const database = {
      userSettings: { findMany: vi.fn(async () => [{
        ...settings({ reminderChatId: "123", quietHoursStart: null, quietHoursEnd: null, morningBriefEnabled: true, ...overrides }),
        user: { id: "user-1", telegramId: "123" },
      }]) },
      dailyBriefDelivery: { findUnique },
    } as never;
    return { database, findUnique };
  }

  it("sends a local-day brief once across repeated polling and a DST overlap, without rebuilding it", async () => {
    const sendMessage = vi.fn(async () => ({ message_id: 1 }));
    const { database } = briefDatabase({ timezone: "America/New_York", morningBriefTime: "01:00" });

    await runDailyBriefPass({ api: { sendMessage } } as never, "123", new Date("2026-11-01T05:05:00.000Z"), database);
    await runDailyBriefPass({ api: { sendMessage } } as never, "123", new Date("2026-11-01T06:05:00.000Z"), database);

    expect(mocks.claim).toHaveBeenCalledTimes(1);
    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({ localDate: new Date("2026-11-01T00:00:00.000Z") }), database);
    expect(mocks.agenda).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("records the Singapore calendar day, not the UTC day before it", async () => {
    const sendMessage = vi.fn(async () => ({ message_id: 1 }));
    const { database, findUnique } = briefDatabase({ timezone: "Asia/Singapore", morningBriefTime: "08:00" });

    // 08:05 on 10 November in Singapore is 00:05 UTC the same day; local midnight is 9 November 16:00 UTC.
    await runDailyBriefPass({ api: { sendMessage } } as never, "123", new Date("2026-11-10T00:05:00.000Z"), database);

    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { recipientTelegramId_localDate_kind_scopeKey: expect.objectContaining({ localDate: new Date("2026-11-10T00:00:00.000Z") }) },
    }));
    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({ localDate: new Date("2026-11-10T00:00:00.000Z") }), database);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
