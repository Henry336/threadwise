import { describe, expect, it } from "vitest";
import type { StudyWorkspace } from "@prisma/client";
import { expandNusmodsWeeks, isReplaceableNusmodsCandidate, parseNusmodsShareUrl } from "./studyNusmods";

describe("parseNusmodsShareUrl", () => {
  it("parses selected classes and preserves modules without class selections", () => {
    const result = parseNusmodsShareUrl("https://nusmods.com/timetable/sem-1/share?CFG1004=&CS2100=TUT:40,LAB:40,LEC:2&IT2900=TUT:1,LEC:1");

    expect(result).toEqual({
      semester: 1,
      modules: [
        { code: "CFG1004", selections: [] },
        { code: "CS2100", selections: [{ lessonCode: "TUT", classNo: "40" }, { lessonCode: "LAB", classNo: "40" }, { lessonCode: "LEC", classNo: "2" }] },
        { code: "IT2900", selections: [{ lessonCode: "TUT", classNo: "1" }, { lessonCode: "LEC", classNo: "1" }] },
      ],
    });
  });

  it("rejects non-NUSMods and unsupported semester links", () => {
    expect(() => parseNusmodsShareUrl("https://example.com/timetable/sem-1/share?CS2100=LEC:2")).toThrow(/nusmods\.com/i);
    expect(() => parseNusmodsShareUrl("https://nusmods.com/timetable/sem-3/share?CS2100=LEC:2")).toThrow(/Semester 1 or Semester 2/i);
  });
});

describe("expandNusmodsWeeks", () => {
  const workspace = {
    semesterStartDate: new Date("2026-08-10T00:00:00.000Z"),
    timezone: "Asia/Singapore",
  } as StudyWorkspace;

  it("accepts both numeric weeks and the official date-range representation", () => {
    expect(expandNusmodsWeeks([3, 1, 3, 2], workspace)).toEqual([1, 2, 3]);
    expect(expandNusmodsWeeks({ start: "2026-08-10", end: "2026-08-30" }, workspace)).toEqual([1, 2, 3]);
  });
});

describe("isReplaceableNusmodsCandidate", () => {
  it("adopts old seeded and class-like manual blocks instead of layering duplicates", () => {
    expect(isReplaceableNusmodsCandidate({ source: "SYSTEM_SEED", blockType: "timetable" })).toBe(true);
    expect(isReplaceableNusmodsCandidate({ source: "MANUAL", blockType: "Class" })).toBe(true);
    expect(isReplaceableNusmodsCandidate({ source: "MANUAL", blockType: "tutorial" })).toBe(true);
  });

  it("does not replace deliberate study or protected blocks", () => {
    expect(isReplaceableNusmodsCandidate({ source: "MANUAL", blockType: "study" })).toBe(false);
    expect(isReplaceableNusmodsCandidate({ source: "SYSTEM_SEED", blockType: "protected" })).toBe(false);
    expect(isReplaceableNusmodsCandidate({ source: "NUSMODS", blockType: "Lecture" })).toBe(false);
  });
});
