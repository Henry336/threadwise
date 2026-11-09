import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { HeuristicAiProvider } from "../ai/heuristicProvider";
import { previewDashboardCapture } from "./capture";

function database() {
  return {
    user: {
      findUnique: vi.fn(async () => ({
        settings: { timezone: "Asia/Singapore" }
      }))
    }
  } as unknown as PrismaClient;
}

describe("dashboard intelligent capture", () => {
  it("uses the bot's dotted-clock parser instead of losing the minutes and meridiem", async () => {
    const preview = await previewDashboardCapture(
      "123456789",
      { text: "Remind me to go to the bank later at 1.30pm", preferredKind: "auto" },
      new HeuristicAiProvider(),
      database(),
      new Date("2026-07-17T03:45:00.000Z")
    );

    expect(preview.kind).toBe("task");
    expect(preview.confidence).toBeGreaterThan(0.9);
    expect(preview.payload.dueAt).toBe("2026-07-17T05:30:00.000Z");
    expect(preview.payload.title).toMatch(/bank/i);
  });

  it("lets an explicit capture type override classification while preserving a reviewable payload", async () => {
    const preview = await previewDashboardCapture(
      "123456789",
      { text: "A calmer weekly review could surface unfinished commitments", preferredKind: "idea" },
      new HeuristicAiProvider(),
      database()
    );

    expect(preview).toMatchObject({
      kind: "idea",
      confidence: 1,
      reason: "You chose idea."
    });
    expect(preview.payload).toMatchObject({
      concept: "A calmer weekly review could surface unfinished commitments"
    });
  });

  it("does not turn spending language into a frozen expense preview", async () => {
    for (const text of ["Paid the electricity bill", "Spent $18.40 on lunch at Toast Box today"]) {
      const preview = await previewDashboardCapture(
        "123456789",
        { text, preferredKind: "auto" },
        new HeuristicAiProvider(),
        database(),
        new Date("2026-07-17T04:00:00.000Z")
      );

      expect(["task", "note", "idea"]).toContain(preview.kind);
    }
  });
});
