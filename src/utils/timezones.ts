/**
 * Timezone input for settings. Accepts IANA names (Asia/Singapore) and a few common aliases
 * ("Myanmar", "KL", "Singapore"). Telegram does not tell bots the user's timezone, so users set
 * it by text and this file validates it.
 */

import { DateTime } from "luxon";

const TIMEZONE_ALIASES: Record<string, string> = {
  "asia/myanmar": "Asia/Yangon",
  "myanmar": "Asia/Yangon",
  "burma": "Asia/Yangon",
  "yangon": "Asia/Yangon",
  "rangoon": "Asia/Yangon",
  "malaysia": "Asia/Kuala_Lumpur",
  "kuala lumpur": "Asia/Kuala_Lumpur",
  "kl": "Asia/Kuala_Lumpur",
  "singapore": "Asia/Singapore",
  "sg": "Asia/Singapore",
  "new york": "America/New_York",
  "nyc": "America/New_York",
  "london": "Europe/London",
  "sydney": "Australia/Sydney",
  "tokyo": "Asia/Tokyo",
  "utc": "UTC"
};

export const TIMEZONE_EXAMPLES = [
  "Asia/Singapore",
  "Asia/Yangon",
  "Asia/Kuala_Lumpur",
  "America/New_York",
  "Europe/London",
  "Australia/Sydney"
];

export type TimezoneParseResult =
  | { ok: true; timezone: string; wasAlias: boolean }
  | { ok: false; input: string; suggestion?: string };

/**
 * Resolves user input to a valid IANA timezone: alias table first, then exact or case-insensitive
 * IANA match. On failure it may return a suggestion with the same city name.
 */
export function parseTimezone(input: string): TimezoneParseResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, input: trimmed };
  }

  const alias = TIMEZONE_ALIASES[normalizeLookupKey(trimmed)];
  if (alias) {
    return { ok: true, timezone: alias, wasAlias: alias !== trimmed };
  }

  const candidate = normalizeIanaCandidate(trimmed);
  const supported = findSupportedTimezone(candidate);
  if (supported) {
    return { ok: true, timezone: supported, wasAlias: supported !== trimmed };
  }

  const suggestion = closestTimezoneSuggestion(candidate);
  return suggestion ? { ok: false, input: trimmed, suggestion } : { ok: false, input: trimmed };
}

/**
 * True when Luxon accepts the name as a timezone.
 */
export function isValidTimezone(timezone: string): boolean {
  return DateTime.local().setZone(timezone).isValid;
}

export function formatTimezoneExamples(): string {
  return TIMEZONE_EXAMPLES.join(", ");
}

function normalizeLookupKey(value: string): string {
  return value.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ").toLowerCase();
}

function normalizeIanaCandidate(value: string): string {
  return value.trim().replace(/\s+/g, "_");
}

/**
 * Finds the exact or case-insensitive IANA name from the runtime's timezone list,
 * then falls back to asking Luxon directly.
 */
function findSupportedTimezone(candidate: string): string | undefined {
  if (candidate.toUpperCase() === "UTC") {
    return "UTC";
  }

  const supported = supportedTimezones();
  const exact = supported.find((timezone) => timezone === candidate);
  if (exact) {
    return exact;
  }

  const lower = candidate.toLowerCase();
  return supported.find((timezone) => timezone.toLowerCase() === lower) ?? (isValidTimezone(candidate) ? candidate : undefined);
}

/**
 * Suggests an IANA zone whose city part matches the input, for example "singapore" or
 * "Asia/singapore" giving "Asia/Singapore".
 */
function closestTimezoneSuggestion(candidate: string): string | undefined {
  const lower = candidate.toLowerCase();
  const city = lower.includes("/") ? lower.split("/").pop() : lower;
  if (!city) {
    return undefined;
  }

  return supportedTimezones().find((timezone) => timezone.toLowerCase().endsWith(`/${city}`));
}

/**
 * All timezone names the Node runtime knows, plus UTC. Older runtimes without
 * `Intl.supportedValuesOf` return only UTC.
 */
function supportedTimezones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] };
  return ["UTC", ...(intl.supportedValuesOf?.("timeZone") ?? [])];
}
