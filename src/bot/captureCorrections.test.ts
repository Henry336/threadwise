import { describe, expect, it } from "vitest";
import { parseCaptureCorrection } from "./captureCorrections";

describe("capture correction language", () => {
  it.each([
    ["Save that as a note instead", { kind: "note" }],
    ["That was an idea, not a task.", { kind: "idea" }],
    ["Make this a reminder for tomorrow at 5pm", { kind: "reminder", reminderTimeText: "tomorrow at 5pm" }],
    ["Change that into a task", { kind: "task" }],
  ])("parses an explicit correction: %s", (text, expected) => {
    expect(parseCaptureCorrection(text)).toEqual(expected);
  });

  it.each([
    "Take a note about this chapter",
    "This task is difficult",
    "I have an idea for that problem",
    "Remind me tomorrow at 5pm",
    "Save as a note",
  ])("does not hijack ordinary language: %s", (text) => {
    expect(parseCaptureCorrection(text)).toBeUndefined();
  });
});
