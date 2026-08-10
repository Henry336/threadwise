import { StudyResourceKind, type StudyWorkspace } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const client = {
    studyModule: { findFirst: vi.fn(), count: vi.fn() },
    studyWorkspace: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    studyResource: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    studyPendingCapture: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    studyNoteCaptureSession: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    studyNoteCaptureSegment: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  client.$transaction.mockImplementation((input: unknown) => typeof input === "function"
    ? (input as (tx: typeof client) => unknown)(client)
    : Promise.all(input as unknown[]));
  return client;
});

vi.mock("../db/prisma", () => ({ prisma: db }));

import {
  appendStudyNoteSegment,
  consumeStudyPendingCapture,
  createStudyPendingCapture,
  finalizeStudyNoteCaptureSession,
  setActiveStudyModule,
  studyCaptureContext,
  startStudyNoteCaptureSession,
} from "./studyResources";

const workspace = {
  id: "workspace-1",
  ownerUserId: "user-1",
  boundChatId: "-222",
} as StudyWorkspace;
const module = { id: "module-1", workspaceId: workspace.id, code: "CS2100", active: true };

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  db.$transaction.mockImplementation((input: unknown) => typeof input === "function"
    ? (input as (tx: typeof db) => unknown)(db)
    : Promise.all(input as unknown[]));
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

describe("durable pending Study captures", () => {
  it("claims a capture once so duplicate callbacks cannot save it twice", async () => {
    const pending = { id: "pending-1", workspaceId: workspace.id, token: "token-1", expiresAt: new Date(Date.now() + 60_000) };
    db.studyPendingCapture.findFirst.mockResolvedValue(pending);
    db.studyPendingCapture.deleteMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    await expect(consumeStudyPendingCapture(workspace.id, pending.token)).resolves.toEqual(pending);
    await expect(consumeStudyPendingCapture(workspace.id, pending.token)).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("temporary Study capture context", () => {
  it("starts a visible ten-minute module context", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T10:00:00Z"));
    db.studyModule.findFirst.mockResolvedValue(module);
    db.studyWorkspace.update.mockResolvedValue({});

    await setActiveStudyModule(workspace, module.code);

    expect(db.studyWorkspace.update).toHaveBeenCalledWith({
      where: { id: workspace.id },
      data: { activeModuleId: module.id, activeModuleUntil: new Date("2026-08-10T10:10:00Z") },
    });
  });

  it("switching modules replaces the target and resets the ten-minute window", async () => {
    const secondModule = { ...module, id: "module-2", code: "CS2102" };
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T10:00:00Z"));
    db.studyModule.findFirst.mockResolvedValueOnce(module).mockResolvedValueOnce(secondModule);
    db.studyWorkspace.update.mockResolvedValue({});

    await setActiveStudyModule(workspace, module.code);
    vi.setSystemTime(new Date("2026-08-10T10:04:00Z"));
    await setActiveStudyModule(workspace, secondModule.code);

    expect(db.studyWorkspace.update).toHaveBeenLastCalledWith({
      where: { id: workspace.id },
      data: { activeModuleId: secondModule.id, activeModuleUntil: new Date("2026-08-10T10:14:00Z") },
    });
  });

  it("ordinary pending captures preserve source metadata without extending module context", async () => {
    const sourceSentAt = new Date("2026-08-10T10:01:00Z");
    db.studyModule.count.mockResolvedValue(1);
    db.studyPendingCapture.deleteMany.mockResolvedValue({ count: 0 });
    db.studyPendingCapture.create.mockResolvedValue({ id: "pending-2" });

    await createStudyPendingCapture(workspace, {
      moduleId: module.id,
      telegramFileId: "file-1",
      sourceText: "Architecture diagram",
      sourceMessageId: 42,
      sourceSenderTelegramId: "5969845149",
      sourceSentAt,
    });

    expect(db.studyWorkspace.update).not.toHaveBeenCalled();
    expect(db.studyPendingCapture.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        moduleId: module.id,
        sourceText: "Architecture diagram",
        sourceMessageId: 42,
        sourceSenderTelegramId: "5969845149",
        sourceSentAt,
      }),
    });
  });

  it("restores an unexpired context from durable workspace state", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T10:05:00Z"));
    db.studyWorkspace.findUnique.mockResolvedValue({
      activeModuleId: module.id,
      activeModuleUntil: new Date("2026-08-10T10:10:00Z"),
    });
    db.studyModule.findFirst.mockResolvedValue(module);

    await expect(studyCaptureContext(workspace)).resolves.toMatchObject({
      module,
      remainingMinutes: 5,
    });
  });

  it("treats legacy and expired selections as inactive and clears them", async () => {
    db.studyWorkspace.findUnique.mockResolvedValue({ activeModuleId: module.id, activeModuleUntil: null });
    db.studyWorkspace.updateMany.mockResolvedValue({ count: 1 });

    await expect(studyCaptureContext(workspace)).resolves.toBeUndefined();
    expect(db.studyWorkspace.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { activeModuleId: null, activeModuleUntil: null },
    }));

    vi.clearAllMocks();
    const expired = { activeModuleId: module.id, activeModuleUntil: new Date("2026-08-10T09:59:00Z") };
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T10:00:00Z"));
    db.studyWorkspace.findUnique.mockResolvedValue(expired);
    db.studyWorkspace.updateMany.mockResolvedValue({ count: 1 });

    await expect(studyCaptureContext(workspace)).resolves.toBeUndefined();
    expect(db.studyWorkspace.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { activeModuleId: null, activeModuleUntil: null },
    }));
  });
});
