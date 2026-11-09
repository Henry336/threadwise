import type { Context } from "grammy";
import { describe, expect, it, vi } from "vitest";
import type { AiProvider } from "../ai/types";

vi.mock("../db/prisma", () => ({ prisma: {} }));
vi.mock("../services/users", () => ({
  ensureUser: vi.fn(async () => ({ id: "user-1", telegramId: "42", settings: { timezone: "Asia/Singapore" } })),
}));

import { handleNaturalCommand } from "./naturalCommands";

describe("natural commands with the frozen Expenses surface", () => {
  it.each(["paid the electricity bill", "spent 2 hours on the essay"])(
    "leaves ordinary prose for normal capture instead of opening an expense prompt: %s",
    async (text) => {
      const reply = vi.fn();
      const ctx = { chat: { id: 42, type: "private" }, from: { id: 42 }, reply } as unknown as Context;

      await expect(handleNaturalCommand(ctx, {} as AiProvider, text)).resolves.toBe(false);
      expect(reply).not.toHaveBeenCalled();
    }
  );
});
