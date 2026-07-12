import { describe, expect, it } from "vitest";
import { normalizeOcrLanguages, ocrLanguagesForCaption } from "./ocrLanguages";

describe("OCR language preferences", () => {
  it.each([
    ["English", "eng"],
    ["Burmese", "mya"],
    ["Myanmar", "mya"],
    ["English and Burmese", "eng+mya"],
    ["auto", "eng+mya"]
  ])("normalizes %s", (input, expected) => {
    expect(normalizeOcrLanguages(input)).toBe(expected);
  });

  it("allows an image caption to override the saved preference", () => {
    expect(ocrLanguagesForCaption("read this receipt in Burmese", "eng")).toBe("mya");
    expect(ocrLanguagesForCaption("extract in English and Burmese", "eng")).toBe("eng+mya");
    expect(ocrLanguagesForCaption("save as an expense", "eng+mya")).toBe("eng+mya");
  });
});
