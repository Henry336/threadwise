import type { StudyScheduleBlock, StudyWorkspace } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { buildStudyCalendarEventInput, deterministicStudyEventId } from "./studyCalendar";

function workspace(overrides: Partial<StudyWorkspace> = {}): StudyWorkspace {
  return {
    id: "workspace-1",
    ownerUserId: "user-1",
    ownerTelegramId: "111",
    boundChatId: "-222",
    timezone: "Asia/Singapore",
    semesterStartDate: new Date("2026-09-07T00:00:00.000Z"),
    ...overrides,
  } as StudyWorkspace;
}

function block(overrides: Partial<StudyScheduleBlock> = {}) {
  return {
    id: "0c68a350-c061-4a86-a63f-842c132dc77d",
    workspaceId: "workspace-1",
    moduleId: null,
    dayOfWeek: 1,
    startTime: "14:00",
    endTime: "15:00",
    label: "Project studio",
    blockType: "class",
    customTypeLabel: null,
    startWeek: 1,
    endWeek: 4,
    venueId: null,
    venueName: "COM3-01-20",
    destinationStopId: null,
    preparation: [],
    defaultOriginId: null,
    travelBufferMinutes: 15,
    reminderLeadMinutes: 10,
    source: "MANUAL",
    sourceRef: null,
    recurrenceStartDate: null,
    recurrenceEndDate: null,
    excludedDates: [],
    excludedWeeks: [],
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    module: { code: "CS2103T", name: "Software Engineering" },
    ...overrides,
  } as StudyScheduleBlock & { module: { code: string; name: string } | null };
}

describe("Study Calendar identity", () => {
  it("derives a stable Google-compatible event id from the block series id", () => {
    const blockId = "0c68a350-c061-4a86-a63f-842c132dc77d";
    expect(deterministicStudyEventId(blockId)).toBe("st0c68a350c0614a86a63f842c132dc77d");
    expect(deterministicStudyEventId(blockId)).toBe(deterministicStudyEventId(blockId));
    expect(deterministicStudyEventId(blockId)).toMatch(/^[a-v0-9]{5,1024}$/u);
  });

  it("maps a weekly series and occurrence exclusions without exposing private travel data", () => {
    const input = buildStudyCalendarEventInput(workspace(), block({
      excludedWeeks: [2],
      excludedDates: [new Date("2026-09-21T00:00:00.000Z")],
    }), "stable-event-id");

    expect(input.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20260928T155959Z",
      "EXDATE;TZID=Asia/Singapore:20260921T140000",
      "EXDATE;TZID=Asia/Singapore:20260914T140000",
    ]);
    expect(input.details).toContain("Threadwise reference: study-block:0c68a350-c061-4a86-a63f-842c132dc77d");
    expect(JSON.stringify(input)).not.toMatch(/origin|coordinate|route|preparation/iu);
  });

  it("uses a single event when an occurrence starts and ends on the same date", () => {
    const oneDay = new Date("2026-09-09T00:00:00.000Z");
    const input = buildStudyCalendarEventInput(workspace(), block({
      dayOfWeek: 3,
      recurrenceStartDate: oneDay,
      recurrenceEndDate: oneDay,
      startWeek: null,
      endWeek: null,
    }), "stable-event-id");

    expect(input.recurrence).toEqual([]);
    expect(input.startAt.toISOString()).toBe("2026-09-09T06:00:00.000Z");
    expect(input.endAt.toISOString()).toBe("2026-09-09T07:00:00.000Z");
  });

  it("preserves local wall-clock time through a daylight-saving transition", () => {
    const input = buildStudyCalendarEventInput(workspace({
      timezone: "America/New_York",
      semesterStartDate: new Date("2026-03-02T00:00:00.000Z"),
    }), block({ startTime: "09:00", endTime: "10:00", endWeek: 3 }), "stable-event-id");

    expect(input.timezone).toBe("America/New_York");
    expect(input.startAt.toISOString()).toBe("2026-03-02T14:00:00.000Z");
    expect(input.recurrence[0]).toContain("FREQ=WEEKLY;BYDAY=MO");
  });
});
