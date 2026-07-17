import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listOpenTasks: vi.fn(),
  notes: vi.fn(),
  ideas: vi.fn()
}));

vi.mock("./tasks", () => ({ listOpenTasks: mocks.listOpenTasks }));
vi.mock("../db/prisma", () => ({
  prisma: {
    note: { findMany: mocks.notes },
    idea: { findMany: mocks.ideas }
  }
}));

describe("review formatting", () => {
  it("does not expose task, note, or idea IDs on the default review", async () => {
    mocks.listOpenTasks.mockResolvedValue([{
      id: "task-row-1",
      publicId: "TASK-9",
      title: "Book dentist",
      sourceText: "Book dentist",
      status: "OPEN",
      reminderCount: 0,
      dueAt: null
    }]);
    mocks.notes.mockResolvedValue([{
      publicId: "NOTE-8",
      title: "Clinic",
      summary: "Call after lunch"
    }]);
    mocks.ideas.mockResolvedValue([{
      publicId: "IDEA-7",
      title: "Health tracker",
      concept: "A calmer appointment timeline"
    }]);
    const { buildReview } = await import("./review");

    const message = await buildReview("user-1", "Asia/Singapore");

    expect(message).not.toMatch(/(?:TASK|NOTE|IDEA)-\d+/);
    expect(message).toContain("Book dentist");
    expect(message).toContain("Clinic");
    expect(message).toContain("Health tracker");
  });
});
