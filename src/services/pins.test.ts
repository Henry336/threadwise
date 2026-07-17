import { describe, expect, it } from "vitest";
import { formatPinnedItems } from "./pins";

describe("important list formatting", () => {
  it("keeps internal item IDs out of the default surface", () => {
    const message = formatPinnedItems([{
      kind: "task" as const,
      id: "task-row-1",
      publicId: "TASK-42",
      title: "Submit application",
      summary: "Finish the final review",
      pinnedAt: new Date("2026-07-17T00:00:00.000Z"),
      createdAt: new Date("2026-07-16T00:00:00.000Z")
    }]);

    expect(message).not.toContain("Item ID");
    expect(message).not.toContain("TASK-42");
    expect(message).toContain("Submit application");
  });
});
