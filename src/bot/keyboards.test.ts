import { describe, expect, it } from "vitest";
import { helpTopicsKeyboard, menuBackKeyboard, privateMenuKeyboard, searchPageKeyboard, taskActionsKeyboard } from "./keyboards";

describe("interactive keyboard navigation", () => {
  it("offers contextual parent routes from nested help and task cards", () => {
    expect(callbackData(helpTopicsKeyboard())).toContain("menu:home");
    expect(callbackData(taskActionsKeyboard("task-row-id"))).toContain("menu:tasks");
  });

  it("keeps a back route even when a paged result has only one page", () => {
    expect(callbackData(searchPageKeyboard("search-id", 1, 1))).toEqual(["menu:search"]);
    expect(callbackData(menuBackKeyboard())).toEqual(["menu:home"]);
  });

  it("keeps only Menu and Dashboard in the persistent private composer", () => {
    const keyboard = privateMenuKeyboard();
    expect(keyboard.keyboard).toEqual([[
      { text: "☰ Menu" },
      {
        text: "🌐 Dashboard",
        web_app: { url: "https://threadwise-dashboard.vercel.app" }
      }
    ]]);
    expect(keyboard.is_persistent).toBe(true);
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
