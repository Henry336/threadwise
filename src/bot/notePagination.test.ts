import { describe, expect, it } from "vitest";
import { boundedNotePage, paginateNoteBody } from "./notePagination";

describe("note pagination", () => {
  it("keeps short notes on one page", () => {
    expect(paginateNoteBody("First paragraph.\n\nSecond paragraph.")).toEqual([
      "First paragraph.\n\nSecond paragraph."
    ]);
  });

  it("prefers paragraph boundaries and respects escaped HTML length", () => {
    const pages = paginateNoteBody(`${"&".repeat(20)}\n\n${"<".repeat(20)}`, 100);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toBe("&".repeat(20));
    expect(pages[1]).toBe("<".repeat(20));
  });

  it("does not split emoji surrogate pairs", () => {
    const pages = paginateNoteBody("🧵".repeat(20), 10);
    expect(pages.join("")).toBe("🧵".repeat(20));
    expect(pages.every((page) => !page.includes("\uFFFD"))).toBe(true);
  });

  it("bounds requested pages", () => {
    expect(boundedNotePage(0, 4)).toBe(1);
    expect(boundedNotePage(9, 4)).toBe(4);
  });
});
