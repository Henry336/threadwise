import { PlanningScope } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { groupAgendaEntries, type AgendaEntry } from "./dailyAgenda";

const entry = (overrides: Partial<AgendaEntry> & Pick<AgendaEntry, "id" | "title">): AgendaEntry => ({
  publicId: `TASK-${overrides.id}`,
  mode: "INDIVIDUAL",
  status: "OPEN",
  ...overrides,
});

describe("daily agenda grouping", () => {
  it("derives Today and carryover without duplicating or moving tasks", () => {
    const agenda = groupAgendaEntries([
      entry({ id: "1", title: "Today", plannedFor: "2026-08-31" }),
      entry({ id: "2", title: "Old", plannedFor: "2026-08-29", firstPlannedFor: "2026-08-29" }),
      entry({ id: "3", title: "Later", plannedFor: "2026-09-01" }),
      entry({ id: "4", title: "Someday" }),
    ], PlanningScope.PERSONAL, "Asia/Singapore", "2026-08-31", 3);

    expect(agenda.today.map((item) => item.id)).toEqual(["1"]);
    expect(agenda.carryover.map((item) => item.id)).toEqual(["2"]);
    expect(agenda.carryover[0]?.firstPlannedFor).toBe("2026-08-29");
    expect(agenda.unscheduledCount).toBe(1);
  });

  it("keeps overdue separate from the bounded deadline watch", () => {
    const agenda = groupAgendaEntries([
      entry({ id: "1", title: "Overdue", dueAt: "2026-08-30T12:00:00.000Z" }),
      entry({ id: "2", title: "Soon", dueAt: "2026-09-02T10:00:00.000Z" }),
      entry({ id: "3", title: "Later", dueAt: "2026-09-10T10:00:00.000Z" }),
    ], PlanningScope.PERSONAL, "Asia/Singapore", "2026-08-31", 3);

    expect(agenda.overdue.map((item) => item.id)).toEqual(["1"]);
    expect(agenda.dueSoon.map((item) => item.id)).toEqual(["2"]);
  });
});
