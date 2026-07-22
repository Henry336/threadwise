import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecurrenceRule } from "@prisma/client";

describe("Google Calendar integration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@example.com:5432/threadwise");
    vi.stubEnv("WEBHOOK_URL", "https://threadwise.example.com");
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
    vi.stubEnv("GOOGLE_TOKEN_ENCRYPTION_KEY", "calendar-test-secret-key");
  });

  it("recognizes a complete Calendar OAuth configuration", async () => {
    const { calendarConfigured } = await import("./googleCalendar");
    expect(calendarConfigured()).toBe(true);
  });

  it("builds a 30-minute event in the task timezone", async () => {
    const { buildGoogleCalendarEvent } = await import("./googleCalendar");
    const event = buildGoogleCalendarEvent({
      title: "Submit the form",
      details: "Threadwise task TASK-1",
      dueAt: new Date("2026-07-13T01:00:00.000Z"),
      timezone: "Asia/Singapore"
    });

    expect(event).toEqual({
      summary: "Submit the form",
      description: "Threadwise task TASK-1",
      start: { dateTime: "2026-07-13T09:00:00.000+08:00", timeZone: "Asia/Singapore" },
      end: { dateTime: "2026-07-13T09:30:00.000+08:00", timeZone: "Asia/Singapore" },
      extendedProperties: { private: { threadwise: "true" } }
    });
  });

  it("keeps a recurring reminder recurring in Google Calendar", async () => {
    const { buildGoogleCalendarEvent } = await import("./googleCalendar");
    const event = buildGoogleCalendarEvent({
      title: "Weekly review",
      dueAt: new Date("2026-07-17T01:00:00.000Z"),
      timezone: "Asia/Singapore",
      recurrenceRule: RecurrenceRule.WEEKLY
    });

    expect(event.recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=FR"]);
  });
});
