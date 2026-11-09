import type { Context } from "grammy";
import { describe, expect, it, vi } from "vitest";
import type { AiProvider } from "../ai/types";

vi.mock("../db/prisma", () => ({ prisma: {} }));

import { handleNaturalCommand } from "./naturalCommands";
import type { ThreadwiseUser } from "../services/users";

const user = { id: "user-1", telegramId: "42", settings: { timezone: "Asia/Singapore" } } as ThreadwiseUser;

describe("natural commands with the frozen Expenses surface", () => {
  it.each(["paid the electricity bill", "spent 2 hours on the essay"])(
    "leaves ordinary prose for normal capture instead of opening an expense prompt: %s",
    async (text) => {
      const reply = vi.fn();
      const ctx = { chat: { id: 42, type: "private" }, from: { id: 42 }, reply } as unknown as Context;

      await expect(handleNaturalCommand(ctx, {} as AiProvider, user, text)).resolves.toBe(false);
      expect(reply).not.toHaveBeenCalled();
    }
  );
});
