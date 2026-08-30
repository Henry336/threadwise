import { beforeEach, describe, expect, it, vi } from "vitest";
import { StudyResourceKind, type StudyWorkspace } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  prisma: {
    studyNoteDraft: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
  findStudyModule: vi.fn(),
  findStudyResource: vi.fn(),
}));

vi.mock("../db/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("../services/study", async (importOriginal) => ({
  ...await importOriginal<typeof import("../services/study")>(),
  findStudyModule: mocks.findStudyModule,
}));
vi.mock("../services/studyResources", async (importOriginal) => ({
  ...await importOriginal<typeof import("../services/studyResources")>(),
  findStudyResource: mocks.findStudyResource,
}));

import { deleteDashboardStudyNoteDraft, getDashboardStudyNoteDraft, saveDashboardStudyNoteDraft } from "./study";

const workspace = { id: "workspace", ownerUserId: "owner" } as StudyWorkspace;
const baseDraft = {
  id: "draft", workspaceId: workspace.id, ownerUserId: workspace.ownerUserId, draftKey: "new",
  resourceId: null, resourceUpdatedAt: null, moduleId: "module", title: "Draft", body: "Body", revision: 1,
  expiresAt: new Date("2026-09-07T00:00:00Z"), createdAt: new Date(), updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.studyNoteDraft.deleteMany.mockResolvedValue({ count: 0 });
  mocks.findStudyModule.mockResolvedValue({ id: "module", workspaceId: workspace.id });
  mocks.findStudyResource.mockResolvedValue({ id: "resource", workspaceId: workspace.id, kind: StudyResourceKind.NOTE, updatedAt: new Date("2026-08-31T00:00:00.000Z") });
});

describe("cross-device Study note drafts", () => {
  it("loads only the owner's unexpired draft in the active workspace", async () => {
    mocks.prisma.studyNoteDraft.findFirst.mockResolvedValue(baseDraft);
    await expect(getDashboardStudyNoteDraft(workspace, {})).resolves.toEqual(baseDraft);
    expect(mocks.prisma.studyNoteDraft.deleteMany).toHaveBeenCalledWith({ where: {
      workspaceId: workspace.id, ownerUserId: workspace.ownerUserId, expiresAt: { lte: expect.any(Date) },
    } });
    expect(mocks.prisma.studyNoteDraft.findFirst).toHaveBeenCalledWith({ where: {
      workspaceId: workspace.id, ownerUserId: workspace.ownerUserId, draftKey: "new", expiresAt: { gt: expect.any(Date) },
    } });
  });

  it("creates revision zero once and increments only the expected revision", async () => {
    mocks.prisma.studyNoteDraft.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(baseDraft);
    mocks.prisma.studyNoteDraft.create.mockResolvedValue(baseDraft);
    mocks.prisma.studyNoteDraft.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.studyNoteDraft.findUniqueOrThrow.mockResolvedValue({ ...baseDraft, revision: 2, body: "After" });

    await expect(saveDashboardStudyNoteDraft(workspace, { moduleId: "module", title: "Draft", body: "Body", expectedRevision: 0 }))
      .resolves.toEqual(baseDraft);
    await expect(saveDashboardStudyNoteDraft(workspace, { moduleId: "module", title: "Draft", body: "After", expectedRevision: 1 }))
      .resolves.toMatchObject({ revision: 2, body: "After" });
    expect(mocks.prisma.studyNoteDraft.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerUserId: workspace.ownerUserId, revision: 1 }),
      data: expect.objectContaining({ revision: { increment: 1 } }),
    }));
  });

  it("rejects stale writes, non-note resources, and cross-workspace deletion", async () => {
    mocks.prisma.studyNoteDraft.findUnique.mockResolvedValue(baseDraft);
    mocks.prisma.studyNoteDraft.updateMany.mockResolvedValue({ count: 0 });
    await expect(saveDashboardStudyNoteDraft(workspace, { title: "Draft", body: "Stale", expectedRevision: 1 }))
      .rejects.toMatchObject({ code: "conflict" });

    mocks.findStudyResource.mockResolvedValue({ id: "resource", workspaceId: workspace.id, kind: StudyResourceKind.LINK, updatedAt: new Date("2026-08-31T00:00:00.000Z") });
    await expect(saveDashboardStudyNoteDraft(workspace, { resourceId: "resource", resourceUpdatedAt: "2026-08-31T00:00:00.000Z", title: "No", body: "No", expectedRevision: 0 }))
      .rejects.toMatchObject({ code: "invalid" });

    mocks.findStudyResource.mockResolvedValue({ id: "resource", workspaceId: workspace.id, kind: StudyResourceKind.NOTE, updatedAt: new Date("2026-08-31T00:00:00.000Z") });
    await expect(saveDashboardStudyNoteDraft(workspace, { resourceId: "resource", resourceUpdatedAt: "2026-08-30T00:00:00.000Z", title: "Old", body: "Old", expectedRevision: 0 }))
      .rejects.toMatchObject({ code: "conflict" });

    mocks.prisma.studyNoteDraft.deleteMany.mockResolvedValue({ count: 0 });
    await expect(deleteDashboardStudyNoteDraft(workspace, "someone-elses-draft")).rejects.toMatchObject({ code: "not_found" });
  });
});
