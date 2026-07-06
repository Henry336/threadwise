import { describe, expect, it } from "vitest";
import {
  classifyMessageDeterministically,
  shouldUseAiForNoteStructure,
  structureNoteDeterministically,
  structureTaskDeterministically
} from "./deterministic";

describe("deterministic AI helpers", () => {
  it("recognizes natural timed tasks without needing the model", () => {
    const classification = classifyMessageDeterministically("check the launderette in 60 mins", "Asia/Singapore");

    expect(classification?.kind).toBe("task");
    expect(classification?.confidence).toBeGreaterThanOrEqual(0.9);
    expect(classification?.reason).toContain("parseable reminder time");
    expect(classification?.dueDateText).toBe("check the launderette in 60 mins");
  });

  it("keeps reminder task titles clean and human-readable", () => {
    expect(structureTaskDeterministically("Remind me to check the launderette in 60 mins")).toMatchObject({
      title: "Check the launderette",
      description: "Remind me to check the launderette in 60 mins"
    });
  });

  it("removes dated scheduling words from task titles without losing the action", () => {
    expect(structureTaskDeterministically("add pay invoice tomorrow at 9am")).toMatchObject({
      title: "Pay invoice"
    });
  });

  it.each([
    ["remind me about the meeting in 2 hours", "Meeting"],
    ["remind me about the meeting after 2 hours", "Meeting"],
    ["remind me about the meeting in 2 hrs", "Meeting"],
    ["remind me about the meeting in 2 hr", "Meeting"],
    ["remind me about the meeting in 2 hour", "Meeting"],
    ["remind me to leave my house in 20 mins", "Leave my house"],
    ["remind me to leave my house in 20 min", "Leave my house"],
    ["remind me to leave my house in 20 minute", "Leave my house"],
    ["remind me to leave my house in 20 minutes", "Leave my house"],
    ["please remind me to prepare a gift at 3:20 pm", "Prepare a gift"],
    ["set a reminder for school at 9 am", "School"]
  ])("handles expected reminder phrasing: %s", (input, title) => {
    const classification = classifyMessageDeterministically(input, "Asia/Singapore");
    expect(classification?.kind).toBe("task");
    expect(classification?.confidence).toBeGreaterThanOrEqual(0.9);
    expect(structureTaskDeterministically(input).title).toBe(title);
  });

  it("handles parent-style shorthand without losing reminder intent", () => {
    const input = "remind me to do sth after 5 mins";
    const classification = classifyMessageDeterministically(input, "Asia/Singapore");
    expect(classification?.kind).toBe("task");
    expect(classification?.confidence).toBeGreaterThanOrEqual(0.9);
    expect(structureTaskDeterministically(input).title).toBe("Do something");
  });

  it.each([
    ["can you remind me to reply to Dom tomorrow at 8", "Reply to Dom"],
    ["create a reminder to submit the form next monday at 10am", "Submit the form"],
    ["todo buy batteries in 3 days", "Buy batteries"],
    ["add review passport documents on 12 july at 7pm", "Review passport documents"]
  ])("handles additional likely task text: %s", (input, title) => {
    expect(classifyMessageDeterministically(input, "Asia/Singapore")?.kind).toBe("task");
    expect(structureTaskDeterministically(input).title).toBe(title);
  });

  it("structures simple notes locally without sounding like a raw fallback", () => {
    expect(structureNoteDeterministically("note deployment reliability depends on avoiding sleeping workers")).toMatchObject({
      title: "Deployment Reliability Depends On Avoiding Sleeping Workers",
      body: "deployment reliability depends on avoiding sleeping workers",
      summary: "deployment reliability depends on avoiding sleeping workers"
    });
    expect(shouldUseAiForNoteStructure("note deployment reliability depends on avoiding sleeping workers")).toBe(false);
  });

  it("reserves AI note cleanup for long or explicitly synthetic notes", () => {
    expect(shouldUseAiForNoteStructure("please polish this note into a cleaner writeup")).toBe(true);
    expect(shouldUseAiForNoteStructure(
      "This first sentence contains enough detail to matter. This second sentence adds another separate point. This third sentence introduces a caveat worth preserving. This fourth sentence connects the thought to a project. This fifth sentence asks for a cleaner synthesis."
    )).toBe(true);
  });

  it("does not pretend ambiguous thoughts are classified", () => {
    expect(classifyMessageDeterministically("hmm maybe this is worth thinking about later", "Asia/Singapore")).toBeUndefined();
  });
});
