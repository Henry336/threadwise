import { describe, expect, it } from "vitest";
import { HeuristicAiProvider } from "./heuristicProvider";
import { ResilientAiProvider } from "./resilientProvider";

describe("ResilientAiProvider", () => {
  it("falls back to heuristic task structuring when the primary provider fails", async () => {
    const provider = new ResilientAiProvider(new FailingAiProvider(), new HeuristicAiProvider());

    await expect(provider.structureTask("remind me to go out in 15 mins")).resolves.toMatchObject({
      title: "remind me to go out in 15 mins",
      dueDateText: "remind me to go out in 15 mins"
    });
  });
});

class FailingAiProvider extends HeuristicAiProvider {
  override async structureTask(): Promise<never> {
    throw new Error("primary unavailable");
  }
}
