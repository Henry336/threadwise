export function commandBody(text: string, commandName: string): string {
  const withoutCommand = text.replace(new RegExp(`^/${commandName}(?:@\\w+)?`, "i"), "");
  return withoutCommand.trim();
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

export function normalizePublicId(value: string): string {
  return value.trim().toUpperCase();
}

export function splitWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

