import { describe, expect, it } from "vitest";
import { groupHelpTopicsKeyboard, groupImagesModeKeyboard, groupSettingsModeKeyboard, groupStartMenuKeyboard, helpTopicsKeyboard, menuBackKeyboard, privateMenuKeyboard, PRIVATE_MENU_LABELS, searchPageKeyboard, taskActionsKeyboard } from "./keyboards";
import { formatGroupCommandReference, formatGroupHelpGuide, formatGroupHelpTopic } from "./help";

describe("interactive keyboard navigation", () => {
  it("offers contextual parent routes from nested help and task cards", () => {
    expect(callbackData(helpTopicsKeyboard())).toContain("menu:home");
    expect(callbackData(taskActionsKeyboard("task-row-id"))).toContain("menu:tasks");
  });

  it("adds group assignment actions without changing private task cards", () => {
    expect(callbackData(taskActionsKeyboard("task-row-id"))).not.toContain("task:accept:task-row-id");
    const groupActions = callbackData(taskActionsKeyboard("task-row-id", true, true));
    expect(groupActions).toContain("task:accept:task-row-id");
    expect(groupActions).toContain("task:block:task-row-id");
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

  it("never falls back to private Mini App buttons when a group workspace id is unavailable", () => {
    const groupKeyboards = [groupStartMenuKeyboard(), groupHelpTopicsKeyboard(), groupImagesModeKeyboard(), groupSettingsModeKeyboard()];
    for (const keyboard of groupKeyboards) {
      expect(JSON.stringify(keyboard.inline_keyboard)).not.toContain("web_app");
    }
    expect(callbackData(groupStartMenuKeyboard())).toContain("menu:help");
    expect(callbackData(groupHelpTopicsKeyboard())).toContain("menu:home");
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
