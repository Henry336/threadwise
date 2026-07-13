import { describe, expect, it } from "vitest";
import { captionForStoredImage, normalizeExtractedText, parseImageCaptionIntent } from "./imageOcr";

describe("local image OCR helpers", () => {
  it("cleans noisy OCR whitespace while preserving lines", () => {
    expect(normalizeExtractedText("  SHOP  NAME \r\n\n TOTAL   12.50  \n")).toBe("SHOP NAME\nTOTAL 12.50");
  });

  it.each([
    ["log this receipt as an expense", "expense"],
    ["remind me about this tomorrow", "reminder"],
    ["turn this into a task", "task"],
    ["save this as a note", "note"],
    ["extract the text", "extract"],
    ["store this image", "store"],
    ["save this as Mum's passport scan", "store"],
    ["keep this photo with caption July electricity bill", "store"],
    ["save this image and extract the text", "store-extract"],
    ["", "choose"]
  ])("routes image captions: %s", (caption, expected) => {
    expect(parseImageCaptionIntent(caption)).toBe(expected);
  });

  it.each([
    ["save this as Mum's passport scan", "Mum's passport scan"],
    ["keep this image with caption July electricity bill", "July electricity bill"],
    ["caption this photo as bus route map", "bus route map"]
  ])("extracts a user-facing image caption from: %s", (input, expected) => {
    expect(captionForStoredImage(input)).toBe(expected);
  });

  it("keeps extraction wording out of a save-and-extract caption", () => {
    expect(captionForStoredImage("save this image as July electricity bill and extract the text")).toBe("July electricity bill");
  });
});
