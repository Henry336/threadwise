export type ListKind = "tasks" | "notes" | "ideas";

export function parseListRequest(text: string): ListKind | undefined {
  const normalized = normalize(text);
  const match = normalized.match(/^(?:(?:show|list|view|open)\s+)?(?:me\s+)?(?:my\s+|the\s+)?(tasks?|notes?|ideas?)$/);
  if (!match?.[1]) {
    return undefined;
  }

  const item = match[1];
  if (item.startsWith("task")) return "tasks";
  if (item.startsWith("note")) return "notes";
  return "ideas";
}

export function parseNaturalReminderBody(text: string): string | undefined {
  const normalized = text.trim();
  const match = normalized.match(/^(?:please\s+)?remind\s+(.+)$/i)
    ?? normalized.match(/^(?:please\s+)?(?:set|create|make)\s+(?:a\s+)?reminder\s+(.+)$/i);
  return match?.[1]?.trim();
}

export function parseNaturalSettingChange(text: string): string[] | undefined {
  const timezone = parseNaturalTimezoneChange(text);
  if (timezone) {
    return ["timezone", timezone];
  }

  const quiet = parseNaturalQuietHoursChange(text);
  if (quiet) {
    return quiet;
  }

  const dueNudge = parseNaturalMinutesSetting(text, /^(?:please\s+)?(?:change|set|update|make)?\s*(?:my\s+)?(?:due\s+)?nudge\s*(?:to|as)?\s+(.+)$/i, "due-nudge");
  if (dueNudge) {
    return dueNudge;
  }

  const interval = parseNaturalMinutesSetting(
    text,
    /^(?:please\s+)?(?:change|set|update|make)?\s*(?:my\s+)?(?:reminder\s+)?interval\s*(?:to|as|every)?\s+(.+)$/i,
    "interval"
  );
  if (interval) {
    return interval;
  }

  const maxMatch = text.match(/^(?:please\s+)?(?:change|set|update|make)?\s*(?:my\s+)?(?:max(?:imum)?\s+)?reminders?(?:\s+per\s+day)?\s*(?:to|as)?\s+(\d+)$/i)
    ?? text.match(/^(?:please\s+)?(?:change|set|update|make)\s+(?:my\s+)?max(?:imum)?\s*(?:to|as)?\s+(\d+)$/i);
  if (maxMatch?.[1]) {
    return ["max", maxMatch[1]];
  }

  return undefined;
}

export function parseNaturalTimezoneChange(text: string): string | undefined {
  const match = text.match(/^(?:please\s+)?(?:change|set|update|make)?\s*(?:my\s+)?(?:time\s*zone|timezone)\s*(?:to|as|is)?\s+(.+)$/i)
    ?? text.match(/^(?:please\s+)?(?:change|set|update|make)\s+(?:my\s+)?(?:time\s*zone|timezone)\s+(.+)$/i);
  const value = match?.[1]?.trim();
  if (!value) {
    return undefined;
  }

  return value.replace(/^(?:to|as|is)\s+/i, "").trim();
}

function parseNaturalQuietHoursChange(text: string): string[] | undefined {
  if (/^(?:please\s+)?(?:turn\s+)?quiet\s+hours\s+off$/i.test(text.trim())) {
    return ["quiet", "off"];
  }

  const match = text.match(/^(?:please\s+)?(?:change|set|update|make)?\s*(?:my\s+)?quiet\s+hours\s*(?:to|as)?\s+(\d{1,2}:\d{2})\s*(?:-|to|until)\s*(\d{1,2}:\d{2})$/i);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }

  return ["quiet", match[1], match[2]];
}

function parseNaturalMinutesSetting(text: string, pattern: RegExp, setting: string): string[] | undefined {
  const match = text.match(pattern);
  const value = match?.[1]?.trim();
  if (!value) {
    return undefined;
  }

  if (/^off$/i.test(value)) {
    return [setting, "off"];
  }

  const minutes = parseMinutes(value);
  return minutes ? [setting, String(minutes)] : undefined;
}

function parseMinutes(text: string): number | undefined {
  const trimmed = text.trim().toLowerCase();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  const match = trimmed.match(/^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }

  const amount = Number(match[1]);
  const unit = match[2];
  if (unit.startsWith("h")) return amount * 60;
  if (unit.startsWith("d")) return amount * 24 * 60;
  return amount;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}
