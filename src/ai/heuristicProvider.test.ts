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
    expect(preview.connections[0]).toBe('NOTE-1 and NOTE-2 all mention "tomato".');
    expect(preview.possibleMissingContext).toEqual([]);
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
