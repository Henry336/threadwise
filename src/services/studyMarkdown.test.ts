import { describe, expect, it } from "vitest";
import { markdownForTelegram, normalizeStudyWikiTarget, parseStudyWikiLinks } from "./studyMarkdown";

describe("Study Markdown", () => {
  it("parses and deduplicates wiki links while preserving aliases", () => {
    expect(parseStudyWikiLinks("See [[Two's Complement]] and [[ two's   complement |signed integers]]."))
      .toEqual([{ target: "Two's Complement", label: "Two's Complement" }]);
    expect(parseStudyWikiLinks("[[CS2100|Computer organisation]]")).toEqual([
      { target: "CS2100", label: "Computer organisation" },
    ]);
    expect(normalizeStudyWikiTarget("  Two's   Complement ")).toBe("two's complement");
    expect(parseStudyWikiLinks("`[[not a link]]`\n```md\n[[also not a link]]\n```\n[[Real note]]"))
      .toEqual([{ target: "Real note", label: "Real note" }]);
  });

  it("turns rich Markdown into a readable Telegram fallback", () => {
    const text = markdownForTelegram([
      "# Pipeline notes",
      "- [x] Read chapter",
      "- [ ] Attempt quiz",
      "Connect to [[Cache|cache behaviour]].",
      "```mermaid",
      "graph LR",
      "A --> B",
      "```",
      "**Important** and `precise`.",
    ].join("\n"));
    expect(text).toContain("Pipeline notes");
    expect(text).toContain("☑ Read chapter");
    expect(text).toContain("☐ Attempt quiz");
    expect(text).toContain("Connect to cache behaviour.");
    expect(text).toContain("[Mermaid diagram — open this note in Threadwise to view it]");
    expect(text).toContain("Important and precise.");
    expect(text).not.toContain("graph LR");
  });
});
