import { describe, expect, it } from "vitest";
import { normalizeOverviewQuotes, OVERVIEW_QUOTE_LIMIT } from "./overviewQuotes";
import { settingsUpdateSchema } from "./schemas";

describe("dashboard overview quotes", () => {
  it("normalizes safe stored quotes and ignores malformed or duplicate entries", () => {
    expect(normalizeOverviewQuotes([
      { text: "  Keep   going. ", author: "  Someone  " },
      { text: "keep going.", author: "someone" },
      { text: "A second line" },
      { text: "" },
      { author: "Missing text" },
      "not an object",
    ])).toEqual([
      { text: "Keep going.", author: "Someone" },
      { text: "A second line" },
    ]);
  });

  it("enforces the API limits and rejects duplicates after whitespace normalization", () => {
    expect(settingsUpdateSchema.parse({
      overviewQuotes: [{ text: "  Change   one thing. ", author: "  A Person " }],
    }).overviewQuotes).toEqual([{ text: "Change one thing.", author: "A Person" }]);

    expect(() => settingsUpdateSchema.parse({
      overviewQuotes: [{ text: "Same" }, { text: " same " }],
    })).toThrow("Remove the duplicate quote.");

    expect(() => settingsUpdateSchema.parse({
      overviewQuotes: Array.from({ length: OVERVIEW_QUOTE_LIMIT + 1 }, (_, index) => ({ text: `Quote ${index}` })),
    })).toThrow();
  });
});
