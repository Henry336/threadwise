import { generateKeyPair, exportSPKI, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import {
  DASHBOARD_TOKEN_AUDIENCE,
  DASHBOARD_TOKEN_ISSUER,
  DashboardAuthenticationError,
  DashboardConfigurationError,
  verifyDashboardAuthorization
} from "./auth";

const now = new Date("2026-07-16T10:00:00.000Z");
const nowSeconds = Math.floor(now.getTime() / 1_000);

describe("dashboard service JWT authentication", () => {
  let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
  let publicKeyPem: string;

  beforeAll(async () => {
    const keyPair = await generateKeyPair("EdDSA");
    privateKey = keyPair.privateKey;
    publicKeyPem = await exportSPKI(keyPair.publicKey);
  });

  async function token(options: { subject?: string; issuer?: string; audience?: string; issuedAt?: number; expiresAt?: number } = {}) {
    return new SignJWT({})
      .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
      .setIssuer(options.issuer ?? DASHBOARD_TOKEN_ISSUER)
      .setAudience(options.audience ?? DASHBOARD_TOKEN_AUDIENCE)
      .setSubject(options.subject ?? "123456789")
      .setIssuedAt(options.issuedAt ?? nowSeconds)
      .setExpirationTime(options.expiresAt ?? nowSeconds + 60)
      .setJti("request-1")
      .sign(privateKey);
  }

  it("accepts a short-lived EdDSA token and derives scope only from sub", async () => {
    const jwt = await token();
    const escapedPem = publicKeyPem.replace(/\n/g, "\\n");

    await expect(verifyDashboardAuthorization(`Bearer ${jwt}`, escapedPem, now)).resolves.toEqual({
      telegramId: "123456789"
    });
  });

  it.each([
    ["wrong issuer", { issuer: "another-service" }],
    ["wrong audience", { audience: "another-api" }],
    ["expired", { issuedAt: nowSeconds - 120, expiresAt: nowSeconds - 60 }],
    ["long-lived", { expiresAt: nowSeconds + 600 }],
    ["synthetic group owner", { subject: "chat:-100123" }]
  ])("rejects %s tokens", async (_label, tokenOptions) => {
    const jwt = await token(tokenOptions);
    await expect(verifyDashboardAuthorization(`Bearer ${jwt}`, publicKeyPem, now)).rejects.toBeInstanceOf(
      DashboardAuthenticationError
    );
  });

  it("rejects missing bearer credentials without parsing a key", async () => {
    await expect(verifyDashboardAuthorization(undefined, publicKeyPem, now)).rejects.toBeInstanceOf(
      DashboardAuthenticationError
    );
  });

  it("treats a missing or malformed public key as a server configuration error", async () => {
    const jwt = await token();
    await expect(verifyDashboardAuthorization(`Bearer ${jwt}`, undefined, now)).rejects.toBeInstanceOf(
      DashboardConfigurationError
    );
    await expect(verifyDashboardAuthorization(`Bearer ${jwt}`, "not-a-public-key", now)).rejects.toBeInstanceOf(
      DashboardConfigurationError
    );
  });
});
