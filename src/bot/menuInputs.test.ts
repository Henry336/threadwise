import { describe, expect, it } from "vitest";
import { beginMenuInput, clearMenuInput, pendingMenuInput } from "./menuInputs";

describe("guided menu input scope", () => {
  it("keeps two Telegram actors in the same group workspace isolated", () => {
    beginMenuInput("group-workspace", 111, "task");

    expect(pendingMenuInput("group-workspace", 111)).toBe("task");
    expect(pendingMenuInput("group-workspace", 222)).toBeUndefined();

    beginMenuInput("group-workspace", 222, "note");
    clearMenuInput("group-workspace", 111);

    expect(pendingMenuInput("group-workspace", 111)).toBeUndefined();
    expect(pendingMenuInput("group-workspace", 222)).toBe("note");
  });
});
