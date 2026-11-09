/**
 * Language choices for local image OCR (Tesseract): English, Burmese, or both.
 * Used by settings, general image capture and Study image capture to pick the OCR language set.
 */

export type OcrLanguages = "eng" | "mya" | "eng+mya";

/**
 * Maps free-text input ("english", "burmese", "both", Burmese script) to a Tesseract
 * language code. Returns undefined when the text is not a recognised choice.
 */
export function normalizeOcrLanguages(value: string): OcrLanguages | undefined {
  const normalized = value.trim().toLowerCase().replace(/[_-]/g, " ").replace(/\s+/g, " ");
  if (["eng", "english", "english only"].includes(normalized)) return "eng";
  if (["mya", "burmese", "myanmar", "burmese only", "myanmar only", "မြန်မာ"].includes(normalized)) return "mya";
  if (["eng+mya", "eng mya", "both", "mixed", "auto", "automatic", "english burmese", "english and burmese", "burmese and english"].includes(normalized)) return "eng+mya";
  return undefined;
}

/**
 * Picks the OCR language for one image. A language named in the caption wins for that image;
 * otherwise the user's saved setting is used, falling back to English.
 */
export function ocrLanguagesForCaption(caption: string, fallback: string): OcrLanguages {
  if (/\b(?:english|eng)\s*(?:and|\+|&)\s*(?:burmese|myanmar|mya)\b/i.test(caption)
    || /\b(?:burmese|myanmar|mya)\s*(?:and|\+|&)\s*(?:english|eng)\b/i.test(caption)) {
    return "eng+mya";
  }
  if (/\b(?:burmese|myanmar|mya)\b|မြန်မာ/i.test(caption)) return "mya";
  if (/\b(?:english|eng)\b/i.test(caption)) return "eng";
  return normalizeOcrLanguages(fallback) ?? "eng";
}

/**
 * Human-readable label for a stored OCR language value.
 */
export function formatOcrLanguages(value: string): string {
  const normalized = normalizeOcrLanguages(value) ?? "eng";
  if (normalized === "mya") return "Burmese";
  if (normalized === "eng+mya") return "English + Burmese";
  return "English";
}
