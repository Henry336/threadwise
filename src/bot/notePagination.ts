import { h } from "../utils/html";

export const NOTE_PAGE_BODY_BUDGET = 3_050;

export function paginateNoteBody(body: string, budget = NOTE_PAGE_BODY_BUDGET): string[] {
  const normalized = body.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [""];

  const blocks = normalized.split(/\n{2,}/);
  const units = blocks.flatMap((block) => splitOversizedUnit(block, budget));
  const pages: string[] = [];
  let page = "";

  for (const unit of units) {
    const candidate = page ? `${page}\n\n${unit}` : unit;
    if (page && escapedLength(candidate) > budget) {
      pages.push(page);
      page = unit;
    } else {
      page = candidate;
    }
  }

  if (page || pages.length === 0) pages.push(page);
  return pages;
}

export function boundedNotePage(requestedPage: number, totalPages: number): number {
  if (!Number.isFinite(requestedPage)) return 1;
  return Math.min(Math.max(1, Math.trunc(requestedPage)), Math.max(1, totalPages));
}

function splitOversizedUnit(value: string, budget: number): string[] {
  if (escapedLength(value) <= budget) return [value];

  const sentences = value.match(/[^.!?\n]+(?:[.!?]+(?=\s|$)|$)|\n+/g)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean) ?? [value];
  if (sentences.length > 1) return packUnits(sentences, budget, " ");

  const words = value.split(/\s+/).filter(Boolean);
  if (words.length > 1) return packUnits(words, budget, " ");

  return packUnits(graphemes(value), budget, "");
}

function packUnits(units: string[], budget: number, separator: string): string[] {
  const chunks: string[] = [];
  let chunk = "";

  for (const unit of units) {
    if (escapedLength(unit) > budget) {
      if (chunk) {
        chunks.push(chunk);
        chunk = "";
      }
      const parts = graphemes(unit);
      if (parts.length <= 1) chunks.push(unit);
      else chunks.push(...packUnits(parts, budget, ""));
      continue;
    }

    const candidate = chunk ? `${chunk}${separator}${unit}` : unit;
    if (chunk && escapedLength(candidate) > budget) {
      chunks.push(chunk);
      chunk = unit;
    } else {
      chunk = candidate;
    }
  }

  if (chunk) chunks.push(chunk);
  return chunks;
}

function graphemes(value: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(segmenter.segment(value), (part) => part.segment);
  }
  return Array.from(value);
}

function escapedLength(value: string): number {
  return h(value).length;
}
