import { describe, expect, it } from "vitest";
import { dashboardViewUrl, groupDashboardItemUrl, groupTaskImportReviewUrl } from "./links";

describe("dashboard deep links", () => {
  it("opens an exact personal item", () => {
    const url = dashboardViewUrl("tasks", { kind: "task", id: "task-row-id" });
    expect(url).toContain("view=tasks");
    expect(url).toContain("kind=task");
    expect(url).toContain("item=task-row-id");
  });

  it("selects the group workspace before opening an exact item", () => {
    const url = groupDashboardItemUrl("workspace-1", "notes", "note", "note-row-id");
    expect(url).toContain("workspace=workspace-1");
    const next = new URL(url).searchParams.get("next");
    expect(next).toBe("/dashboard?view=notes&kind=note&item=note-row-id");
  });

  it("opens the exact TODO review batch", () => {
    const url = groupTaskImportReviewUrl("workspace-1", "import-1");
    expect(url).toContain("workspace=workspace-1");
    expect(url).toContain("import%3Dimport-1");
  });
});
