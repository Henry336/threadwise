import { describe, expect, it } from "vitest";
import { parseSearchRequest } from "./search";

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
