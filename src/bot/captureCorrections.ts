export type CaptureCorrectionKind = "task" | "reminder" | "note" | "idea";

export type CaptureCorrection = {
  kind: CaptureCorrectionKind;
  reminderTimeText?: string;
};

/**
 * Parses explicit references to the immediately preceding capture. This is
 * intentionally narrower than ordinary intent classification: words such as
 * "note" or "task" only become a correction when the user also refers to
 * "this" or "that" and asks to save/change it.
 */
export function parseCaptureCorrection(text: string): CaptureCorrection | undefined {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed || !/\b(?:this|that)\b/i.test(trimmed)) return undefined;

  const notPattern = trimmed.match(
    /^(?:no[,!]?\s*)?(?:this|that)\s+(?:was|is|should be)\s+(?:an?\s+)?(task|reminder|note|idea)\s*,?\s+not\s+(?:an?\s+)?(?:task|reminder|note|idea)[.!]?$/i,
  );
  if (notPattern?.[1]) return { kind: normalizeKind(notPattern[1]) };

  const changePattern = trimmed.match(
    /^(?:(?:please\s+)?(?:make|change|turn|save|file|keep)\s+)(?:this|that)(?:\s+(?:one|item|message))?\s+(?:(?:as|into|to)\s+)?(?:an?\s+)?(task|reminder|note|idea)(?:\s+instead)?(?:\s+(?:for|at|on)\s+(.+))?[.!]?$/i,
  );
  if (!changePattern?.[1]) return undefined;

  const kind = normalizeKind(changePattern[1]);
  return {
    kind,
    reminderTimeText: kind === "reminder" ? changePattern[2]?.trim().replace(/[.!]+$/, "") : undefined,
  };
}

function normalizeKind(value: string): CaptureCorrectionKind {
  return value.toLowerCase() as CaptureCorrectionKind;
}
