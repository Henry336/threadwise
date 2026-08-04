import { describe, expect, it } from "vitest";
import {
  isWindowsPathWithin,
  isWindowsVolumeRoot,
  quotedWindowsPaths,
  windowsSandboxDirectoryCandidates
} from "./codexAdditionalDirectories";

describe("Codex additional Windows directories", () => {
  it("does not pass volume roots directly to the Windows sandbox", () => {
    expect(windowsSandboxDirectoryCandidates(
      ["C:\\", "D:\\"],
      "Inspect package.json without touching other files."
    )).toEqual([]);
    expect(windowsSandboxDirectoryCandidates(
      ["C:\\", "D:\\"],
      'Inspect "C:\\" without modifying it.'
    )).toEqual([]);
  });

  it("turns a quoted path under an authorized drive into an exact sandbox directory", () => {
    expect(windowsSandboxDirectoryCandidates(
      ["C:\\", "D:\\"],
      'List "C:\\Users\\Henry\\OneDrive\\Desktop\\May Vacation Plans" without modifying it.'
    )).toEqual(["C:\\Users\\Henry\\OneDrive\\Desktop\\May Vacation Plans"]);
  });

  it("rejects prompt paths outside configured authorization roots", () => {
    expect(windowsSandboxDirectoryCandidates(
      ["D:\\Projects"],
      'Read "C:\\Users\\Henry\\secret.txt" and "D:\\Projects\\safe.txt".'
    )).toEqual(["D:\\Projects", "D:\\Projects\\safe.txt"]);
  });

  it("handles drive roots and comparisons case-insensitively", () => {
    expect(isWindowsVolumeRoot("c:\\")).toBe(true);
    expect(isWindowsVolumeRoot("C:\\Projects")).toBe(false);
    expect(isWindowsPathWithin("C:\\Users\\Henry", "c:\\users\\henry\\Documents")).toBe(true);
    expect(isWindowsPathWithin("C:\\Users\\Henry", "C:\\Users\\Henrietta")).toBe(false);
  });

  it("extracts multiple quoted absolute paths without duplicates", () => {
    expect(quotedWindowsPaths(
      'Compare "C:\\One\\file.txt" with \'D:\\Two\\file.txt\' and "c:\\one\\file.txt".'
    )).toEqual(["C:\\One\\file.txt", "D:\\Two\\file.txt"]);
  });
});
