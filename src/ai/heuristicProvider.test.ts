import { describe, expect, it } from "vitest";
import { HeuristicAiProvider } from "./heuristicProvider";

describe("HeuristicAiProvider", () => {
  it("does not generate retired tags for new notes", async () => {
    const provider = new HeuristicAiProvider();
    const note = await provider.structureNote("Selling yourself - mentioned by both Matthias and Ma Brenda");

    expect(note.tags).toEqual([]);
  });

  it("creates a connected fallback note merge instead of pasting note ids", async () => {
    const provider = new HeuristicAiProvider();
    const preview = await provider.mergeNotes([
      note("NOTE-3", "Learn these while working with Matthias -> join the calls for closed deals"),
      note(
        "NOTE-2",
        "Product Manager role - much similar to sth I want to do + the actual software design itself -> not-so-technical -> talking to clients, figuring out their needs -> thinking of how to design the whole thing to match their needs technical -> comparing/writing documentations -> thinking of fixing/setting up API endpoints"
      ),
      note("NOTE-1", "Selling yourself - mentioned by both Matthias and Ma Brenda")
    ]);

    expect(preview.title).not.toContain("NOTE-");
    expect(preview.body).toContain("Key points:");
    expect(preview.possibleMissingContext.join(" ")).toContain("Matthias");
    expect(preview.tags).toEqual([]);
  });

  it("connects any notes through the words they share, not a fixed topic list", async () => {
    const provider = new HeuristicAiProvider();
    const preview = await provider.mergeNotes([
      note("NOTE-1", "Water the tomato seedlings every morning"),
      note("NOTE-2", "Move the tomato seedlings outside once nights warm up"),
    ]);

    expect(preview.body).toContain("tomato");
    expect(preview.connections[0]).toBe('NOTE-1 and NOTE-2 both mention "tomato".');
    expect(preview.possibleMissingContext).toEqual([]);
  });

  it("does not mistake weekdays or product names for people", async () => {
    const provider = new HeuristicAiProvider();
    const preview = await provider.mergeNotes([
      note("NOTE-1", "Submit the Canvas quiz on Monday before the Telegram reminder"),
      note("NOTE-2", "Ask on Telegram whether the Canvas quiz moved to Tuesday"),
    ]);

    expect(preview.possibleMissingContext).toEqual([]);
  });

  it.each([
    ["Due by Friday with Google Calendar", "Pulled from Canvas, he said"],
    ["He said submit it", "It says page 3"],
    ["Notes mentioned by Ana", "Canvas due later"],
  ])("asks only about real attributed people: %s / %s", async (first, second) => {
    const preview = await new HeuristicAiProvider().mergeNotes([note("NOTE-1", first), note("NOTE-2", second)]);
    const question = preview.possibleMissingContext.join(" ");

    for (const notAPerson of ["Friday", "Google", "Canvas", "He", "It"]) expect(question).not.toContain(`did ${notAPerson}`);
    if (first.includes("Ana")) expect(question).toBe("What exactly did Ana say or do that is worth keeping?");
  });

  it("names both people in \"Ana said\" and \"Yesterday Ben said\" without the time word", async () => {
    const preview = await new HeuristicAiProvider().mergeNotes([note("NOTE-1", "Ana said start early"), note("NOTE-2", "Yesterday Ben said wait")]);

    expect(preview.possibleMissingContext).toEqual(["What exactly did Ana or Ben say or do that is worth keeping?"]);
  });
});

function note(publicId: string, text: string) {
  return {
    publicId,
    title: text,
    body: text,
    summary: text,
    sourceText: text,
    tags: [],
    createdAt: "2026-07-07T00:00:00.000Z"
  };
}
