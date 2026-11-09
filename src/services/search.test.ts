import { describe, expect, it, vi } from "vitest";
import { parseSearchRequest, semanticSearch } from "./search";

const rows = vi.hoisted(() => ({
  notes: [] as Array<Record<string, unknown>>
}));

vi.mock("../db/prisma", () => ({
  prisma: {
    idea: { findMany: vi.fn(async () => []) },
    task: { findMany: vi.fn(async () => []) },
    note: { findMany: vi.fn(async () => rows.notes) }
  }
}));

describe("semantic search", () => {
  it("scores an edited item from its text, not from a stored vector", async () => {
    rows.notes = [{
      publicId: "NOTE-1",
      title: "Railway overrun",
      summary: "",
      body: "",
      sourceText: "",
      embedding: null
    }];

    const [result] = await semanticSearch("user-1", "overrun railway", ["note"]);

    expect(result?.publicId).toBe("NOTE-1");
    // Lexical matching caps out-of-order terms at 0.85; only the vector reaches 1.
    expect(result?.score).toBeCloseTo(1);
  });
});

describe("search request parsing", () => {
  it("treats an unfiltered search as all saved item types", () => {
    expect(parseSearchRequest("deployment reliability")).toEqual({
      query: "deployment reliability"
    });
  });

  it("extracts supported type filters", () => {
    expect(parseSearchRequest("notes deployment reliability")).toEqual({
      query: "deployment reliability",
      kinds: ["note"],
      label: "note"
    });

    expect(parseSearchRequest("tasks invoice")).toEqual({
      query: "invoice",
      kinds: ["task"],
      label: "task"
    });
  });

  it("does not expose legacy reflection filters", () => {
    expect(parseSearchRequest("reflections conflict notes")).toEqual({
      query: "reflections conflict notes"
    });
  });

  it("extracts done task searches explicitly", () => {
    expect(parseSearchRequest("done curriculum paper")).toEqual({
      query: "curriculum paper",
      kinds: ["task"],
      label: "done tasks",
      includeDone: true,
      doneOnly: true
    });
  });
});
