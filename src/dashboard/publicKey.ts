/**
 * Ed25519 public key used by auth.ts to verify dashboard service tokens.
 * main.ts passes this committed value to the server on purpose, so a stale env var cannot override it.
 */
// Public verification material for the first-party dashboard deployment.
// This is safe to commit: only Vercel holds the matching private key.
// Rotate this value and the Vercel private key together.
export const defaultDashboardPublicKey = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAy1U1FNUKbtWS8lpqXeWkLZFqbeYF3iiCRVD7MJ1Zdzw=
-----END PUBLIC KEY-----`;
