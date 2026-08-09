import { describe, expect, it } from "vitest";
import { TaskStatus } from "@prisma/client";
import {
  archivedNoteDetailKeyboard,
  groupHelpTopicsKeyboard,
  groupImagesModeKeyboard,
  groupSettingsModeKeyboard,
  groupStartMenuKeyboard,
  groupTaskActionsKeyboard,
  helpTopicsKeyboard,
  itemListKeyboard,
  menuBackKeyboard,
  noteSessionKeyboard,
  notesModeKeyboard,
  NOTE_SESSION_LABELS,
  privateMenuKeyboard,
  PRIVATE_MENU_LABELS,
  reminderActionsKeyboard,
  searchPageKeyboard,
  taskActionsKeyboard,
  taskListKeyboard,
} from "./keyboards";
import { formatGroupCommandReference, formatGroupHelpGuide, formatGroupHelpTopic } from "./help";

describe("interactive keyboard navigation", () => {
  it("keeps ordinary task cards within a two-row, three-action budget", () => {
    const keyboard = taskActionsKeyboard("task-row-id");
    expect(keyboard.inline_keyboard).toHaveLength(2);
    expect(keyboard.inline_keyboard.flat()).toHaveLength(4);
    expect(callbackData(keyboard)).toEqual(["task:done:task-row-id", "task:snooze:task-row-id", "menu:tasks"]);
    expect(JSON.stringify(keyboard.inline_keyboard)).toContain("kind=task");
  });

  it("uses contextual group actions without accept, block, decline, or handoff", () => {
    const workspaceId = "workspace-1";
    expect(callbackData(groupTaskActionsKeyboard("task-1", "unassigned", workspaceId))).toEqual([
      "task:claim:task-1",
      "task:view-full:task-1",
    ]);
    expect(callbackData(groupTaskActionsKeyboard("task-1", "assignee", workspaceId))).toEqual([
      "task:done:task-1",
      "task:snooze:task-1",
      "task:view-full:task-1",
    ]);
    expect(callbackData(groupTaskActionsKeyboard("task-1", "other", workspaceId))).toEqual(["task:view-full:task-1"]);
    expect(JSON.stringify(groupTaskActionsKeyboard("task-1", "manager", workspaceId, true).inline_keyboard)).not.toMatch(/accept|block|decline|handoff/);
  });

  it("hides numbered item controls until Choose an item is pressed", () => {
    const navigation = { kind: "tasks" as const, page: 1, totalPages: 1, numberOffset: 0, workspaceId: "workspace-1" };
    const task = { id: "task-1", publicId: "TASK-1", title: "One", sourceText: "One", status: TaskStatus.OPEN, reminderCount: 0, createdAt: new Date(0), updatedAt: new Date(0) };
    const collapsed = taskListKeyboard([task], 3, navigation);
    const expanded = taskListKeyboard([task], 3, navigation, true);
    expect(callbackData(collapsed)).toContain("list:choose:tasks:1");
    expect(callbackData(collapsed)).not.toContain("item:task:open:task-1:1");
    expect(callbackData(expanded)).toEqual(["item:task:open:task-1:1", "list:tasks:1"]);

    const notes = itemListKeyboard("note", [{ id: "note-1", publicId: "NOTE-1" }], 3, { ...navigation, kind: "notes" });
    expect(callbackData(notes)).toContain("list:choose:notes:1");
  });

  it("keeps a back route even when a paged result has only one page", () => {
    expect(callbackData(searchPageKeyboard("search-id", 1, 1))).toEqual(["menu:search"]);
    expect(callbackData(menuBackKeyboard())).toEqual(["menu:home"]);
  });

  it("keeps only Menu and Dashboard in the persistent private composer", () => {
    const keyboard = privateMenuKeyboard();
    expect(keyboard.keyboard).toEqual([[{ text: PRIVATE_MENU_LABELS.menu }, { text: PRIVATE_MENU_LABELS.dashboard }]]);
    expect(keyboard.is_persistent).toBe(true);
  });

  it("keeps note-session Save and Cancel controls beside the private composer", () => {
    expect(callbackData(notesModeKeyboard())).toContain("menu:notes-session");
    const keyboard = noteSessionKeyboard();
    expect(keyboard.keyboard).toEqual([[{ text: NOTE_SESSION_LABELS.save }, { text: NOTE_SESSION_LABELS.cancel }]]);
    expect(keyboard.is_persistent).toBe(true);
  });

  it("keeps archived long-note pagination inside one Telegram card", () => {
    expect(callbackData(archivedNoteDetailKeyboard("NOTE-14", 2, 3))).toEqual([
      "archived-note:page:NOTE-14:1",
      "archived-note:page:NOTE-14:2",
      "archived-note:page:NOTE-14:3",
      "menu:notes-archived",
    ]);
  });

  it("keeps group home compact and permanently exposes the dashboard", () => {
    const workspaceId = "6cd8f630-05f4-48c0-b7fb-ffacbc4ff1a2";
    const menu = groupStartMenuKeyboard(workspaceId).inline_keyboard.flat();
    expect(menu).toContainEqual(expect.objectContaining({ text: "Open group dashboard ↗", url: expect.any(String) }));
    expect(menu).not.toContainEqual(expect.objectContaining({ web_app: expect.anything() }));
    expect(JSON.stringify(menu)).toContain(encodeURIComponent(workspaceId));
    expect(callbackData(groupHelpTopicsKeyboard(workspaceId))).toContain("menu:commands");
    expect(callbackData(groupStartMenuKeyboard(workspaceId))).toContain("menu:find-time");
    expect(formatGroupHelpGuide("threadwise_1_bot").length).toBeLessThan(1_500);
    expect(formatGroupHelpTopic("settings")).toContain("group admin");
    expect(formatGroupHelpTopic("excel")).toContain("<b>Capture</b>");
    expect(formatGroupHelpTopic("excel")).not.toContain("Excel");
    expect(menu).not.toContainEqual(expect.objectContaining({ callback_data: "menu:expenses" }));
    expect(formatGroupCommandReference()).toContain("/dashboard");
    expect(formatGroupCommandReference()).toContain("/findtime");
  });

  it("never falls back to private Mini App buttons when a group workspace id is unavailable", () => {
    const groupKeyboards = [groupStartMenuKeyboard(), groupHelpTopicsKeyboard(), groupImagesModeKeyboard(), groupSettingsModeKeyboard()];
    for (const keyboard of groupKeyboards) expect(JSON.stringify(keyboard.inline_keyboard)).not.toContain("web_app");
    expect(callbackData(groupStartMenuKeyboard())).toContain("menu:group-more");
    expect(callbackData(groupHelpTopicsKeyboard())).toContain("menu:home");
  });
});

function callbackData(keyboard: { inline_keyboard: unknown[][] } | undefined): string[] {
  return keyboard?.inline_keyboard.flatMap((row) => row.flatMap((button) => {
    if (typeof button === "object" && button !== null && "callback_data" in button && typeof button.callback_data === "string") {
      return [button.callback_data];
    }
    return [];
  })) ?? [];
}
