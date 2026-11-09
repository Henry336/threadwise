import type { Context } from "grammy";
import { describe, expect, it, vi } from "vitest";
import type { AiProvider } from "../ai/types";

vi.mock("../db/prisma", () => ({ prisma: {} }));

import { firstNaturalRuleName, handleNaturalCommand } from "./naturalCommands";
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

// Rule order is behaviour: each pair below is a near miss where an earlier or later rule
// would take the text if the order changed. Quirks marked "kept" document current routing.
describe("natural command rule order", () => {
  const chat = (type: "private" | "group") => ({ chat: { id: 1, type }, from: { id: 1 }, me: { username: "bot" } }) as unknown as Context;

  it.each([
    ["cancel 4,5", "bulk action"],
    ["cancel 4", "cancel"],
    ["complete 1,2", "bulk action"],
    ["complete 3", "complete"],
    ["unassign 3", "unassign everyone"],
    ["remove @alex from 3", "unassign one person"],
    ["remove 3", "cancel"],
    ["delete image 3", "delete image"],
    ["delete note 3", "archive note"],
    ["delete 3", "cancel"],
    ["remind me about 3 in 2 hours", "snooze"],
    ["remind me to call mum at 9pm", "reminder capture"],
    ["remind me again every 3 hours", "natural setting change"],
    ["task 3", "task detail"],
    ["task buy milk", "task capture"],
    ["review", "review"],
    ["review idea 3", "score idea"],
    ["mark 3 as not important", "remove important"],
    ["mark 3 as important", "mark important or pin"],
    ["images", "image list"],
    ["search images cats", "search"],
    ["notes", "list tasks, notes or ideas"],
    ["notes deployment", "search notes"],
    ["calendar", "calendar status"],
    ["delete 3 from calendar", "remove task from calendar"],
    ["remove 3 from calendar", "unassign one person"], // kept quirk
    ["rename 3 to Buy oat milk", "image caption"], // kept quirk
    ["claim 3", undefined],
    ["paid the electricity bill", undefined],
  ])("private: %s -> %s", (text, expected) => {
    expect(firstNaturalRuleName(chat("private"), text)).toBe(expected);
  });

  it.each([
    ["calendar", "group calendar refusal"],
    ["delete 3 from calendar", "group calendar refusal"],
    ["remind me to check the calendar at 9pm", "reminder capture"],
    ["claim 3", "claim (group)"],
    ["my tasks", "group: my tasks"],
  ])("group: %s -> %s", (text, expected) => {
    expect(firstNaturalRuleName(chat("group"), text)).toBe(expected);
  });
});
