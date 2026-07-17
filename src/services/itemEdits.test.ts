import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  pending: undefined as undefined | {
    id: string;
    itemKind: string;
    itemPublicId: string;
    editField: string;
  }
}));

const mocks = vi.hoisted(() => ({
  renameTaskTitle: vi.fn(),
  updateTaskDescription: vi.fn(),
  renameNoteTitle: vi.fn(),
  updateNoteBody: vi.fn(),
  renameIdeaTitle: vi.fn(),
  updateIdeaConcept: vi.fn(),
  updateStoredImageCaption: vi.fn()
}));

vi.mock("../db/prisma", () => ({
  prisma: {
    pendingItemEdit: {
      deleteMany: vi.fn(async () => {
        const count = state.pending ? 1 : 0;
        state.pending = undefined;
        return { count };
      }),
      findFirst: vi.fn(async () => state.pending),
      delete: vi.fn(async () => {
        const pending = state.pending;
        state.pending = undefined;
        return pending;
      })
    }
  }
}));

vi.mock("./tasks", () => ({
  renameTaskTitle: mocks.renameTaskTitle,
  updateTaskDescription: mocks.updateTaskDescription
}));
vi.mock("./notes", () => ({
  renameNoteTitle: mocks.renameNoteTitle,
  updateNoteBody: mocks.updateNoteBody
}));
vi.mock("./ideas", () => ({
  renameIdeaTitle: mocks.renameIdeaTitle,
  updateIdeaConcept: mocks.updateIdeaConcept
}));
vi.mock("./storedImages", () => ({ updateStoredImageCaption: mocks.updateStoredImageCaption }));

describe("pending item edit cancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.pending = {
      id: "pending-1",
      itemKind: "task",
      itemPublicId: "TASK-1",
      editField: "title"
    };
  });

  it("prevents the next ordinary message from mutating an abandoned edit", async () => {
    const { applyPendingItemEdit, cancelPendingItemEdit } = await import("./itemEdits");

    expect(await cancelPendingItemEdit("user-1")).toBe(true);
    expect(await applyPendingItemEdit("user-1", "show my notes")).toBeUndefined();
    expect(mocks.renameTaskTitle).not.toHaveBeenCalled();
    expect(mocks.updateTaskDescription).not.toHaveBeenCalled();
  });
});
