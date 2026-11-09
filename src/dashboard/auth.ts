/**
 * Verifies the short-lived service token the Vercel dashboard sends with every API call.
 * The dashboard signs an EdDSA (Ed25519) JWT whose subject is the verified Telegram id;
 * this file checks it against the committed public key and returns the caller's identity.
 * Used by the request guard in route.ts. Replay of the same token id is blocked separately.
 */
import { importSPKI, jwtVerify } from "jose";

export const DASHBOARD_TOKEN_ISSUER = "threadwise-dashboard";
export const DASHBOARD_TOKEN_AUDIENCE = "threadwise-api";
export const DASHBOARD_TOKEN_MAX_AGE_SECONDS = 120;

const TELEGRAM_USER_ID = /^[1-9]\d{0,19}$/;
const BEARER_TOKEN = /^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i;
const MAX_AUTHORIZATION_HEADER_LENGTH = 8_192;

let cachedPublicKeyText: string | undefined;
let cachedPublicKey: Awaited<ReturnType<typeof importSPKI>> | undefined;

export class DashboardAuthenticationError extends Error {
  constructor() {
    super("Invalid dashboard bearer token.");
    this.name = "DashboardAuthenticationError";
  }
}

export class DashboardConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DashboardConfigurationError";
  }
}

/** The verified caller: Telegram id, the token's unique id (jti) for replay checks, and its expiry. */
export type DashboardPrincipal = {
  telegramId: string;
  tokenId: string;
  expiresAt: Date;
};

/** Pulls the compact JWT out of an "Authorization: Bearer ..." header, rejecting oversized or malformed headers. */
function bearerToken(authorization: string | undefined): string {
  if (!authorization || authorization.length > MAX_AUTHORIZATION_HEADER_LENGTH) {
    throw new DashboardAuthenticationError();
  }

  const match = authorization.match(BEARER_TOKEN);
  if (!match?.[1]) {
    throw new DashboardAuthenticationError();
  }

  return match[1];
}

/** Turns escaped "\n" sequences (common in env vars) back into real newlines so the PEM key parses. */
function normalizedPublicKey(value: string | undefined): string {
  if (!value?.trim()) {
    throw new DashboardConfigurationError("DASHBOARD_API_PUBLIC_KEY is not configured.");
  }

  return value.replace(/\\n/g, "\n").trim();
}

/** Imports the Ed25519 public key once and caches it, so each request does not re-parse the PEM text. */
async function dashboardPublicKey(value: string | undefined) {
  const normalized = normalizedPublicKey(value);
  if (cachedPublicKeyText === normalized && cachedPublicKey) {
    return cachedPublicKey;
  }

  try {
    const key = await importSPKI(normalized, "EdDSA");
    cachedPublicKeyText = normalized;
    cachedPublicKey = key;
    return key;
  } catch {
    throw new DashboardConfigurationError("DASHBOARD_API_PUBLIC_KEY is not a valid Ed25519 public key.");
  }
}

/**
 * Checks signature, issuer, audience, required claims and a maximum 120-second lifetime,
 * then re-checks that the subject looks like a Telegram id and the jti is bounded.
 * Every failure becomes the same DashboardAuthenticationError, so callers learn nothing
 * about why a token was rejected. A missing or bad key is a configuration error instead.
 */
export async function verifyDashboardAuthorization(
  authorization: string | undefined,
  publicKeyText: string | undefined,
  currentDate = new Date()
): Promise<DashboardPrincipal> {
  const token = bearerToken(authorization);
  const publicKey = await dashboardPublicKey(publicKeyText);

  try {
    const { payload } = await jwtVerify(token, publicKey, {
      algorithms: ["EdDSA"],
      issuer: DASHBOARD_TOKEN_ISSUER,
      audience: DASHBOARD_TOKEN_AUDIENCE,
      typ: "JWT",
      requiredClaims: ["sub", "iat", "exp", "jti"],
      maxTokenAge: DASHBOARD_TOKEN_MAX_AGE_SECONDS,
      clockTolerance: 5,
      currentDate
    });

    const issuedAt = payload.iat;
    const expiresAt = payload.exp;
    if (
      !payload.sub ||
      !TELEGRAM_USER_ID.test(payload.sub) ||
      typeof issuedAt !== "number" ||
      typeof expiresAt !== "number" ||
      !Number.isInteger(issuedAt) ||
      !Number.isInteger(expiresAt) ||
      expiresAt <= issuedAt ||
      expiresAt - issuedAt > DASHBOARD_TOKEN_MAX_AGE_SECONDS ||
      typeof payload.jti !== "string" ||
      payload.jti.length < 1 ||
      payload.jti.length > 128
    ) {
      throw new DashboardAuthenticationError();
    }

    return {
      telegramId: payload.sub,
      tokenId: payload.jti,
      expiresAt: new Date(expiresAt * 1_000),
    };
  } catch (error) {
    if (error instanceof DashboardAuthenticationError) {
      throw error;
    }
    throw new DashboardAuthenticationError();
  }
}
