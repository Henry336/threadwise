export type QueueTarget = {
  newThread: boolean;
  threadId: string | null;
  queueKey: string;
  waitingForThread: boolean;
};

export function resolveCodexQueueTarget(input: {
  forceNewThread: boolean;
  explicitThreadId?: string | null;
  activeThreadId?: string | null;
  pendingRoot?: { id: string; queueKey: string } | null;
  jobId: string;
}): QueueTarget {
  const resumedThreadId = input.explicitThreadId ?? input.activeThreadId ?? null;
  const pendingRoot = resumedThreadId ? null : input.pendingRoot;
  const newThread = input.forceNewThread || (!resumedThreadId && !pendingRoot);
  return {
    newThread,
    threadId: newThread || pendingRoot ? null : resumedThreadId,
    queueKey: pendingRoot?.queueKey ?? (newThread ? input.jobId : resumedThreadId!),
    waitingForThread: Boolean(pendingRoot)
  };
}

export function codexQueueJobIsClaimable(input: {
  status: "WAITING_APPROVAL" | "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "BLOCKED" | "CANCELED";
  leaseExpired?: boolean;
  newThread: boolean;
  threadId?: string | null;
  dependencyStatus?: "WAITING_APPROVAL" | "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "BLOCKED" | "CANCELED" | null;
}): boolean {
  const runnableStatus = input.status === "PENDING"
    || (input.status === "RUNNING" && input.leaseExpired === true);
  const dependencyReady = input.dependencyStatus === undefined
    || input.dependencyStatus === null
    || input.dependencyStatus === "COMPLETED";
  return runnableStatus && dependencyReady && (input.newThread || Boolean(input.threadId));
}

export function queuePositionFor(index: number): number {
  return index + 1;
}
