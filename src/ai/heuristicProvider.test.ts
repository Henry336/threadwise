import { describe, expect, it } from "vitest";
import { HeuristicAiProvider } from "./heuristicProvider";

describe("HeuristicAiProvider", () => {
  it("does not tag the word both as bot", async () => {
    const provider = new HeuristicAiProvider();
    const note = await provider.structureNote("Selling yourself - mentioned by both Matthias and Ma Brenda");

    expect(note.tags).not.toContain("bot");
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

    expect(preview.title).toBe("Client-Facing Product And Sales Lessons");
    expect(preview.title).not.toContain("NOTE-");
    expect(preview.body).toContain("client-facing product path");
    expect(preview.connections.join(" ")).toContain("client discovery");
    expect(preview.tags).toContain("product");
    expect(preview.tags).toContain("sales");
    expect(preview.tags).not.toContain("bot");
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
