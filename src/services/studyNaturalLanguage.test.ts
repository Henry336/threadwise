import { StudyResourceKind } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { parseReplyCaptureInstruction } from "../bot/studyCapture";
import { parseStudyNaturalLanguage } from "./studyNaturalLanguage";

const timezone = "Asia/Singapore";

describe("Study Mode natural-language routing", () => {
  it("extracts an embedded module and deadline from a TODO", () => {
    const intent = parseStudyNaturalLanguage("todo: finish tutorial for CS2100 Friday 6pm", timezone);

    expect(intent).toMatchObject({
      kind: "create_task",
      moduleReference: "CS2100",
      title: "Finish tutorial",
    });
    expect(intent?.kind === "create_task" ? intent.dueAt : undefined).toBeInstanceOf(Date);
  });

  it("supports module-first notes and questions", () => {
    expect(parseStudyNaturalLanguage("CS2100 note: cache misses stall the pipeline", timezone)).toMatchObject({
      kind: "create_resource",
      resourceKind: StudyResourceKind.NOTE,
      moduleReference: "CS2100",
      body: "cache misses stall the pipeline",
    });
    expect(parseStudyNaturalLanguage("question: why is sign extension needed? for CS2100", timezone)).toMatchObject({
      kind: "create_resource",
      resourceKind: StudyResourceKind.QUESTION,
      moduleReference: "CS2100",
    });
  });

  it("does not mistake an ordinary sentence beginning with use for a travel origin", () => {
    expect(parseStudyNaturalLanguage("use spaced repetition for this chapter", timezone)).toMatchObject({
      kind: "ambiguous",
    });
    expect(parseStudyNaturalLanguage("use origin Home for 3 hours", timezone)).toEqual({
      kind: "origin_activate",
      reference: "Home",
      hours: 3,
    });
  });

  it("recognises deterministic planning, Canvas, and travel requests", () => {
    expect(parseStudyNaturalLanguage("dashboard", timezone)).toEqual({ kind: "study_dashboard" });
    expect(parseStudyNaturalLanguage("open study dashboard", timezone)).toEqual({ kind: "study_dashboard" });
    expect(parseStudyNaturalLanguage("show my timetable", timezone)).toEqual({ kind: "timetable" });
    expect(parseStudyNaturalLanguage("what classes do I have this week?", timezone)).toEqual({ kind: "timetable" });
    expect(parseStudyNaturalLanguage("what should I work on now?", timezone)).toEqual({ kind: "attention" });
    expect(parseStudyNaturalLanguage("plan my week", timezone)).toEqual({ kind: "weekly_plan" });
    expect(parseStudyNaturalLanguage("review my week", timezone)).toEqual({ kind: "weekly_review" });
    expect(parseStudyNaturalLanguage("record a study mistake", timezone)).toEqual({ kind: "record_mistake" });
    expect(parseStudyNaturalLanguage("sync my Canvas assignments", timezone)).toEqual({ kind: "canvas_sync" });
    expect(parseStudyNaturalLanguage("when should I leave to COM3 from Home?", timezone)).toEqual({
      kind: "route",
      destination: "COM3",
      origin: "Home",
    });
    expect(parseStudyNaturalLanguage("How do I add a travel origin?", timezone)).toEqual({ kind: "origin_help" });
  });
});

describe("Study Mode reply capture language", () => {
  it("extracts the destination module and optional capture type", () => {
    expect(parseReplyCaptureInstruction("save this to CS2100")).toEqual({ moduleReference: "CS2100" });
    expect(parseReplyCaptureInstruction("keep this as a question under cs 2102")).toEqual({
      moduleReference: "CS2102",
      action: "question",
    });
  });

  it("does not intercept unrelated save requests", () => {
    expect(parseReplyCaptureInstruction("save a note about CS2100")).toBeUndefined();
  });
});
