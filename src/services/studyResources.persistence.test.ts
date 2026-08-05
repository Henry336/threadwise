import { StudyResourceKind, type StudyWorkspace } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const client = {
    studyModule: { findFirst: vi.fn(), count: vi.fn() },
    studyResource: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    studyNoteCaptureSession: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    studyNoteCaptureSegment: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  client.$transaction.mockImplementation((operations: unknown[]) => Promise.all(operations));
  return client;
});

vi.mock("../db/prisma", () => ({ prisma: db }));

import {
  appendStudyNoteSegment,
  finalizeStudyNoteCaptureSession,
  startStudyNoteCaptureSession,
} from "./studyResources";

const workspace = {
  id: "workspace-1",
  ownerUserId: "user-1",
  boundChatId: "-222",
} as StudyWorkspace;
const module = { id: "module-1", workspaceId: workspace.id, code: "CS2100", active: true };

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation((operations: unknown[]) => Promise.all(operations));
  db.auditLog.create.mockResolvedValue({});
});

describe("durable Study note sessions", () => {
  it("creates a module-scoped session and persists each paragraph immediately", async () => {
    const session = {
      id: "session-1",
      workspaceId: workspace.id,
      moduleId: module.id,
      chatId: workspace.boundChatId,
      expiresAt: new Date(Date.now() + 60_000),
      module,
      _count: { segments: 0 },
    };
    db.studyModule.findFirst.mockResolvedValue(module);
    db.studyNoteCaptureSession.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(session);
    db.studyNoteCaptureSession.create.mockResolvedValue(session);
    db.studyNoteCaptureSegment.create.mockResolvedValue({ id: "segment-1" });
    db.studyNoteCaptureSession.update.mockResolvedValue(session);

    const started = await startStudyNoteCaptureSession(workspace, module.id);
    const appended = await appendStudyNoteSegment(workspace.id, 42, "First paragraph");

    expect(started.resumed).toBe(false);
    expect(appended).toBe("saved");
    expect(db.studyNoteCaptureSegment.create).toHaveBeenCalledWith({
      data: { sessionId: session.id, telegramMessageId: 42, text: "First paragraph" },
    });
  });

  it("combines ordered messages as paragraphs without changing their text", async () => {
    const session = {
      id: "session-1",
      workspaceId: workspace.id,
      moduleId: module.id,
      chatId: workspace.boundChatId,
      module,
      segments: [
        { telegramMessageId: 41, text: "  Cache misses stall the pipeline.", createdAt: new Date("2026-08-04T00:00:00Z") },
        { telegramMessageId: 42, text: "The next paragraph keeps its wording.  ", createdAt: new Date("2026-08-04T00:01:00Z") },
      ],
    };
    db.studyNoteCaptureSession.findUnique.mockResolvedValue(session);
    db.studyModule.findFirst.mockResolvedValue(module);
    db.studyResource.findMany.mockResolvedValue([]);
    db.studyResource.findFirst.mockResolvedValue(null);
    db.studyResource.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "resource-1",
      ...data,
      kind: StudyResourceKind.NOTE,
      module,
    }));
    db.studyNoteCaptureSession.delete.mockResolvedValue(session);

    const result = await finalizeStudyNoteCaptureSession(workspace);

    expect(result?.paragraphCount).toBe(2);
    expect(db.studyResource.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        title: "Cache misses stall the pipeline.",
        body: "  Cache misses stall the pipeline.\n\nThe next paragraph keeps its wording.  ",
        sourceMessageId: 41,
      }),
    }));
    expect(db.studyNoteCaptureSession.delete).toHaveBeenCalledWith({ where: { id: session.id } });
  });
});
