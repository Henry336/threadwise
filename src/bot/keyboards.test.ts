import { describe, expect, it } from "vitest";
import { helpTopicsKeyboard, menuBackKeyboard, searchPageKeyboard, taskActionsKeyboard } from "./keyboards";

describe("interactive keyboard navigation", () => {
  it("offers a main-menu route from nested help and task cards", () => {
    expect(callbackData(helpTopicsKeyboard())).toContain("menu:home");
    expect(callbackData(taskActionsKeyboard("task-row-id"))).toContain("menu:home");
  });

  it("keeps a back route even when a paged result has only one page", () => {
    expect(callbackData(searchPageKeyboard("search-id", 1, 1))).toEqual(["menu:home"]);
    expect(callbackData(menuBackKeyboard())).toEqual(["menu:home"]);
  });
});

function callbackData(keyboard: { inline_keyboard: unknown[][] } | undefined): string[] {
  return keyboard?.inline_keyboard.flatMap((row) =>
    row.flatMap((button) => {
      if (
        typeof button === "object" &&
        button !== null &&
        "callback_data" in button &&
        typeof button.callback_data === "string"
      ) {
        return [button.callback_data];
      }

      return [];
    }),
  ) ?? [];
}
