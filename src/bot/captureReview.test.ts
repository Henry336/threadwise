import { CaptureKind } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { Classification } from "../ai/types";
import { suggestedCaptureKind, suggestedPendingCaptureKind } from "./captureReview";

const timezone = "Asia/Singapore";
const now = new Date("2026-09-03T04:00:00.000Z");

describe("capture review suggestions", () => {
  it.each([
    [{ kind: "task", confidence: 0.9, reason: "action" }, "Finish the slides", "task"],
    [{ kind: "note", confidence: 0.9, reason: "information" }, "The room is COM3", "note"],
    [{ kind: "idea", confidence: 0.9, reason: "possibility" }, "What if reminders were calmer?", "idea"],
    [{ kind: "noise", confidence: 0.9, reason: "conversation" }, "How are you?", undefined],
  ] as Array<[Classification, string, string | undefined]>)
  ("suggests a reversible type for %s", (classification, text, expected) => {
    expect(suggestedCaptureKind(classification, text, timezone, now)).toBe(expected);
  });

  it("distinguishes a timed reminder from an ordinary task", () => {
    vi.setSystemTime(now);
    expect(suggestedCaptureKind({
      kind: "task",
      confidence: 0.9,
      reason: "timed action",
      dueDateText: "tomorrow at 9am",
    }, "Finish the slides tomorrow at 9am", timezone, now)).toBe("reminder");
    vi.useRealTimers();
  });

  it("reconstructs the suggestion when the user returns from the type picker", () => {
    expect(suggestedPendingCaptureKind({
      kind: CaptureKind.NOTE,
      sourceText: "A useful detail",
    }, timezone, now)).toBe("note");
  });
});
