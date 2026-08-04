import { describe, expect, it } from "vitest";
import {
  codexQueueJobIsClaimable,
  queuePositionFor,
  resolveCodexQueueTarget
} from "./codexQueuePolicy";

describe("Codex desktop-like queue policy", () => {
  it("keeps rapid prompts behind a new task's thread-creating job", () => {
    const first = resolveCodexQueueTarget({ forceNewThread: true, jobId: "job-1" });
    const second = resolveCodexQueueTarget({
      forceNewThread: false,
      pendingRoot: { id: "job-1", queueKey: first.queueKey },
      jobId: "job-2"
    });
    const third = resolveCodexQueueTarget({
      forceNewThread: false,
      pendingRoot: { id: "job-1", queueKey: first.queueKey },
      jobId: "job-3"
    });
    expect(first).toEqual({ newThread: true, threadId: null, queueKey: "job-1", waitingForThread: false });
    expect(second).toEqual({ newThread: false, threadId: null, queueKey: "job-1", waitingForThread: true });
    expect(third.queueKey).toBe("job-1");
    expect([0, 1, 2].map(queuePositionFor)).toEqual([1, 2, 3]);
  });

  it("keeps existing-task prompts on their selected thread", () => {
    expect(resolveCodexQueueTarget({
      forceNewThread: false,
      explicitThreadId: "thread-a",
      activeThreadId: "thread-b",
      jobId: "job-1"
    })).toEqual({
      newThread: false,
      threadId: "thread-a",
      queueKey: "thread-a",
      waitingForThread: false
    });
  });

  it("does not mix different task queues when the active selection changes", () => {
    const a = resolveCodexQueueTarget({ forceNewThread: false, explicitThreadId: "thread-a", jobId: "job-a" });
    const b = resolveCodexQueueTarget({ forceNewThread: false, explicitThreadId: "thread-b", jobId: "job-b" });
    expect(a.queueKey).not.toBe(b.queueKey);
  });

  it("waits for the creator thread id before claiming dependent prompts", () => {
    expect(codexQueueJobIsClaimable({
      status: "PENDING",
      newThread: false,
      threadId: null,
      dependencyStatus: "RUNNING"
    })).toBe(false);
    expect(codexQueueJobIsClaimable({
      status: "PENDING",
      newThread: false,
      threadId: "thread-a",
      dependencyStatus: "COMPLETED"
    })).toBe(true);
  });

  it("recovers an expired lease without allowing its dependent to overtake it", () => {
    expect(codexQueueJobIsClaimable({
      status: "RUNNING",
      leaseExpired: true,
      newThread: true,
      threadId: null
    })).toBe(true);
    expect(codexQueueJobIsClaimable({
      status: "PENDING",
      newThread: false,
      threadId: null,
      dependencyStatus: "RUNNING"
    })).toBe(false);
  });

  it("leaves dependents unclaimable after the first job fails or is blocked", () => {
    for (const dependencyStatus of ["FAILED", "BLOCKED", "CANCELED"] as const) {
      expect(codexQueueJobIsClaimable({
        status: "PENDING",
        newThread: false,
        threadId: null,
        dependencyStatus
      })).toBe(false);
    }
  });
});
