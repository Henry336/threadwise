import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CODEX_TASK_SYNC_PATH,
  isFreshCodexTaskSyncTimestamp,
  signCodexTaskSyncRequest,
  verifyCodexTaskSyncRequest
} from "./codexTaskSyncAuth";

describe("Codex task-sync request signing", () => {
  const keys = generateKeyPairSync("ed25519");
  const privateKey = keys.privateKey.export({ format: "pem", type: "pkcs8" });
  const publicKey = keys.publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const input = {
    timestamp: "1785330000000",
    method: "POST",
    path: CODEX_TASK_SYNC_PATH,
    workerId: "henry-laptop-task-sync",
    body: {
      workerId: "henry-laptop-task-sync",
      projects: [{ alias: "threadwise", path: "C:\\Projects\\Threadwise" }],
      threads: [{ id: "019fa9fc", cwd: "C:\\Projects\\Threadwise", title: "Telegram Codex" }]
    }
  };

  it("verifies the signed metadata request independent of object key order", () => {
    const signature = signCodexTaskSyncRequest(privateKey, input);
    expect(verifyCodexTaskSyncRequest(publicKey, input, signature)).toBe(true);
    expect(verifyCodexTaskSyncRequest(publicKey, {
      ...input,
      body: {
        threads: input.body.threads,
        projects: input.body.projects,
        workerId: input.body.workerId
      }
    }, signature)).toBe(true);
  });

  it.each([
    ["body", { ...input, body: { ...input.body, projects: [] } }],
    ["path", { ...input, path: "/codex/worker/claim" }],
    ["method", { ...input, method: "GET" }],
    ["worker", { ...input, workerId: "other-worker" }],
    ["timestamp", { ...input, timestamp: "1785330000001" }]
  ])("rejects %s tampering", (_field, tampered) => {
    const signature = signCodexTaskSyncRequest(privateKey, input);
    expect(verifyCodexTaskSyncRequest(publicKey, tampered, signature)).toBe(false);
  });

  it("rejects malformed signatures and non-Ed25519 keys", () => {
    expect(verifyCodexTaskSyncRequest(publicKey, input, "not-base64")).toBe(false);
    expect(() => signCodexTaskSyncRequest(
      generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "pem", type: "pkcs8" }),
      input
    )).toThrow(/Ed25519/);
  });

  it("accepts only fresh millisecond timestamps", () => {
    expect(isFreshCodexTaskSyncTimestamp("1785330000000", 1785330119999)).toBe(true);
    expect(isFreshCodexTaskSyncTimestamp("1785330000000", 1785330120001)).toBe(false);
    expect(isFreshCodexTaskSyncTimestamp("1785330200000", 1785330000000)).toBe(false);
    expect(isFreshCodexTaskSyncTimestamp("1785330000", 1785330000000)).toBe(false);
    expect(isFreshCodexTaskSyncTimestamp("not-a-time", 1785330000000)).toBe(false);
  });
});
