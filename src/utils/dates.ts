import { DateTime } from "luxon";

export type QuietHours = {
  start?: string | null;
  end?: string | null;
  timezone: string;
};

export function parseDueDate(input: string, timezone: string, now: Date = new Date()): Date | undefined {
  const text = input.toLowerCase();
  const base = DateTime.fromJSDate(now).setZone(timezone);

  const inMatch = text.match(/\b(?:in|after)\s+(\d+)\s*(minute|minutes|min|mins|m|hour|hours|hr|hrs|day|days)\b/);
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

  const weekday = parseWeekday(text, base);
  if (weekday) {
    return weekday.toJSDate();
  }

  const monthDay = parseMonthDay(text, base);
  if (monthDay) {
    return monthDay.toJSDate();
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

  const clockOnly = parseClockOnly(text, base);
  if (clockOnly) {
    const scheduled = withOptionalTime(base, clockOnly.hour, clockOnly.minute, clockOnly.meridiem);
    return (scheduled <= base ? scheduled.plus({ days: 1 }) : scheduled).toJSDate();
  }

  return undefined;
}

export function formatDateTimeForUser(date: Date, timezone: string): string {
  return DateTime.fromJSDate(date)
    .setZone(timezone)
    .toLocaleString({
      ...DateTime.DATETIME_MED,
      hour12: true,
      timeZoneName: "short"
    });
}

export function splitReminderText(input: string): { whenText: string; taskText: string } | undefined {
  const pipeParts = input.split("|").map((part) => part.trim()).filter(Boolean);
  if (pipeParts.length >= 2) {
    return {
      whenText: pipeParts[0] ?? "",
      taskText: pipeParts.slice(1).join(" | ")
    };
  }

  const remindMeMatch = input.match(/^me\s+(?:to|about|for)\s+(.+)$/i);
  if (remindMeMatch?.[1]) {
    return {
      whenText: remindMeMatch[1].trim(),
      taskText: remindMeMatch[1].trim()
    };
  }

  const mentionedAssigneeMatch = input.match(/^(@[\w_]{3,32})\s+(?:to|about|for)\s+(.+)$/i);
  if (mentionedAssigneeMatch?.[1] && mentionedAssigneeMatch[2]) {
    return {
      whenText: mentionedAssigneeMatch[2].trim(),
      taskText: `${mentionedAssigneeMatch[1]} ${mentionedAssigneeMatch[2]}`.trim()
    };
  }

  const groupTargetMatch = input.match(/^(?:us|everyone|everybody|all)\s+(?:to|about|for)\s+(.+)$/i);
  if (groupTargetMatch?.[1]) {
    return {
      whenText: groupTargetMatch[1].trim(),
      taskText: groupTargetMatch[1].trim()
    };
  }

  const leadingTargetMatch = input.match(/^(?:to|about|for)\s+(.+)$/i);
  if (leadingTargetMatch?.[1]) {
    return {
      whenText: leadingTargetMatch[1].trim(),
      taskText: leadingTargetMatch[1].trim()
    };
  }

  const aboutMatch = input.match(/^(.+?)\s+(?:to|about)\s+(.+)$/i);
  if (aboutMatch?.[1] && aboutMatch[2]) {
    return {
      whenText: aboutMatch[1].trim(),
      taskText: aboutMatch[2].trim()
    };
  }

  if (hasReminderTimeText(input)) {
    return {
      whenText: input.trim(),
      taskText: input.trim()
    };
  }

  return undefined;
}

function hasReminderTimeText(input: string): boolean {
  return /\b(?:(?:in|after)\s+\d+\s*(?:minute|minutes|min|mins|m|hour|hours|hr|hrs|day|days)|(?:today|tomorrow|next\s+\w+)(?:\s+at\s+\d{1,2})?|at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\d{4}-\d{2}-\d{2})\b/i.test(input);
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

function parseWeekday(text: string, base: DateTime): DateTime | undefined {
  const weekdays = new Map([
    ["monday", 1],
    ["tuesday", 2],
    ["wednesday", 3],
    ["thursday", 4],
    ["friday", 5],
    ["saturday", 6],
    ["sunday", 7]
  ]);
  const match = text.match(/\b(next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/);
  if (!match?.[2]) {
    return undefined;
  }

  const targetWeekday = weekdays.get(match[2]);
  if (!targetWeekday) {
    return undefined;
  }

  let daysToAdd = targetWeekday - base.weekday;
  if (daysToAdd < 0 || daysToAdd === 0 || match[1]) {
    daysToAdd += 7;
  }

  return withOptionalTime(base.plus({ days: daysToAdd }), match[3], match[4], match[5]);
}

function parseMonthDay(text: string, base: DateTime): DateTime | undefined {
  const months = new Map([
    ["jan", 1],
    ["january", 1],
    ["feb", 2],
    ["february", 2],
    ["mar", 3],
    ["march", 3],
    ["apr", 4],
    ["april", 4],
    ["may", 5],
    ["jun", 6],
    ["june", 6],
    ["jul", 7],
    ["july", 7],
    ["aug", 8],
    ["august", 8],
    ["sep", 9],
    ["sept", 9],
    ["september", 9],
    ["oct", 10],
    ["october", 10],
    ["nov", 11],
    ["november", 11],
    ["dec", 12],
    ["december", 12]
  ]);
  const match = text.match(/\b(?:(?:on)\s+)?(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }

  const month = months.get(match[2]);
  if (!month) {
    return undefined;
  }

  let scheduled = withOptionalTime(
    base.set({ month, day: Number(match[1]), second: 0, millisecond: 0 }),
    match[3],
    match[4],
    match[5]
  );
  if (!scheduled.isValid) {
    return undefined;
  }
  if (scheduled <= base) {
    scheduled = scheduled.plus({ years: 1 });
  }

  return scheduled;
}

function parseClockOnly(text: string, base: DateTime): { hour: string; minute?: string; meridiem?: string } | undefined {
  const match = text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (!match?.[1]) {
    return undefined;
  }

  const hour = Number(match[1]);
  if (hour < 0 || hour > 23) {
    return undefined;
  }

  return {
    hour: match[1],
    minute: match[2],
    meridiem: match[3]
  };
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
