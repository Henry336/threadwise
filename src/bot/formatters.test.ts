import { describe, expect, it } from "vitest";
import { TaskStatus } from "@prisma/client";
import { formatOpenTasks } from "./formatters";
import { archivedPageKeyboard, itemActionsKeyboard, itemListKeyboard, noteMergePreviewKeyboard, taskActionsKeyboard, taskListKeyboard } from "./keyboards";
import type { TaskListItem } from "../services/tasks";

describe("bot formatters", () => {
  it("uses active list numbers while keeping durable task IDs visible", () => {
    const message = formatOpenTasks(
      [
        task({
          publicId: "TASK-999",
          title: "Drink water",
          dueAt: new Date("2026-07-06T01:29:00.000Z")
        })
      ],
      "Asia/Singapore"
    );

    expect(message).toContain("1. <b>Drink water</b>");
    expect(message).toContain("<code>TASK-999</code>");
    expect(message).toContain("<code>/done 1</code>");
  });

  it("groups active tasks by due state", () => {
    const message = formatOpenTasks(
      [
        task({ publicId: "TASK-1", title: "Overdue task", dueAt: new Date("2020-01-01T00:00:00.000Z") }),
        task({ publicId: "TASK-2", title: "No-date task", dueAt: null })
      ],
      "Asia/Singapore"
    );

    expect(message).toContain("Overdue");
    expect(message).toContain("No due date");
  });

  it("shows pinned tasks in their own group", () => {
    const message = formatOpenTasks(
      [
        task({ publicId: "TASK-2", title: "Pinned task", pinnedAt: new Date("2026-07-05T00:01:00.000Z") }),
        task({ publicId: "TASK-1", title: "Regular task" })
      ],
      "Asia/Singapore"
    );

    expect(message).toContain("Pinned");
    expect(message).toContain("pinned");
    expect(message.indexOf("Pinned task")).toBeLessThan(message.indexOf("Regular task"));
  });

  it("escapes user task text in HTML output", () => {
    const message = formatOpenTasks([task({ title: "Read <draft> & reply", dueAt: null })], "Asia/Singapore");

    expect(message).toContain("Read &lt;draft&gt; &amp; reply");
    expect(message).not.toContain("Read <draft> & reply");
  });

  it("builds inline action buttons for numbered open tasks", () => {
    const keyboard = taskListKeyboard([task({ id: "task-uuid-1", title: "Drink water" })]);

    expect(keyboard?.inline_keyboard[0]?.[0]).toEqual({
      text: "Done 1",
      callback_data: "task:done:task-uuid-1"
    });
    expect(keyboard?.inline_keyboard[0]?.[1]).toEqual({
      text: "Snooze 1",
      callback_data: "task:snooze:task-uuid-1"
    });
    expect(keyboard?.inline_keyboard[0]?.[2]).toEqual({
      text: "Star 1",
      callback_data: "item:task:pin:task-uuid-1"
    });
    expect(keyboard?.inline_keyboard[0]?.[3]).toEqual({
      text: "Edit 1",
      callback_data: "item:task:edit:task-uuid-1"
    });
    expect(keyboard?.inline_keyboard).toHaveLength(1);
  });

  it("shows star or unstar on individual task action buttons", () => {
    const unpinned = taskActionsKeyboard(task({ id: "task-uuid-1" }));
    const pinned = taskActionsKeyboard(task({ id: "task-uuid-1", pinnedAt: new Date("2026-07-05T00:01:00.000Z") }));

    expect(unpinned.inline_keyboard[1]?.[0]).toEqual({
      text: "Star",
      callback_data: "item:task:pin:task-uuid-1"
    });
    expect(unpinned.inline_keyboard[1]?.[1]).toEqual({
      text: "Edit",
      callback_data: "item:task:edit:task-uuid-1"
    });
    expect(pinned.inline_keyboard[1]?.[0]).toEqual({
      text: "Unstar",
      callback_data: "item:task:unpin:task-uuid-1"
    });
  });

  it("shows star and edit controls for individual notes and ideas", () => {
    const noteKeyboard = itemActionsKeyboard("note", { id: "note-uuid-1" });
    const ideaKeyboard = itemActionsKeyboard("idea", { id: "idea-uuid-1", pinnedAt: new Date("2026-07-05T00:01:00.000Z") });

    expect(noteKeyboard.inline_keyboard[0]?.[0]).toEqual({
      text: "Star",
      callback_data: "item:note:pin:note-uuid-1"
    });
    expect(noteKeyboard.inline_keyboard[0]?.[1]).toEqual({
      text: "Edit",
      callback_data: "item:note:edit:note-uuid-1"
    });
    expect(ideaKeyboard.inline_keyboard[0]?.[0]).toEqual({
      text: "Unstar",
      callback_data: "item:idea:unpin:idea-uuid-1"
    });
  });

  it("shows star and edit controls for note and idea lists", () => {
    const keyboard = itemListKeyboard("note", [{ id: "note-uuid-1", pinnedAt: null }]);

    expect(keyboard?.inline_keyboard[0]?.[0]).toEqual({
      text: "Star 1",
      callback_data: "item:note:pin:note-uuid-1"
    });
    expect(keyboard?.inline_keyboard[0]?.[1]).toEqual({
      text: "Edit 1",
      callback_data: "item:note:edit:note-uuid-1"
    });
  });

  it("builds note merge preview controls", () => {
    const keyboard = noteMergePreviewKeyboard("pending-merge-1");

    expect(keyboard.inline_keyboard[0]?.[0]).toEqual({
      text: "Merge",
      callback_data: "merge:confirm:pending-merge-1"
    });
    expect(keyboard.inline_keyboard[0]?.[1]).toEqual({
      text: "Try again",
      callback_data: "merge:retry:pending-merge-1"
    });
    expect(keyboard.inline_keyboard[1]?.[0]).toEqual({
      text: "Cancel",
      callback_data: "merge:cancel:pending-merge-1"
    });
  });

  it("builds archived pagination controls", () => {
    const keyboard = archivedPageKeyboard("notes", 2, 4);

    expect(keyboard?.inline_keyboard[0]?.[0]).toEqual({
      text: "Prev",
      callback_data: "archived:notes:1"
    });
    expect(keyboard?.inline_keyboard[0]?.[1]).toEqual({
      text: "Page 2/4",
      callback_data: "archived:notes:2"
    });
    expect(keyboard?.inline_keyboard[0]?.[2]).toEqual({
      text: "Next",
      callback_data: "archived:notes:3"
    });
  });
});

function task(overrides: Partial<TaskListItem>): TaskListItem {
  return {
    id: overrides.id ?? overrides.publicId ?? "task-id",
    publicId: overrides.publicId ?? "TASK-1",
    title: overrides.title ?? "Task",
    description: overrides.description ?? null,
    sourceText: overrides.sourceText ?? overrides.title ?? "Task",
    status: overrides.status ?? TaskStatus.OPEN,
    dueAt: overrides.dueAt ?? null,
    timezone: overrides.timezone ?? "Asia/Singapore",
    calendarUrl: overrides.calendarUrl ?? null,
    reminderIntervalMinutes: overrides.reminderIntervalMinutes ?? 180,
    nextReminderAt: overrides.nextReminderAt ?? null,
    snoozedUntil: overrides.snoozedUntil ?? null,
    lastRemindedAt: overrides.lastRemindedAt ?? null,
    reminderCount: overrides.reminderCount ?? 0,
    pinnedAt: overrides.pinnedAt ?? null,
    archivedAt: overrides.archivedAt ?? null,
    createdAt: overrides.createdAt ?? new Date("2026-07-05T00:00:00.000Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-07-05T00:00:00.000Z")
  };
}
