import { describe, expect, it } from "vitest";
import { extractGeminiResponse } from "./geminiCli";

describe("extractGeminiResponse", () => {
  it("extracts the response field from Gemini CLI JSON", () => {
    expect(extractGeminiResponse(JSON.stringify({ response: "A sharper idea." })))
      .toBe("A sharper idea.");
  });

  it("extracts candidate part text when present", () => {
    const output = {
      candidates: [{
        content: {
          parts: [{ text: "First" }, { text: "Second" }]
        }
      }]
    };
    expect(extractGeminiResponse(JSON.stringify(output))).toBe("First\nSecond");
  });

  it("accepts plain text output from older CLI versions", () => {
    expect(extractGeminiResponse("\u001b[32mUseful answer\u001b[0m\n")).toBe("Useful answer");
  });

  it("rejects empty output", () => {
    expect(() => extractGeminiResponse(" \n ")).toThrow("returned no output");
  });
});
