import { beforeEach, describe, expect, it, vi } from "vitest";
import { StudyResourceKind, type StudyWorkspace } from "@prisma/client";

const mocks = vi.hoisted(() => {
  const tx = {
    studyResource: { updateMany: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return {
    tx,
    prisma: { ...tx, $transaction: vi.fn((callback: (database: typeof tx) => unknown) => callback(tx)) },
    findStudyResource: vi.fn(),
    recordStudyNoteRevision: vi.fn(),
    rebuildStudyNoteLinks: vi.fn(),
    studyNoteMetadata: vi.fn(),
  };
});

vi.mock("../db/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("../services/studyResources", () => ({
  findStudyResource: mocks.findStudyResource,
  createStudyResource: vi.fn(),
  archiveStudyResource: vi.fn(),
}));
vi.mock("../services/studyMarkdown", async (importOriginal) => ({
  ...await importOriginal<typeof import("../services/studyMarkdown")>(),
  recordStudyNoteRevision: mocks.recordStudyNoteRevision,
  rebuildStudyNoteLinks: mocks.rebuildStudyNoteLinks,
  studyNoteMetadata: mocks.studyNoteMetadata,
}));

import { updateDashboardStudyResource } from "./study";

const workspace = { id: "workspace", ownerUserId: "owner" } as StudyWorkspace;
const resource = {
  id: "resource", workspaceId: workspace.id, moduleId: "module", publicId: "NOTE-1",
  kind: StudyResourceKind.NOTE, title: "Before", body: "Before body", url: null, tags: [],
  telegramFileId: null, telegramUniqueId: null, mediaKind: null, mimeType: null, fileName: null,
  fileSize: null, caption: null, ocrText: null, analysisExcerpt: "Before body",
  analysisExcerptTruncated: false, wikiLookupKeys: ["before", "note-1"], searchTokens: [],
  ocrConfidence: null, sourceMessageId: null, sourceSenderTelegramId: null, sourceSentAt: null,
  pinnedAt: null, archivedAt: null, createdAt: new Date(), updatedAt: new Date("2026-08-17T00:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation((callback: (database: typeof mocks.tx) => unknown) => callback(mocks.tx));
  mocks.findStudyResource.mockResolvedValue(resource);
  mocks.tx.studyResource.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.studyResource.findUniqueOrThrow.mockResolvedValue({ ...resource, title: "After", module: { id: "module" } });
  mocks.tx.auditLog.create.mockResolvedValue({});
  mocks.studyNoteMetadata.mockResolvedValue({});
});

describe("atomic Study note updates", () => {
  it("commits the note, revision, links, and audit through the same transaction client", async () => {
    await updateDashboardStudyResource(workspace, resource.id, { title: "After", expectedUpdatedAt: resource.updatedAt.toISOString() });
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.recordStudyNoteRevision).toHaveBeenCalledWith(expect.objectContaining({ title: "After" }), "DASHBOARD", mocks.tx);
    expect(mocks.rebuildStudyNoteLinks).toHaveBeenCalledWith(workspace.id, resource.id, mocks.tx);
    expect(mocks.tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "study.resource.dashboard_updated" }) });
  });

  it("does not write any side effect after an optimistic-concurrency conflict", async () => {
    mocks.tx.studyResource.updateMany.mockResolvedValue({ count: 0 });
    await expect(updateDashboardStudyResource(workspace, resource.id, { body: "Concurrent", expectedUpdatedAt: resource.updatedAt.toISOString() }))
      .rejects.toMatchObject({ code: "conflict" });
    expect(mocks.recordStudyNoteRevision).not.toHaveBeenCalled();
    expect(mocks.rebuildStudyNoteLinks).not.toHaveBeenCalled();
    expect(mocks.tx.auditLog.create).not.toHaveBeenCalled();
  });
});
