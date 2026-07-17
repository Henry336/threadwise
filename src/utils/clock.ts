const CLOCK = /^(\d{1,2}):(\d{2})$/;

/**
 * Accept a human-friendly 24-hour clock and return the canonical HH:mm form.
 * Values outside 00:00-23:59 are rejected instead of being rolled over.
 */
export function normalizeClock(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(CLOCK);
  if (!match?.[1] || !match[2]) return undefined;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return undefined;
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
