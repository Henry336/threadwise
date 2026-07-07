import { describe, expect, it } from "vitest";
import { TaskStatus } from "@prisma/client";
import { formatOpenTasks, formatTaskDetail } from "./formatters";
import { archivedPageKeyboard, itemActionsKeyboard, itemListKeyboard, noteMergePreviewKeyboard, searchPageKeyboard, taskActionsKeyboard, taskListKeyboard } from "./keyboards";
import { formatHelpPage, formatStartText, HELP_COMMANDS } from "./help";
import type { TaskListItem } from "../services/tasks";
import { formatTaskCreated } from "../services/tasks";
import { formatNoteDetail } from "../services/notes";
import { formatIdeaDetail } from "../services/ideas";
import { formatArchivedPage } from "../services/archives";

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

  it("shows starred tasks as important in their own group", () => {
    const message = formatOpenTasks(
      [
        task({ publicId: "TASK-2", title: "Important task", pinnedAt: new Date("2026-07-05T00:01:00.000Z") }),
        task({ publicId: "TASK-1", title: "Regular task" })
      ],
      "Asia/Singapore"
    );

    expect(message).toContain("<b>Important</b>");
    expect(message).toContain("<b>Important</b> <i>starred task</i>");
    expect(message.indexOf("Important task")).toBeLessThan(message.indexOf("Regular task"));
  });

  it("marks starred task details as important", () => {
    const message = formatTaskDetail(task({ title: "Reply to bank", pinnedAt: new Date("2026-07-05T00:01:00.000Z") }));

    expect(message).toContain("<b>Important task</b>");
    expect(message).toContain("<b>Important:</b> Yes");
  });

  it("formats newly created tasks without noisy calendar links", () => {
    const message = formatTaskCreated({
      publicId: "TASK-9",
      title: "Prepare a gift",
      dueAt: new Date("2026-07-06T18:44:35.000Z"),
      timezone: "Asia/Singapore"
    }, "Asia/Singapore");

    expect(message).toContain("Prepare a gift");
    expect(message).toContain("<b>Due Date:</b>");
    expect(message).toContain("<b>Task ID:</b> <code>TASK-9</code>");
    expect(message).not.toContain("calendar.google.com");
  });

  it("escapes user task text in HTML output", () => {
    const message = formatOpenTasks([task({ title: "Read <draft> & reply", dueAt: null })], "Asia/Singapore");

    expect(message).toContain("Read &lt;draft&gt; &amp; reply");
    expect(message).not.toContain("Read <draft> & reply");
  });

  it("builds inline action buttons for numbered open tasks", () => {
    const keyboard = taskListKeyboard([task({ id: "task-uuid-1", title: "Drink water" })]);

    expect(keyboard?.inline_keyboard[0]?.[0]).toEqual({
      text: "Complete 1",
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
      callback_data: "item:task:edit:title:task-uuid-1"
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
      text: "Edit title",
      callback_data: "item:task:edit:title:task-uuid-1"
    });
    expect(unpinned.inline_keyboard[2]?.[0]).toEqual({
      text: "Edit details",
      callback_data: "item:task:edit:description:task-uuid-1"
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
      text: "Edit title",
      callback_data: "item:note:edit:title:note-uuid-1"
    });
    expect(noteKeyboard.inline_keyboard[1]?.[0]).toEqual({
      text: "Edit body",
      callback_data: "item:note:edit:body:note-uuid-1"
    });
    expect(noteKeyboard.inline_keyboard[2]?.[0]).toEqual({
      text: "Archive note",
      callback_data: "item:note:archive:note-uuid-1"
    });
    expect(ideaKeyboard.inline_keyboard[0]?.[0]).toEqual({
      text: "Unstar",
      callback_data: "item:idea:unpin:idea-uuid-1"
    });
    expect(ideaKeyboard.inline_keyboard[2]).toBeUndefined();
  });

  it("shows star and edit controls for note and idea lists", () => {
    const keyboard = itemListKeyboard("note", [{ id: "note-uuid-1", pinnedAt: null }]);

    expect(keyboard?.inline_keyboard[0]?.[0]).toEqual({
      text: "Star 1",
      callback_data: "item:note:pin:note-uuid-1"
    });
    expect(keyboard?.inline_keyboard[0]?.[1]).toEqual({
      text: "Edit 1",
      callback_data: "item:note:edit:title:note-uuid-1"
    });
    expect(keyboard?.inline_keyboard[0]?.[2]).toEqual({
      text: "Archive 1",
      callback_data: "item:note:archive:note-uuid-1"
    });
  });

  it("formats note saved dates in the user's timezone", () => {
    const message = formatNoteDetail({
      publicId: "NOTE-9",
      title: "OMG",
      body: "OMG",
      summary: "OMG",
      tags: [],
      createdAt: new Date("2026-07-06T18:44:35.000Z")
    }, "Asia/Singapore");

    expect(message).toContain("<b>Saved Date:</b>");
    expect(message).toContain("2:44");
    expect(message).not.toContain("6:44");
    expect(message).not.toContain("<b>Summary</b>");
    expect(message).not.toContain("<b>Tags</b>");
  });

  it("formats idea saved dates in the user's timezone", () => {
    const message = formatIdeaDetail({
      publicId: "IDEA-1",
      title: "Inbox helper",
      concept: "Capture useful thoughts quickly.",
      tags: [],
      createdAt: new Date("2026-07-06T18:44:35.000Z")
    }, "Asia/Singapore");

    expect(message).toContain("<b>Saved Date:</b>");
    expect(message).toContain("2:44");
    expect(message).not.toContain("6:44");
  });

  it("formats archived item dates in the user's timezone", () => {
    const message = formatArchivedPage({
      kind: "notes",
      page: 1,
      pageSize: 10,
      totalItems: 1,
      totalPages: 1,
      items: [{
        id: "note-uuid-1",
        publicId: "NOTE-9",
        title: "OMG",
        summary: "OMG",
        archivedAt: new Date("2026-07-06T18:44:35.000Z")
      }]
    }, "Asia/Singapore");

    expect(message).toContain("<b>Archived Date:</b>");
    expect(message).toContain("2:44");
    expect(message).not.toContain("6:44");
  });

  it("builds search pagination controls", () => {
    const keyboard = searchPageKeyboard("pending-search-1", 2, 3);

    expect(keyboard?.inline_keyboard[0]?.[0]).toEqual({
      text: "Prev",
      callback_data: "search:pending-search-1:1"
    });
    expect(keyboard?.inline_keyboard[0]?.[1]).toEqual({
      text: "Page 2/3",
      callback_data: "search:pending-search-1:2"
    });
    expect(keyboard?.inline_keyboard[0]?.[2]).toEqual({
      text: "Next",
      callback_data: "search:pending-search-1:3"
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

  it("shows help commands alphabetically", () => {
    const message = formatHelpPage(1);

    expect(message.indexOf("<code>/add</code>")).toBeLessThan(message.indexOf("<code>/archived</code>"));
    expect(message.indexOf("<code>/archived</code>")).toBeLessThan(message.indexOf("<code>/brief</code>"));
    expect(message).not.toContain("<code>/start</code> - Show first-run onboarding");
  });

  it("includes important and version commands in help metadata", () => {
    expect(HELP_COMMANDS.map((item) => item.command)).toContain("/archive");
    expect(HELP_COMMANDS.map((item) => item.command)).toContain("/googlecal");
    expect(HELP_COMMANDS.map((item) => item.command)).toContain("/important");
    expect(HELP_COMMANDS.map((item) => item.command)).toContain("/version");
  });

  it("shows a tiny onboarding checklist after start", () => {
    const message = formatStartText("Asia/Yangon");

    expect(message).toContain("<b>First checklist</b>");
    expect(message).toContain("[ ] <code>change timezone to Singapore</code> - set timezone if this looks wrong");
    expect(message).toContain("[ ] <code>add pay invoice tomorrow at 9am</code> - add your first task");
    expect(message).toContain("[ ] <code>note Deployment reliability depends on avoiding sleeping workers</code> - save your first note");
    expect(message).toContain("Telegram does not share an exact device timezone with bots");
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
