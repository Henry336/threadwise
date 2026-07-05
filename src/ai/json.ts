export function safeJsonParse<T>(text: string, fallback: T): T {
  try {
    const trimmed = text.trim();
    const jsonText = trimmed.startsWith("```")
      ? trimmed.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim()
      : trimmed;
    return JSON.parse(jsonText) as T;
  } catch {
    return fallback;
  }
}

export function clampScore(value: unknown): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    return 5;
  }

  return Math.max(1, Math.min(10, Math.round(numberValue)));
}

