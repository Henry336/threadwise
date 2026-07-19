import { describe, expect, it } from "vitest";
import { groupHelpTopicsKeyboard, groupStartMenuKeyboard, helpTopicsKeyboard, menuBackKeyboard, privateMenuKeyboard, PRIVATE_MENU_LABELS, searchPageKeyboard, taskActionsKeyboard } from "./keyboards";
import { formatGroupCommandReference, formatGroupHelpGuide, formatGroupHelpTopic } from "./help";

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
      { text: PRIVATE_MENU_LABELS.menu },
      { text: PRIVATE_MENU_LABELS.dashboard }
    ]]);
    expect(keyboard.is_persistent).toBe(true);
  });

  it("keeps group help compact and routes every group surface through the shared workspace", () => {
    const workspaceId = "6cd8f630-05f4-48c0-b7fb-ffacbc4ff1a2";
    const menu = groupStartMenuKeyboard(workspaceId).inline_keyboard.flat();
    expect(menu).toContainEqual(expect.objectContaining({ text: "🌐 Group dashboard", url: expect.any(String) }));
    expect(menu).not.toContainEqual(expect.objectContaining({ web_app: expect.anything() }));
    expect(JSON.stringify(menu)).toContain(encodeURIComponent(workspaceId));
    expect(callbackData(groupHelpTopicsKeyboard(workspaceId))).toContain("menu:commands");
    expect(formatGroupHelpGuide("threadwise_1_bot").length).toBeLessThan(1_500);
    expect(formatGroupHelpTopic("settings")).toContain("group admin");
    expect(formatGroupHelpTopic("excel")).toContain("never shared");
    expect(formatGroupCommandReference()).toContain("/dashboard");
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
