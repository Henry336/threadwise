import { describe, expect, it, vi } from "vitest";
import { resolveGroupTaskCallbackOwner } from "./groupTaskCompatibility";

function database(task: unknown) {
  return { task: { findUnique: vi.fn().mockResolvedValue(task) } } as never;
}

describe("legacy group task callbacks", () => {
  it("uses the historical task owner only when it still delivers to this exact chat", async () => {
    const owner = await resolveGroupTaskCallbackOwner("current-user", "task-uuid", "-100456", database({
      userId: "historical-user",
      archivedAt: null,
      user: { telegramId: "chat:-123", settings: { reminderChatId: "-100456" } },
    }));

    expect(owner).toBe("historical-user");
  });

  it("does not expose a task owned by a different chat", async () => {
    const owner = await resolveGroupTaskCallbackOwner("current-user", "task-uuid", "-100456", database({
      userId: "foreign-user",
      archivedAt: null,
      user: { telegramId: "chat:-999", settings: { reminderChatId: "-100999" } },
    }));

    expect(owner).toBe("current-user");
  });

  it("does not revive archived historical tasks", async () => {
    const owner = await resolveGroupTaskCallbackOwner("current-user", "task-uuid", "-100456", database({
      userId: "historical-user",
      archivedAt: new Date(),
      user: { telegramId: "chat:-123", settings: { reminderChatId: "-100456" } },
    }));

    expect(owner).toBe("current-user");
  });
});
