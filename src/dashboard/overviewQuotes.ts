import type { Prisma } from "@prisma/client";

export const OVERVIEW_QUOTE_LIMIT = 40;
export const OVERVIEW_QUOTE_TEXT_LIMIT = 280;
export const OVERVIEW_QUOTE_AUTHOR_LIMIT = 120;

export type DashboardOverviewQuote = {
  text: string;
  author?: string;
};

function compact(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.replace(/\s+/g, " ").trim() || undefined;
}

export function normalizeOverviewQuotes(value: Prisma.JsonValue | unknown): DashboardOverviewQuote[] {
  if (!Array.isArray(value)) return [];

  const quotes: DashboardOverviewQuote[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const text = compact((item as Record<string, unknown>).text);
    const author = compact((item as Record<string, unknown>).author);
    if (!text || text.length > OVERVIEW_QUOTE_TEXT_LIMIT || (author?.length ?? 0) > OVERVIEW_QUOTE_AUTHOR_LIMIT) continue;
    const key = `${text.toLocaleLowerCase("en")}\u0000${author?.toLocaleLowerCase("en") ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    quotes.push({ text, ...(author ? { author } : {}) });
    if (quotes.length === OVERVIEW_QUOTE_LIMIT) break;
  }
  return quotes;
}
