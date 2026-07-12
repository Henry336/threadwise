import { describe, expect, it } from "vitest";
import { parseBulkActionRequest, parseBulkReferences } from "./bulkActions";

describe("bulk actions", () => {
  it.each([
    ["complete tasks 1, 2 and 3", { action: "complete", itemKind: "task", references: ["1", "2", "3"] }],
    ["mark tasks TASK-1 and TASK-3 as done", { action: "complete", itemKind: "task", references: ["TASK-1", "TASK-3"] }],
    ["delete notes 1-3", { action: "delete", itemKind: "note", references: ["1", "2", "3"] }],
    ["remove my ideas IDEA-2, IDEA-4", { action: "delete", itemKind: "idea", references: ["IDEA-2", "IDEA-4"] }],
    ["cancel tasks 2 and 5", { action: "delete", itemKind: "task", references: ["2", "5"] }],
    ["delete NOTE-1 and NOTE-2", { action: "delete", itemKind: "note", references: ["NOTE-1", "NOTE-2"] }],
    ["complete 1 and 2", { action: "complete", itemKind: "task", references: ["1", "2"] }]
  ])("parses %s", (text, expected) => {
    expect(parseBulkActionRequest(text)).toEqual(expected);
  });

  it("expands ranges, removes duplicates, and rejects unsafe prose", () => {
    expect(parseBulkReferences("1 to 3, 3 and 5")).toEqual(["1", "2", "3", "5"]);
    expect(parseBulkReferences("1 and everything else")).toBeUndefined();
    expect(parseBulkActionRequest("delete note 1")).toBeUndefined();
  });
});
