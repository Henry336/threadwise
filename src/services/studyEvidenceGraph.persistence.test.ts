import { beforeEach, describe, expect, it, vi } from "vitest";
import { StudyAnalysisMode, type StudyWorkspace } from "@prisma/client";

const db = vi.hoisted(() => ({
  studyModule: { findFirst: vi.fn() },
  studySession: { findMany: vi.fn() },
  studyResource: { findMany: vi.fn() },
  studyItem: { findMany: vi.fn() },
  studyCanvasCourseModule: { findMany: vi.fn() },
  studyCanvasMaterial: { findMany: vi.fn() },
  studyCanvasAssignment: { findMany: vi.fn() },
  studyCanvasSync: { findUnique: vi.fn() },
}));

vi.mock("../db/prisma", () => ({ prisma: db }));
import { collectStudyEvidence } from "./studyEvidenceGraph";

beforeEach(() => {
  vi.clearAllMocks();
  db.studyModule.findFirst.mockResolvedValue({ id: "module", code: "CS2100", name: "Computer Organisation" });
  db.studySession.findMany.mockResolvedValue([]);
  db.studyResource.findMany.mockResolvedValue([]);
  db.studyItem.findMany.mockResolvedValue([]);
  db.studyCanvasCourseModule.findMany.mockResolvedValue([]);
  db.studyCanvasMaterial.findMany.mockResolvedValue([]);
  db.studyCanvasAssignment.findMany.mockResolvedValue([]);
  db.studyCanvasSync.findUnique.mockResolvedValue(null);
});

describe("Study evidence query budgets", () => {
  it("selects bounded excerpts instead of full protected resource and Canvas bodies", async () => {
    await collectStudyEvidence({ id: "workspace", timezone: "Asia/Singapore" } as StudyWorkspace, "module", StudyAnalysisMode.CONNECTIONS);

    const resourceQuery = db.studyResource.findMany.mock.calls[0]![0];
    expect(resourceQuery.take).toBe(28);
    expect(resourceQuery.select).toMatchObject({ analysisExcerpt: true, analysisExcerptTruncated: true });
    expect(resourceQuery.select).not.toHaveProperty("body");
    expect(resourceQuery.select).not.toHaveProperty("ocrText");
    expect(resourceQuery.select).not.toHaveProperty("caption");

    const canvasQuery = db.studyCanvasMaterial.findMany.mock.calls[0]![0];
    expect(canvasQuery.take).toBe(28);
    expect(canvasQuery.select).toMatchObject({ analysisExcerpt: true });
    expect(canvasQuery.select).not.toHaveProperty("extractedText");
  });

  it("keeps pre-backfill evidence readable through a tenant-scoped bounded fallback", async () => {
    const now = new Date("2026-08-17T00:00:00.000Z");
    db.studyResource.findMany
      .mockResolvedValueOnce([{
        id: "resource", publicId: "SNOTE-1", kind: "NOTE", title: "Legacy note", url: null, tags: [],
        analysisExcerpt: null, analysisExcerptReady: false, analysisExcerptTruncated: false,
        sourceSentAt: null, createdAt: now,
      }])
      .mockResolvedValueOnce([{ id: "resource", kind: "NOTE", body: "Preserved legacy knowledge", caption: null, ocrText: null }]);
    db.studyCanvasMaterial.findMany
      .mockResolvedValueOnce([{
        id: "material", kind: "PAGE", title: "Legacy page", position: 1, contentType: "text/html", byteSize: 100,
        analysisExcerpt: null, analysisExcerptReady: false, unlockAt: null, sourceUpdatedAt: null, updatedAt: now,
        courseModule: null,
      }])
      .mockResolvedValueOnce([{ id: "material", extractedText: "Preserved Canvas knowledge" }]);

    const snapshot = await collectStudyEvidence(
      { id: "workspace", timezone: "Asia/Singapore" } as StudyWorkspace,
      "module",
      StudyAnalysisMode.CONNECTIONS,
    );

    expect(snapshot.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "RESOURCE", detail: expect.stringContaining("Preserved legacy knowledge") }),
      expect.objectContaining({ kind: "CANVAS_MATERIAL", detail: expect.stringContaining("Preserved Canvas knowledge") }),
    ]));
    expect(db.studyResource.findMany.mock.calls[1]![0].where).toEqual({ workspaceId: "workspace", id: { in: ["resource"] } });
    expect(db.studyCanvasMaterial.findMany.mock.calls[1]![0].where).toEqual({ workspaceId: "workspace", id: { in: ["material"] } });
  });
});
