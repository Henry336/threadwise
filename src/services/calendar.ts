import { DateTime } from "luxon";

type CalendarInput = {
  title: string;
  details?: string | null;
  dueAt: Date;
  timezone: string;
};

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

export function createIcs(input: CalendarInput): string {
  const start = DateTime.fromJSDate(input.dueAt).toUTC();
  const end = start.plus({ minutes: 30 });
  const stamp = DateTime.utc().toFormat("yyyyLLdd'T'HHmmss'Z'");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Threadwise//Threadwise Bot//EN",
    "BEGIN:VEVENT",
    `UID:${cryptoRandomId()}@threadwise`,
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

function escapeIcs(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function cryptoRandomId(): string {
  return Math.random().toString(36).slice(2, 12);
}

