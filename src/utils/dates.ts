/**
 * Deterministic natural-language date and time parsing for tasks and reminders
 * ("tomorrow 3pm", "in 20 min", "every Monday"). It is the reason reminders work without AI.
 * All parsing happens in the user's timezone. Also holds recurrence and quiet-hours math used by
 * the reminder loop.
 */

import { DateTime } from "luxon";
import { RecurrenceRule } from "@prisma/client";
import { normalizeClock } from "./clock";

export type QuietHours = {
  start?: string | null;
  end?: string | null;
  timezone: string;
};

/**
 * Parses a date or time phrase into a Date, in the user's timezone. Patterns are tried from most
 * specific to most general (relative durations, named times, weekdays, month-day, numeric and ISO
 * dates, then a bare clock time). A date without a time defaults to 9:00, and a time that has
 * already passed today moves to tomorrow. Returns undefined when nothing matches.
 */
export function parseDueDate(input: string, timezone: string, now: Date = new Date()): Date | undefined {
  const text = normalizeNaturalDateText(input);
  const base = DateTime.fromJSDate(now).setZone(timezone);

  const relativeMinutes = parseRelativeDurationMinutes(text);
  if (relativeMinutes) return base.plus({ minutes: relativeMinutes }).toJSDate();

  const dayAfterTomorrowMatch = text.match(/\bday\s+after\s+tomorrow(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/);
  if (dayAfterTomorrowMatch) {
    return withOptionalTime(base.plus({ days: 2 }), dayAfterTomorrowMatch[1], dayAfterTomorrowMatch[2], dayAfterTomorrowMatch[3]).toJSDate();
  }

  const namedClockMatch = text.match(/\b(?:(today|tomorrow)\s+(?:at\s+)?)?(noon|midday|lunchtime|midnight)(?:\s+(today|tomorrow))?\b/);
  if (namedClockMatch?.[2]) {
    const explicitDay = namedClockMatch[1] ?? namedClockMatch[3];
    let scheduled = (explicitDay === "tomorrow" ? base.plus({ days: 1 }) : base).set({
      hour: namedClockMatch[2] === "midnight" ? 0 : 12,
      minute: 0,
      second: 0,
      millisecond: 0
    });
    if (!explicitDay && scheduled <= base) {
      scheduled = scheduled.plus({ days: 1 });
    }
    return scheduled.toJSDate();
  }

  const timeBeforeRelativeDayMatch = text.match(/\b(?:at|by|before)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s+(today|tomorrow)\b/);
  if (timeBeforeRelativeDayMatch?.[1] && timeBeforeRelativeDayMatch[3] && timeBeforeRelativeDayMatch[4]) {
    const dayBase = timeBeforeRelativeDayMatch[4] === "tomorrow" ? base.plus({ days: 1 }) : base;
    return withOptionalTime(dayBase, timeBeforeRelativeDayMatch[1], timeBeforeRelativeDayMatch[2], timeBeforeRelativeDayMatch[3]).toJSDate();
  }

  const relativeDayPart = parseRelativeDayPart(text, base);
  if (relativeDayPart) {
    return relativeDayPart.toJSDate();
  }

  const tomorrowMatch = text.match(/\btomorrow(?:\s+(?:(?:at|by|before|around)\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/);
  if (tomorrowMatch) {
    return withOptionalTime(base.plus({ days: 1 }), tomorrowMatch[1], tomorrowMatch[2], tomorrowMatch[3]).toJSDate();
  }

  const todayMatch = text.match(/\btoday(?:\s+(?:(?:at|by|before|around)\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/);
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

  const monthlyDay = parseMonthlyDay(text, base);
  if (monthlyDay) return monthlyDay.toJSDate();

  const numericDate = parseNumericDate(text, base);
  if (numericDate) return numericDate.toJSDate();

  const broaderRelativeDate = parseBroaderRelativeDate(text, base);
  if (broaderRelativeDate) return broaderRelativeDate.toJSDate();

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

/**
 * Formats a date for Telegram copy in the user's timezone, with a short timezone name.
 */
export function formatDateTimeForUser(date: Date, timezone: string): string {
  return DateTime.fromJSDate(date)
    .setZone(timezone)
    .toLocaleString({
      ...DateTime.DATETIME_MED,
      hour12: true,
      timeZoneName: "short"
    });
}

/**
 * Splits the body of "remind me ..." into the part that says when and the task text.
 * Supports "when | task", "me to ...", "@user to ..." and "everyone to ...". Several patterns return the
 * whole phrase as both parts.
 */
export function splitReminderText(input: string): { whenText: string; taskText: string } | undefined {
  const pipeParts = input.split("|").map((part) => part.trim()).filter(Boolean);
  if (pipeParts.length >= 2) {
    return {
      whenText: pipeParts[0] ?? "",
      taskText: pipeParts.slice(1).join(" | ")
    };
  }

  const remindMeMatch = input.match(/^me\s+(?:to|about|for|of)\s+(.+)$/i);
  if (remindMeMatch?.[1]) {
    return {
      whenText: remindMeMatch[1].trim(),
      taskText: remindMeMatch[1].trim()
    };
  }

  const informalRemindMeMatch = input.match(/^me\s+(.+)$/i);
  if (informalRemindMeMatch?.[1] && hasReminderTimeText(informalRemindMeMatch[1])) {
    return {
      whenText: informalRemindMeMatch[1].trim(),
      taskText: informalRemindMeMatch[1].trim()
    };
  }

  const multipleAssigneesMatch = input.match(/^(.+?@[A-Za-z0-9_]{3,32}.*?)\s+(?:to|about|for)\s+(.+)$/i);
  if (multipleAssigneesMatch?.[1] && multipleAssigneesMatch[2] && hasReminderTimeText(multipleAssigneesMatch[2])) {
    return {
      whenText: multipleAssigneesMatch[2].trim(),
      taskText: input.trim()
    };
  }

  const mentionedAssigneeMatch = input.match(/^(@[\w_]{3,32})\s+(?:to|about|for)\s+(.+)$/i);
  if (mentionedAssigneeMatch?.[1] && mentionedAssigneeMatch[2]) {
    return {
      whenText: mentionedAssigneeMatch[2].trim(),
      taskText: `${mentionedAssigneeMatch[1]} ${mentionedAssigneeMatch[2]}`.trim()
    };
  }

  const groupTargetMatch = input.match(/^(?:us|everyone|everybody|all)\s+(?:to|about|for|of)\s+(.+)$/i);
  if (groupTargetMatch?.[1]) {
    return {
      whenText: groupTargetMatch[1].trim(),
      taskText: groupTargetMatch[1].trim()
    };
  }

  const leadingTargetMatch = input.match(/^(?:to|about|for|of)\s+(.+)$/i);
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

export type RecurrencePattern = {
  rule: RecurrenceRule;
  intervalDays: number;
};

/**
 * Detects daily, weekly, monthly or yearly wording ("every day", "weekly", "Mondays").
 * `intervalDays` is an approximate length; nextRecurringDueAt does the real calendar math.
 */
export function parseRecurrencePattern(input: string): RecurrencePattern | undefined {
  const text = input.toLowerCase();
  if (/\b(?:every\s+(?:single\s+)?(?:day|night|morning|evening)|daily|nightly|each\s+(?:day|night|morning|evening)|once\s+a\s+day|every\s+24\s+hours)\b/.test(text)) {
    return { rule: RecurrenceRule.DAILY, intervalDays: 1 };
  }

  if (/\b(?:every\s+year|yearly|annually|annual|each\s+year|once\s+a\s+year)\b/.test(text)) {
    return { rule: RecurrenceRule.YEARLY, intervalDays: 365 };
  }

  if (/\b(?:every\s+month|monthly|each\s+month|once\s+a\s+month)\b/.test(text)) {
    return { rule: RecurrenceRule.MONTHLY, intervalDays: 30 };
  }

  if (/\b(?:every\s+(?:single\s+)?week|weekly|each\s+week|once\s+a\s+week|(?:every|each)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(?:mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays))\b/.test(text)) {
    return { rule: RecurrenceRule.WEEKLY, intervalDays: 7 };
  }

  return undefined;
}

/**
 * Removes recurrence wording from text so it does not end up in the task title.
 */
export function stripRecurrenceText(input: string): string {
  return input
    .replace(/\b(?:every\s+(?:single\s+)?(?:day|night|morning|evening)|daily|nightly|each\s+(?:day|night|morning|evening)|once\s+a\s+day|every\s+24\s+hours)\b/ig, "")
    .replace(/\b(?:every\s+year|yearly|annually|annual|each\s+year|once\s+a\s+year)\b/ig, "")
    .replace(/\b(?:every\s+month|monthly|each\s+month|once\s+a\s+month)\b/ig, "")
    .replace(/\b(?:every|each)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/ig, "")
    .replace(/\b(?:on\s+)?(?:mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays)\b/ig, "")
    .replace(/\b(?:every\s+(?:single\s+)?week|weekly|each\s+week|once\s+a\s+week)\b/ig, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:| -]+$/g, "")
    .trim();
}

/**
 * Next future occurrence of a recurring task after `previousDueAt`. Steps forward until it is
 * after `now`, so missed occurrences are skipped instead of firing in a burst. Monthly tasks keep
 * their intended day (for example the 31st) and clamp to the month's last day, so they do not
 * drift earlier after a short month.
 */
export function nextRecurringDueAt(previousDueAt: Date, rule: RecurrenceRule, timezone: string, now: Date = new Date(), monthlyDayOfMonth?: number | null): Date {
  let next = DateTime.fromJSDate(previousDueAt).setZone(timezone);
  const current = DateTime.fromJSDate(now).setZone(timezone);
  if (rule === RecurrenceRule.MONTHLY) {
    const intendedDay = Math.min(31, Math.max(1, monthlyDayOfMonth ?? next.day));
    const clock = { hour: next.hour, minute: next.minute, second: next.second, millisecond: next.millisecond };
    do {
      const nextMonth = next.plus({ months: 1 }).startOf("month");
      next = nextMonth.set({ day: Math.min(intendedDay, nextMonth.daysInMonth ?? intendedDay), ...clock });
    } while (next <= current);
    return next.toJSDate();
  }
  const step = rule === RecurrenceRule.DAILY
    ? { days: 1 }
    : rule === RecurrenceRule.WEEKLY
      ? { weeks: 1 }
      : { years: 1 };

  do {
    next = next.plus(step);
  } while (next <= current);

  return next.toJSDate();
}

/**
 * The day of month a monthly task should keep, stored so nextRecurringDueAt can avoid drift.
 */
export function recurrenceDayOfMonth(dueAt: Date | undefined, rule: RecurrenceRule | undefined, timezone: string): number | undefined {
  if (!dueAt || rule !== RecurrenceRule.MONTHLY) return undefined;
  return DateTime.fromJSDate(dueAt).setZone(timezone).day;
}

/**
 * Reads "in 20 min", "after an hour and a half" or "2 hours from now" as a number of minutes.
 * Only adjacent duration parts are added up, so other numbers later in the sentence are ignored.
 */
export function parseRelativeDurationMinutes(input: string): number | undefined {
  const text = input.toLowerCase();
  const candidates = [...text.matchAll(/\b(?:in|after)\s+(?:(?:about|around|roughly|approximately|approx\.?|nearly)\s+)?/g)]
    .map((prefix) => text.slice((prefix.index ?? 0) + prefix[0].length));
  const fromNow = text.match(/\b((?:(?:\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|forty-five|sixty|half(?:\s+an?)?|quarter|couple(?:\s+of)?)\s*(?:minutes?|mins?|m|hours?|hrs?|h|days?|d)\s*(?:and\s+)?)+)from\s+now\b/);
  if (fromNow?.[1]) candidates.push(fromNow[1]);

  for (const rawCandidate of candidates) {
    const candidate = rawCandidate
    .replace(/\bhalf\s+an?\s+(hour|hr)\b/g, "0.5 $1")
    .replace(/\b(?:a\s+)?quarter\s+of\s+an?\s+(hour|hr)\b/g, "0.25 $1")
    .replace(/\band\b/g, ",");

    const token = /(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|forty-five|sixty|half|quarter|couple(?:\s+of)?)\s*(minutes?|mins?|m|hours?|hrs?|h|days?|d)\b/g;
    let total = 0;
    let consumedUntil = 0;
    for (const match of candidate.matchAll(token)) {
      if (match.index === undefined) continue;
      const between = candidate.slice(consumedUntil, match.index).replace(/^(?:\s|,)+/i, "");
      if (between) break;
      const amount = relativeAmount(match[1] ?? "");
      const unit = match[2] ?? "";
      total += unit.startsWith("d") ? amount * 24 * 60 : unit.startsWith("h") ? amount * 60 : amount;
      consumedUntil = match.index + match[0].length;
    }
    if (total > 0) return total;
  }
  return undefined;
}

/**
 * Copies a recurrence phrase from the schedule part of a reminder onto the task text, when the
 * split left it only in the schedule part, so the saved task still repeats.
 */
export function carryRecurrenceToTaskText(taskText: string, scheduleText: string): string {
  if (parseRecurrencePattern(taskText)) return taskText;
  const recurrence = parseRecurrencePattern(scheduleText);
  if (!recurrence) return taskText;
  const suffix = recurrence.rule === RecurrenceRule.DAILY
    ? "every day"
    : recurrence.rule === RecurrenceRule.WEEKLY
      ? "every week"
      : recurrence.rule === RecurrenceRule.MONTHLY
        ? "every month"
        : "every year";
  return `${taskText.trim()} ${suffix}`.trim();
}

export function formatRecurrenceRule(rule: RecurrenceRule): string {
  if (rule === RecurrenceRule.WEEKLY) return "Weekly";
  if (rule === RecurrenceRule.MONTHLY) return "Monthly";
  if (rule === RecurrenceRule.YEARLY) return "Yearly";
  return "Daily";
}

/**
 * True when the text contains any time or date wording. Used to decide whether a phrase can
 * be read as a reminder time.
 */
function hasReminderTimeText(input: string): boolean {
  if (parseRelativeDurationMinutes(input)) return true;
  const text = normalizeNaturalDateText(input);
  return /\b(?:(?:in|after)\s+(?:\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|half(?:\s+an?)?)\s*(?:minute|minutes|min|mins|m|hour|hours|hr|hrs|day|days)|day\s+after\s+tomorrow|(?:today|tomorrow|tonight|this\s+(?:morning|afternoon|evening|night)|next\s+\w+)(?:\s+(?:at|by|before|around)?\s*\d{1,2})?|end\s+of\s+(?:the\s+)?day|eod|noon|midnight|midday|lunchtime|(?:at|by|before|around|no\s+later\s+than)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?|\d{4}-\d{2}-\d{2})\b/i.test(text);
}

/**
 * Converts a number or number word ("two", "half", "couple") to a value; unknown words count as 1.
 */
function relativeAmount(value: string): number {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const values: Record<string, number> = {
    a: 1,
    an: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    fifteen: 15,
    twenty: 20,
    thirty: 30,
    forty: 40,
    "forty-five": 45,
    sixty: 60,
    half: 0.5,
    quarter: 0.25,
    couple: 2,
    "couple of": 2
  };
  return values[value.toLowerCase()] ?? 1;
}

/**
 * Applies an hour, minute and am/pm to a date. With no hour given, uses 9:00 as the default time.
 */
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

/**
 * Parses "Friday", "next Monday 3pm". A weekday that is today but already past moves to next week.
 */
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
  const match = text.match(/\b((?:next|this)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+(?:(?:at|by|before|around)\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/);
  if (!match?.[2]) {
    return undefined;
  }

  const targetWeekday = weekdays.get(match[2]);
  if (!targetWeekday) {
    return undefined;
  }

  let daysToAdd = targetWeekday - base.weekday;
  if (daysToAdd < 0 || match[1]?.trim() === "next") {
    daysToAdd += 7;
  }
  let scheduled = withOptionalTime(base.plus({ days: daysToAdd }), match[3], match[4], match[5]);
  if (daysToAdd === 0 && scheduled <= base) {
    scheduled = scheduled.plus({ weeks: 1 });
  }
  return scheduled;
}

/**
 * Parses "12 March", "March 12th" or "3pm 12 Mar". A date already past this year moves to next year.
 */
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
  const monthPattern = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
  const timeBeforeMatch = text.match(new RegExp(`\\b(?:at|by|before)?\\s*(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)\\s+(?:on\\s+)?(\\d{1,2})\\s+(${monthPattern})\\b`));
  if (timeBeforeMatch?.[1] && timeBeforeMatch[3] && timeBeforeMatch[4] && timeBeforeMatch[5]) {
    return monthDayDateTime({
      base,
      months,
      dayText: timeBeforeMatch[4],
      monthText: timeBeforeMatch[5],
      hourText: timeBeforeMatch[1],
      minuteText: timeBeforeMatch[2],
      meridiem: timeBeforeMatch[3]
    });
  }

  const match = text.match(new RegExp(`\\b(?:(?:on)\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})(?:\\s+(?:at|by|before)?\\s*(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?)?\\b`));
  if (!match?.[1] || !match[2]) {
    const monthFirstMatch = text.match(new RegExp(`\\b(?:on\\s+)?(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+(?:at|by|before)?\\s*(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?)?\\b`));
    if (!monthFirstMatch?.[1] || !monthFirstMatch[2]) {
      return undefined;
    }

    return monthDayDateTime({
      base,
      months,
      dayText: monthFirstMatch[2],
      monthText: monthFirstMatch[1],
      hourText: monthFirstMatch[3],
      minuteText: monthFirstMatch[4],
      meridiem: monthFirstMatch[5]
    });
  }

  return monthDayDateTime({
    base,
    months,
    dayText: match[1],
    monthText: match[2],
    hourText: match[3],
    minuteText: match[4],
    meridiem: match[5]
  });
}

/**
 * For monthly wording with a day ("on the 15th every month"), finds the next month that has that
 * day, skipping months that are too short.
 */
function parseMonthlyDay(text: string, base: DateTime): DateTime | undefined {
  if (!/\b(?:every\s+month|monthly|each\s+month|once\s+a\s+month)\b/.test(text)) return undefined;
  const dayMatch = text.match(/\b(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+(?:every|each)\s+month\b/)
    ?? text.match(/\b(?:every|each)\s+month\s+(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\b/)
    ?? text.match(/\bmonthly\s+(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\b/);
  const day = Number(dayMatch?.[1]);
  if (!Number.isInteger(day) || day < 1 || day > 31) return undefined;
  const clock = parseClockOnly(text, base);
  for (let monthsToAdd = 0; monthsToAdd < 24; monthsToAdd += 1) {
    const month = base.plus({ months: monthsToAdd });
    let scheduled = withOptionalTime(month.set({ day }), clock?.hour, clock?.minute, clock?.meridiem);
    if (!scheduled.isValid || scheduled.day !== day) continue;
    if (scheduled <= base) continue;
    return scheduled;
  }
  return undefined;
}

/**
 * Builds the date for parseMonthDay and rolls it to next year when it is already past.
 */
function monthDayDateTime(input: {
  base: DateTime;
  months: Map<string, number>;
  dayText: string;
  monthText: string;
  hourText?: string;
  minuteText?: string;
  meridiem?: string;
}): DateTime | undefined {
  const month = input.months.get(input.monthText);
  if (!month) {
    return undefined;
  }

  let scheduled = withOptionalTime(
    input.base.set({ month, day: Number(input.dayText), second: 0, millisecond: 0 }),
    input.hourText,
    input.minuteText,
    input.meridiem
  );
  if (!scheduled.isValid) {
    return undefined;
  }
  if (scheduled <= input.base) {
    scheduled = scheduled.plus({ years: 1 });
  }

  return scheduled;
}

/**
 * Finds a clock time on its own: "at 7", "5:30pm", "half past six". Rejects impossible values
 * such as 13pm.
 */
function parseClockOnly(text: string, base: DateTime): { hour: string; minute?: string; meridiem?: string } | undefined {
  const spoken = text.match(/\b(half|quarter)\s+(past|to)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(am|pm)?\b/);
  if (spoken?.[1] && spoken[2] && spoken[3]) {
    const rawHour = clockWordValue(spoken[3]);
    if (rawHour) {
      const isTo = spoken[2] === "to";
      const minute = spoken[1] === "half" ? 30 : isTo ? 45 : 15;
      const hour = isTo ? (rawHour === 1 ? 12 : rawHour - 1) : rawHour;
      return { hour: String(hour), minute: String(minute), meridiem: spoken[4] };
    }
  }

  const match = text.match(/\b(?:at|by|before|around|no\s+later\s+than)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/)
    ?? text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (!match?.[1]) {
    return undefined;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || (match[3] && hour > 12)) {
    return undefined;
  }

  return {
    hour: match[1],
    minute: match[2],
    meridiem: match[3]
  };
}

/**
 * Lower-cases and normalizes date text before matching: "p.m." to "pm", "5.30" to "5:30",
 * "tmr" to "tomorrow", short weekday names to full names. All patterns above assume this form.
 */
function normalizeNaturalDateText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\b([ap])\s*\.?\s*m\.?\b/g, "$1m")
    .replace(/\b(\d{1,2})\s*[.]\s*(\d{2})(?!\d)(?!\s*(?:hours?|hrs?|h|minutes?|mins?|m|days?|d)\b)/g, "$1:$2")
    .replace(/\b(\d{1,2})\s*[:]\s*(\d{2})/g, "$1:$2")
    .replace(/\b(\d{1,2})\s+(\d{2})\s*(am|pm)\b/g, "$1:$2$3")
    .replace(/\b(\d{1,2})h(\d{2})\b/g, "$1:$2")
    .replace(/\b(?:tmr|tmrw|tmw)\b/g, "tomorrow")
    .replace(/\btonite\b/g, "tonight")
    .replace(/\bmon\b/g, "monday")
    .replace(/\btue(?:s)?\b/g, "tuesday")
    .replace(/\bwed\b/g, "wednesday")
    .replace(/\bthu(?:rs)?\b/g, "thursday")
    .replace(/\bfri\b/g, "friday")
    .replace(/\bsat\b/g, "saturday")
    .replace(/\bsun\b/g, "sunday")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parses "this evening", "tomorrow morning", "tonight" to fixed hours (9, 14, 18, 20) unless an
 * explicit time is also given.
 */
function parseRelativeDayPart(text: string, base: DateTime): DateTime | undefined {
  const match = text.match(/\b(?:(today|tomorrow|this)\s+)?(morning|afternoon|evening|night|tonight)\b/);
  if (!match?.[2]) return undefined;
  const part = match[2];
  const explicitDay = match[1];
  const hour = part === "morning" ? 9 : part === "afternoon" ? 14 : part === "evening" ? 18 : 20;
  const dayBase = explicitDay === "tomorrow" ? base.plus({ days: 1 }) : base;
  const explicitClock = parseClockOnly(text, base);
  let scheduled = explicitClock
    ? withOptionalTime(dayBase, explicitClock.hour, explicitClock.minute, explicitClock.meridiem)
    : dayBase.set({ hour, minute: 0, second: 0, millisecond: 0 });
  if ((!explicitDay || explicitDay === "this") && scheduled <= base) scheduled = scheduled.plus({ days: 1 });
  return scheduled;
}

/**
 * Parses "end of day" (17:00), "next week" (start of next week, 9:00) and "next month".
 */
function parseBroaderRelativeDate(text: string, base: DateTime): DateTime | undefined {
  if (/\b(?:end\s+of\s+(?:the\s+)?day|eod)\b/.test(text)) {
    let scheduled = base.set({ hour: 17, minute: 0, second: 0, millisecond: 0 });
    if (scheduled <= base) scheduled = scheduled.plus({ days: 1 });
    return scheduled;
  }
  if (/\bnext\s+week\b/.test(text)) {
    return base.plus({ weeks: 1 }).startOf("week").set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
  }
  if (/\bnext\s+month\b/.test(text)) {
    return base.plus({ months: 1 }).startOf("month").set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
  }
  return undefined;
}

/**
 * Parses day-first numeric dates such as 12/3 or 12-03-2027, with an optional time.
 */
function parseNumericDate(text: string, base: DateTime): DateTime | undefined {
  const match = text.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?(?:\s+(?:(?:at|by|before|around)\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?\b/);
  if (!match?.[1] || !match[2]) return undefined;
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = match[3] ? Number(match[3]) : base.year;
  if (year < 100) year += 2000;
  let scheduled = withOptionalTime(base.set({ year, month, day }), match[4], match[5], match[6]);
  if (!scheduled.isValid || scheduled.day !== day || scheduled.month !== month) return undefined;
  if (!match[3] && scheduled <= base) scheduled = scheduled.plus({ years: 1 });
  return scheduled;
}

function clockWordValue(value: string): number | undefined {
  const words: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12
  };
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 12) return numeric;
  return words[value];
}

/**
 * Reads the first "<number> <unit>" (minutes, hours, days) as minutes, for snooze and interval
 * settings. Returns the fallback when no duration is found.
 */
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

/**
 * True when `now` falls inside the quiet-hours window in the user's timezone. Handles windows that
 * cross midnight (for example 23:00 to 07:00).
 */
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

/**
 * When the current quiet-hours window ends, so a deferred reminder can be rescheduled to then.
 */
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

/**
 * Sets a stored HH:mm clock value on a given day.
 */
function parseClock(value: string, base: DateTime): DateTime | undefined {
  const normalized = normalizeClock(value);
  if (!normalized) return undefined;
  const [hour, minute] = normalized.split(":");

  return base.set({
    hour: Number(hour),
    minute: Number(minute),
    second: 0,
    millisecond: 0
  });
}
