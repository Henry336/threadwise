import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  utimes,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSafeFileSnapshot,
  isDevicePath,
  isPathWithinRoot,
  parseFileRoots,
  searchLaptopFiles,
  validateLocalFile
} from "./fileCourierLocal";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("laptop file courier path security", () => {
  it("requires explicit roots and rejects Windows device paths", () => {
    expect(parseFileRoots(undefined)).toEqual([]);
    expect(isDevicePath("\\\\.\\PhysicalDrive0")).toBe(true);
    expect(isDevicePath("\\\\?\\C:\\Windows")).toBe(true);
    expect(isDevicePath("C:\\Users\\Henry")).toBe(false);
  });

  it("rejects traversal, directories, reparse-point escapes, and oversized files", async () => {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const outsideFile = join(outside, "private.txt");
    await writeFile(outsideFile, "private");
    await expect(validateLocalFile(outsideFile, [root], 1_000)).rejects.toThrow(/outside/i);
    await expect(validateLocalFile(root, [root], 1_000)).rejects.toThrow(/directory/i);

    const large = join(root, "large.bin");
    await writeFile(large, Buffer.alloc(2_000));
    await expect(validateLocalFile(large, [root], 1_000)).rejects.toThrow(/larger/i);

    const link = join(root, "linked");
    await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
    await expect(validateLocalFile(join(link, "private.txt"), [root], 1_000)).rejects.toThrow(/links|reparse/i);
  });

  it("detects path substitution even when size and modified time are restored", async () => {
    const root = await temporaryDirectory();
    const file = join(root, "stable.txt");
    await writeFile(file, "first");
    const expected = await validateLocalFile(file, [root], 1_000);
    const modified = new Date(expected.modifiedAt);
    await rm(file);
    await writeFile(file, "other");
    await utimes(file, modified, modified);
    await expect(validateLocalFile(file, [root], 1_000, expected)).rejects.toThrow(/changed/i);
  });

  it("creates an isolated snapshot and verifies it after streaming", async () => {
    const root = await temporaryDirectory();
    const file = join(root, "notes.pdf");
    await writeFile(file, "unchanging bytes");
    const expected = await validateLocalFile(file, [root], 1_000);
    const snapshot = await createSafeFileSnapshot({
      path: file,
      roots: [root],
      maxBytes: 1_000,
      expected
    });
    try {
      expect(snapshot.path).not.toBe(file);
      await snapshot.verifyUnchanged();
    } finally {
      await snapshot.cleanup();
    }
  });

  it("keeps duplicate filenames from different configured roots", async () => {
    const first = await temporaryDirectory();
    const second = await temporaryDirectory();
    await writeFile(join(first, "curriculum.pdf"), "one");
    await writeFile(join(second, "curriculum.pdf"), "two");
    const results = await searchLaptopFiles({
      roots: [first, second],
      kind: "SEARCH",
      query: "curriculum pdf",
      maxBytes: 1_000,
      scanLimit: 100
    });
    expect(results).toHaveLength(2);
    expect(new Set(results.map((result) => result.parentPath))).toEqual(new Set([first, second]));
    expect(isPathWithinRoot(results[0]!.absolutePath, results[0]!.parentPath)).toBe(true);
  });

  it("returns enough validated metadata for multiple Telegram result pages", async () => {
    const root = await temporaryDirectory();
    await Promise.all(Array.from({ length: 18 }, (_, index) => (
      writeFile(join(root, `resume-${String(index + 1).padStart(2, "0")}.pdf`), `file ${index + 1}`)
    )));
    const results = await searchLaptopFiles({
      roots: [root],
      kind: "SEARCH",
      query: "resume",
      maxBytes: 1_000,
      scanLimit: 100,
      take: 18
    });
    expect(results).toHaveLength(18);
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "threadwise-file-test-"));
  temporaryDirectories.push(directory);
  await mkdir(directory, { recursive: true });
  return directory;
}
