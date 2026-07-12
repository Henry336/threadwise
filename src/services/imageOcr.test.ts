import { describe, expect, it } from "vitest";
import { normalizeExtractedText, parseImageCaptionIntent } from "./imageOcr";

describe("local image OCR helpers", () => {
  it("cleans noisy OCR whitespace while preserving lines", () => {
    expect(normalizeExtractedText("  SHOP  NAME \r\n\n TOTAL   12.50  \n")).toBe("SHOP NAME\nTOTAL 12.50");
  });

  it.each([
    ["log this receipt as an expense", "expense"],
    ["remind me about this tomorrow", "reminder"],
    ["turn this into a task", "task"],
    ["save this as a note", "note"],
    ["extract the text", "extract"]
  ])("routes image captions: %s", (caption, expected) => {
    expect(parseImageCaptionIntent(caption)).toBe(expected);
  });
});
