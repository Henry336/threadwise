import { describe, expect, it } from "vitest";
import { classifyMessageDeterministically } from "../ai/deterministic";
import { parseStudyNaturalLanguage } from "../services/studyNaturalLanguage";
import { splitTaskDraftText } from "../services/taskPlanning";
import { parseCaptureCorrection } from "./captureCorrections";
import { parseNaturalReminderBody, parseNaturalTaskBody } from "./naturalCommandParsing";

const timezone = "Asia/Singapore";

describe("Phase 3 capture-routing acceptance matrix", () => {
  it("keeps reminders, deadlines, notes, and ideas semantically distinct", () => {
    expect(parseNaturalReminderBody("remind me to submit the form tomorrow at 5pm")).toContain("submit the form");
    expect(parseNaturalTaskBody("create a task to submit the form by Friday")).toContain("submit the form");
    expect(classifyMessageDeterministically("Remember that CS2102 uses relational algebra", timezone)?.kind).toBe("note");
    expect(classifyMessageDeterministically("Build an app that helps commuters", timezone)?.kind).toBe("idea");
  });

  it.each([
    "The deployment failed because the token expired",
    "How should I prepare the slides?",
    "Buy milk",
  ])("does not manufacture certainty for ordinary or underspecified prose: %s", (text) => {
    expect(classifyMessageDeterministically(text, timezone)).toBeUndefined();
  });

  it("keeps Study task-like prose in review while explicit commands stay deterministic", () => {
    expect(parseStudyNaturalLanguage("prepare the project slides", timezone)).toMatchObject({ kind: "ambiguous" });
    expect(parseStudyNaturalLanguage("task: prepare the project slides for CS2100", timezone)).toMatchObject({
      kind: "create_task",
      moduleReference: "CS2100",
    });
  });

  it("uses explicit newline boundaries for batches and preserves commas inside one task", () => {
    expect(splitTaskDraftText("Do taxes, laundry, homework\nMeet mom, dad")).toEqual([
      "Do taxes, laundry, homework",
      "Meet mom, dad",
    ]);
  });

  it("recognizes correction phrases without turning nearby conversation into corrections", () => {
    expect(parseCaptureCorrection("That was an idea, not a task")).toEqual({ kind: "idea" });
    expect(parseCaptureCorrection("This task gave me an idea")).toBeUndefined();
  });
});
