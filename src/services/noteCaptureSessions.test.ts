import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sessionFindUnique: vi.fn(),
  sessionCreate: vi.fn(),
  sessionDelete: vi.fn(),
  sessionDeleteMany: vi.fn(),
  sessionFindFirst: vi.fn(),
  sessionFindMany: vi.fn(),
  sessionUpdate: vi.fn(),
  segmentCreate: vi.fn(),
  noteCreate: vi.fn(),
  transaction: vi.fn(),
  nextPublicId: vi.fn(),
  recordCreateUndo: vi.fn(),
}));

const transactionClient = {
  noteCaptureSession: {
    findUnique: mocks.sessionFindUnique,
    delete: mocks.sessionDelete,
  },
  note: { create: mocks.noteCreate },
};

vi.mock("../db/prisma", () => ({
  prisma: {
    noteCaptureSession: {
      findUnique: mocks.sessionFindUnique,
      create: mocks.sessionCreate,
      delete: mocks.sessionDelete,
      deleteMany: mocks.sessionDeleteMany,
      findFirst: mocks.sessionFindFirst,
      findMany: mocks.sessionFindMany,
      update: mocks.sessionUpdate,
    },
    noteCaptureSegment: { create: mocks.segmentCreate },
    $transaction: mocks.transaction,
  },
}));

vi.mock("./publicIds", () => ({ nextPublicId: mocks.nextPublicId }));
vi.mock("./undo", () => ({ recordCreateUndo: mocks.recordCreateUndo }));

import {
  appendNoteCaptureParagraph,
  deriveCapturedNoteTitle,
  finalizeNoteCaptureSession,
} from "./noteCaptureSessions";

describe("durable note capture sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (operation: unknown) => {
      if (typeof operation === "function") {
        return (operation as (tx: typeof transactionClient) => unknown)(transactionClient);
      }
      return operation;
    });
  });

  it("persists each paragraph with its Telegram message id before staying silent", async () => {
    mocks.sessionFindUnique.mockResolvedValue({
      id: "session-1",
      expiresAt: new Date(Date.now() + 60_000),
    });
    mocks.segmentCreate.mockReturnValue({ operation: "insert-segment" });
    mocks.sessionUpdate.mockReturnValue({ operation: "extend-expiry" });

    await expect(appendNoteCaptureParagraph("user-1", 501, "Exact paragraph."))
      .resolves.toBe("saved");

    expect(mocks.segmentCreate).toHaveBeenCalledWith({
      data: {
        sessionId: "session-1",
        telegramMessageId: 501,
        text: "Exact paragraph.",
      },
    });
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });

  it("combines stored messages as exact blank-line-separated paragraphs", async () => {
    mocks.sessionFindUnique
      .mockResolvedValueOnce({
        id: "session-2",
        userId: "user-2",
        telegramChatId: "900",
        segments: [
          { telegramMessageId: 1, text: "First paragraph, unchanged." },
          { telegramMessageId: 2, text: "Second paragraph\nwith its own line." },
        ],
      })
      .mockResolvedValueOnce({ id: "session-2" });
    mocks.nextPublicId.mockResolvedValue("NOTE-9");
    mocks.noteCreate.mockResolvedValue({
      id: "note-row-9",
      publicId: "NOTE-9",
      title: "First paragraph, unchanged.",
    });

    const result = await finalizeNoteCaptureSession("user-2");

    expect(mocks.noteCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-2",
        publicId: "NOTE-9",
        title: "First paragraph, unchanged.",
        body: "First paragraph, unchanged.\n\nSecond paragraph\nwith its own line.",
        sourceText: "First paragraph, unchanged.\n\nSecond paragraph\nwith its own line.",
      }),
    });
    expect(mocks.sessionDelete).toHaveBeenCalledWith({ where: { id: "session-2" } });
    expect(result).toEqual({
      chatId: "900",
      paragraphCount: 2,
      note: {
        id: "note-row-9",
        publicId: "NOTE-9",
        title: "First paragraph, unchanged.",
      },
    });
  });

  it("derives a compact Unicode-safe title from the first meaningful sentence", () => {
    const title = deriveCapturedNoteTitle([
      "   ",
      `${"🧵".repeat(100)} More text that should not become the title`,
    ]);

    expect(Array.from(title).length).toBeLessThanOrEqual(84);
    expect(title.endsWith("…")).toBe(true);
    expect(title).not.toContain("\uFFFD");
  });
});
