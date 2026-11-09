import { describe, expect, it } from "vitest";
import { HeuristicAiProvider } from "./heuristicProvider";
import { CachedAiProvider } from "./cachedProvider";
import type { StructuredIdea } from "./types";

describe("CachedAiProvider", () => {
  it("reuses identical synthesis results without re-running the provider", async () => {
    const inner = new CountingProvider();
    const provider = new CachedAiProvider(inner);

    await expect(provider.structureIdea("build a reminder bot")).resolves.toMatchObject({
      title: "Build A Reminder Bot"
    });
    await expect(provider.structureIdea("build a reminder bot")).resolves.toMatchObject({
      title: "Build A Reminder Bot"
    });

    expect(inner.structureIdeaCalls).toBe(1);
  });
});

class CountingProvider extends HeuristicAiProvider {
  structureIdeaCalls = 0;

  override async structureIdea(text: string): Promise<StructuredIdea> {
    this.structureIdeaCalls += 1;
    return super.structureIdea(text);
  }
}
