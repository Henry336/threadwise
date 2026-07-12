export type OcrLanguages = "eng" | "mya" | "eng+mya";

export function normalizeOcrLanguages(value: string): OcrLanguages | undefined {
  const normalized = value.trim().toLowerCase().replace(/[_-]/g, " ").replace(/\s+/g, " ");
  if (["eng", "english", "english only"].includes(normalized)) return "eng";
  if (["mya", "burmese", "myanmar", "burmese only", "myanmar only", "မြန်မာ"].includes(normalized)) return "mya";
  if (["eng+mya", "eng mya", "both", "mixed", "auto", "automatic", "english burmese", "english and burmese", "burmese and english"].includes(normalized)) return "eng+mya";
  return undefined;
}

export function ocrLanguagesForCaption(caption: string, fallback: string): OcrLanguages {
  if (/\b(?:english|eng)\s*(?:and|\+|&)\s*(?:burmese|myanmar|mya)\b/i.test(caption)
    || /\b(?:burmese|myanmar|mya)\s*(?:and|\+|&)\s*(?:english|eng)\b/i.test(caption)) {
    return "eng+mya";
  }
  if (/\b(?:burmese|myanmar|mya)\b|မြန်မာ/i.test(caption)) return "mya";
  if (/\b(?:english|eng)\b/i.test(caption)) return "eng";
  return normalizeOcrLanguages(fallback) ?? "eng";
}

export function formatOcrLanguages(value: string): string {
  const normalized = normalizeOcrLanguages(value) ?? "eng";
  if (normalized === "mya") return "Burmese";
  if (normalized === "eng+mya") return "English + Burmese";
  return "English";
}
