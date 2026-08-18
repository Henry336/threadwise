import { describe, expect, it, vi } from "vitest";
import { StudyResourceKind } from "@prisma/client";
import { rebuildStudyNoteLinks, recordStudyNoteRevision } from "./studyMarkdown";

function database() {
  return {
    studyResource: { findFirst: vi.fn(), findMany: vi.fn() },
    studyResourceRevision: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
    studyNoteLink: { deleteMany: vi.fn(), createMany: vi.fn() },
  };
}

describe("Study Markdown persistence budgets", () => {
  it("resolves only lookup keys present in the changed note", async () => {
    const db = database();
    db.studyResource.findFirst.mockResolvedValue({ id: "source", body: "Connect [[Cache Coherence]] and [[NOTE-2|the prior note]]." });
    db.studyResource.findMany.mockResolvedValue([
      { id: "target", title: "Cache Coherence", publicId: "NOTE-2" },
    ]);
    await rebuildStudyNoteLinks("workspace", "source", db as never);
    expect(db.studyResource.findMany).toHaveBeenCalledWith({
      where: {
        workspaceId: "workspace",
        kind: StudyResourceKind.NOTE,
        archivedAt: null,
        wikiLookupKeys: { hasSome: ["cache coherence", "note-2"] },
      },
      select: { id: true, title: true, publicId: true },
    });
    expect(db.studyNoteLink.createMany).toHaveBeenCalledWith({
      data: [{ workspaceId: "workspace", sourceResourceId: "source", targetResourceId: "target" }],
      skipDuplicates: true,
    });
  });

  it("skips duplicate snapshots and bounds retained revision rows", async () => {
    const resource = { id: "note", workspaceId: "workspace", kind: StudyResourceKind.NOTE, title: "Title", body: "Body", tags: ["tag"] };
    const duplicateDb = database();
    duplicateDb.studyResourceRevision.findFirst.mockResolvedValue({ title: "Title", body: "Body", tags: ["tag"] });
    await recordStudyNoteRevision(resource, "DASHBOARD", duplicateDb as never);
    expect(duplicateDb.studyResourceRevision.create).not.toHaveBeenCalled();

    const db = database();
    db.studyResourceRevision.findFirst.mockResolvedValue(null);
    db.studyResourceRevision.findMany.mockResolvedValue([{ id: "stale" }]);
    await recordStudyNoteRevision(resource, "DASHBOARD", db as never);
    expect(db.studyResourceRevision.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20 }));
    expect(db.studyResourceRevision.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["stale"] } } });
  });
});
