import { DateTime } from "luxon";

export type QuietHours = {
  start?: string | null;
  end?: string | null;
  timezone: string;
};

export function parseDueDate(input: string, timezone: string, now: Date = new Date()): Date | undefined {
  const text = input.toLowerCase();
  const base = DateTime.fromJSDate(now).setZone(timezone);

  const inMatch = text.match(/\bin\s+(\d+)\s*(minute|minutes|min|hour|hours|hr|hrs|day|days)\b/);
  if (inMatch?.[1] && inMatch[2]) {
    const amount = Number(inMatch[1]);
    const unit = inMatch[2].startsWith("min")
      ? "minutes"
      : inMatch[2].startsWith("h")
        ? "hours"
        : "days";
    return base.plus({ [unit]: amount }).toJSDate();
  }

  const tomorrowMatch = text.match(/\btomorrow(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/);
  if (tomorrowMatch) {
    return withOptionalTime(base.plus({ days: 1 }), tomorrowMatch[1], tomorrowMatch[2], tomorrowMatch[3]).toJSDate();
  }

  const todayMatch = text.match(/\btoday(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/);
  if (todayMatch) {
    return withOptionalTime(base, todayMatch[1], todayMatch[2], todayMatch[3]).toJSDate();
  }

  const isoMatch = text.match(/\b(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}):(\d{2}))?\b/);
  if (isoMatch?.[1]) {
    const parsed = DateTime.fromISO(isoMatch[1], { zone: timezone });
    if (parsed.isValid) {
      const hour = isoMatch[2] ? Number(isoMatch[2]) : 9;
      const minute = isoMatch[3] ? Number(isoMatch[3]) : 0;
      return parsed.set({ hour, minute, second: 0, millisecond: 0 }).toJSDate();
    }
  }

  return undefined;
}

function withOptionalTime(base: DateTime, hourText?: string, minuteText?: string, meridiem?: string): DateTime {
  if (!hourText) {
    return base.set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
  }

  let hour = Number(hourText);
  if (meridiem === "pm" && hour < 12) {
    hour += 12;
  }
  if (meridiem === "am" && hour === 12) {
    hour = 0;
  }

  return base.set({
    hour,
    minute: minuteText ? Number(minuteText) : 0,
    second: 0,
    millisecond: 0
  });
}

export function parseDurationMinutes(input: string, fallbackMinutes: number): number {
  const match = input.toLowerCase().match(/(\d+)\s*(m|min|minute|minutes|h|hr|hrs|hour|hours|d|day|days)/);
  if (!match?.[1] || !match[2]) {
    return fallbackMinutes;
  }

  const amount = Number(match[1]);
  const unit = match[2];

  if (unit.startsWith("h")) {
    return amount * 60;
  }

  if (unit.startsWith("d")) {
    return amount * 24 * 60;
  }

  return amount;
}

export function isWithinQuietHours(now: Date, quiet: QuietHours): boolean {
  if (!quiet.start || !quiet.end) {
    return false;
  }

  const current = DateTime.fromJSDate(now).setZone(quiet.timezone);
  const start = parseClock(quiet.start, current);
  const end = parseClock(quiet.end, current);

  if (!start || !end) {
    return false;
  }

  if (start <= end) {
    return current >= start && current < end;
  }

  return current >= start || current < end;
}

export function nextQuietEnd(now: Date, quiet: QuietHours): Date {
  if (!quiet.end) {
    return now;
  }

  const current = DateTime.fromJSDate(now).setZone(quiet.timezone);
  const endToday = parseClock(quiet.end, current);
  if (!endToday) {
    return now;
  }

  const nextEnd = current < endToday ? endToday : endToday.plus({ days: 1 });
  return nextEnd.toJSDate();
}

export function startOfUserDay(now: Date, timezone: string): Date {
  return DateTime.fromJSDate(now).setZone(timezone).startOf("day").toJSDate();
}

function parseClock(value: string, base: DateTime): DateTime | undefined {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }

  return base.set({
    hour: Number(match[1]),
    minute: Number(match[2]),
    second: 0,
    millisecond: 0
  });
}

