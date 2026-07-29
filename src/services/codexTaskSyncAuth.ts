import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify
} from "node:crypto";

export const CODEX_TASK_SYNC_PATH = "/codex/worker/sync";
export const CODEX_TASK_SYNC_MAX_CLOCK_SKEW_MS = 120_000;

type CodexTaskSyncSignatureInput = {
  timestamp: string;
  method: string;
  path: string;
  workerId: string;
  body: unknown;
};

export function codexTaskSyncSignaturePayload(input: CodexTaskSyncSignatureInput): Buffer {
  const bodyHash = createHash("sha256")
    .update(canonicalJson(input.body))
    .digest("hex");

  return Buffer.from([
    "threadwise-codex-task-sync-v1",
    input.timestamp,
    input.method.toUpperCase(),
    input.path,
    input.workerId,
    bodyHash
  ].join("\n"), "utf8");
}

export function signCodexTaskSyncRequest(
  privateKeyPem: string | Buffer,
  input: CodexTaskSyncSignatureInput
): string {
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("Codex task-sync signing key must be Ed25519.");
  }
  return sign(null, codexTaskSyncSignaturePayload(input), key).toString("base64");
}

export function verifyCodexTaskSyncRequest(
  publicKeyDerBase64: string,
  input: CodexTaskSyncSignatureInput,
  signatureBase64: string
): boolean {
  if (!validBase64(signatureBase64)) return false;

  try {
    const signature = Buffer.from(signatureBase64, "base64");
    if (signature.length !== 64) return false;
    const key = createPublicKey({
      key: Buffer.from(publicKeyDerBase64, "base64"),
      format: "der",
      type: "spki"
    });
    if (key.asymmetricKeyType !== "ed25519") return false;
    return verify(null, codexTaskSyncSignaturePayload(input), key, signature);
  } catch {
    return false;
  }
}

export function isFreshCodexTaskSyncTimestamp(
  timestamp: string,
  nowMs = Date.now(),
  maxClockSkewMs = CODEX_TASK_SYNC_MAX_CLOCK_SKEW_MS
): boolean {
  if (!/^\d{13}$/.test(timestamp)) return false;
  const timestampMs = Number(timestamp);
  return Number.isSafeInteger(timestampMs)
    && Math.abs(nowMs - timestampMs) <= maxClockSkewMs;
}

export function shouldReplaceCodexTaskCatalog(signedCatalogSync: boolean): boolean {
  return signedCatalogSync;
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Signed JSON cannot contain non-finite numbers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .filter((key) => object[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  throw new Error(`Unsupported signed JSON value: ${typeof value}.`);
}

function validBase64(value: string): boolean {
  return value.length > 0
    && value.length <= 128
    && value.length % 4 === 0
    && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}
