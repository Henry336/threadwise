import { DailyBriefDeliveryStatus, DailyBriefKind, PlanningScope } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
      user: { id: "user-1", telegramId: "123" }, reminderChatId: null, timezone: "Asia/Singapore",
      quietHoursStart: "22:00", quietHoursEnd: "08:00",
      morningBriefEnabled: true, morningBriefTime: "08:00",
      eveningDebriefEnabled: false, eveningDebriefTime: "21:00",
    }]) } } as never;
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
      user: { id: "user-1", telegramId: "123" }, reminderChatId: null, timezone: "Asia/Singapore",
      quietHoursStart: "22:00", quietHoursEnd: "08:00",
      morningBriefEnabled: true, morningBriefTime: "07:00",
      eveningDebriefEnabled: false, eveningDebriefTime: "21:00",
    }]) } } as never;
    const summary = await runDailyBriefPass({ api: { sendMessage } } as never, "123", new Date("2026-08-30T23:05:00.000Z"), database);
    expect(summary).toEqual({ checked: 1, sent: 0, skipped: 0, failed: 0 });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("skips a completely empty morning instead of sending noise", () => {
    expect(formatMorningBrief({ ...agenda, today: [], carryover: [], dueSoon: [] })).toBeUndefined();
  });
});
