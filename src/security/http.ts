import { timingSafeEqual } from "node:crypto";

// Small HTTP helpers shared by server.ts and the side-project routes: token checks and HTML escaping.

function authToken(value?: string): string | undefined {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

/** Node gives a repeated header as an array; only the first value is used. */
export function headerToken(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** True only when the request carries exactly the expected token; false when no token is configured. */
export function isAdminAuthorized(authorization: string | undefined, adminHeader: string | string[] | undefined, expectedToken: string | undefined): boolean {
  if (!expectedToken) {
    return false;
  }

  const token = authToken(authorization) ?? headerToken(adminHeader);
  if (!token) return false;
  const actual = Buffer.from(token);
  const expected = Buffer.from(expectedToken);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Escapes text for the plain HTML pages the OAuth callbacks return. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
