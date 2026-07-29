import { describe, expect, it } from "vitest";
import { codexInputWithAttachments, safeCodexAttachmentName } from "./codexAttachments";

describe("Codex worker attachments", () => {
  it("prevents uploaded names from escaping the temporary attachment directory", () => {
    expect(safeCodexAttachmentName("..\\..\\design brief (final).pdf", 0)).toBe("1-design_brief_final_.pdf");
    expect(safeCodexAttachmentName("../../design brief (final).pdf", 1)).toBe("2-design_brief_final_.pdf");
  });

  it("passes images as native local_image inputs and gives Codex direct file paths", () => {
    expect(codexInputWithAttachments(
      "Review everything.",
      ["C:\\Temp\\screen.png"],
      ["C:\\Temp\\requirements.pdf"]
    )).toEqual([
      {
        type: "text",
        text: [
          "Review everything.",
          "",
          "The user attached the following local files. Inspect them directly as part of this task:",
          "- C:\\Temp\\requirements.pdf"
        ].join("\n")
      },
      { type: "local_image", path: "C:\\Temp\\screen.png" }
    ]);
  });
});
