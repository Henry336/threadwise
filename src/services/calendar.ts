/**
 * Calendar links that need no Google account: a prefilled "add to Google Calendar" URL and a
 * downloadable .ics file. Task cards, capture drafts, and the dashboard use these as the
 * zero-setup fallback. The OAuth-backed sync that writes events directly lives in googleCalendar.ts.
 */
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";

type CalendarInput = {
  title: string;
  details?: string | null;
  dueAt: Date;
  timezone: string;
};

/**
 * Builds a Google Calendar "template" URL that opens a prefilled 30-minute event at the due time.
 * Nothing is written on Google's side until the user saves the event themselves.
 */
export function createGoogleCalendarUrl(input: CalendarInput): string {
  const start = DateTime.fromJSDate(input.dueAt).setZone(input.timezone);
  const end = start.plus({ minutes: 30 });
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: input.title,
    details: input.details ?? "",
    dates: `${formatGoogleDate(start)}/${formatGoogleDate(end)}`
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Builds a minimal one-event iCalendar file (CRLF lines, UTC times) for any calendar app.
 * The UID is random, so importing the same task twice creates two events.
 */
export function createIcs(input: CalendarInput): string {
  const start = DateTime.fromJSDate(input.dueAt).toUTC();
  const end = start.plus({ minutes: 30 });
  const stamp = DateTime.utc().toFormat("yyyyLLdd'T'HHmmss'Z'");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Threadwise//Threadwise Bot//EN",
    "BEGIN:VEVENT",
    `UID:${randomUUID()}@threadwise`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${start.toFormat("yyyyLLdd'T'HHmmss'Z'")}`,
    `DTEND:${end.toFormat("yyyyLLdd'T'HHmmss'Z'")}`,
    `SUMMARY:${escapeIcs(input.title)}`,
    `DESCRIPTION:${escapeIcs(input.details ?? "")}`,
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");
}

function formatGoogleDate(value: DateTime): string {
  return value.toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'");
}

/** Escapes the characters that iCalendar text values treat as syntax (backslash, newline, comma, semicolon). */
function escapeIcs(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

