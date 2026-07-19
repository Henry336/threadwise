import { describe, expect, it } from "vitest";
import { RecurrenceRule, TaskStatus } from "@prisma/client";
import { formatIdeaScore, formatOpenTasks, formatTaskDetail } from "./formatters";
import { archivedPageKeyboard, ideasModeKeyboard, incomingImageKeyboard, itemActionsKeyboard, itemListKeyboard, noteMergePreviewKeyboard, privateMenuKeyboard, regionSettingsKeyboard, reminderSettingsKeyboard, restoreCompletedTaskKeyboard, searchPageKeyboard, settingChoicesKeyboard, settingsModeKeyboard, startMenuKeyboard, taskActionsKeyboard, taskListKeyboard } from "./keyboards";
import { formatCommandReference, formatHelpPage, formatHelpTopic, formatStartShortcutText, HELP_COMMANDS } from "./help";
import type { TaskListItem } from "../services/tasks";
import { formatTaskAlreadyCompleted, formatTaskCompleted, formatTaskCreated } from "../services/tasks";
import { formatNoteDetail, formatRecentNotes } from "../services/notes";
import { formatIdeaDetail, formatRecentIdeas } from "../services/ideas";
import { formatArchivedPage } from "../services/archives";

describe("bot formatters", () => {
  it("uses active list numbers without exposing internal task metadata", () => {
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

    expect(message).toContain("<b>Drink water</b>");
    expect(message).not.toContain("TASK-999");
    expect(message).not.toContain("Reminders Sent");
    expect(message).toContain("Tap a number");
  });

  it("keeps due state visible without separate heading blocks", () => {
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

  it("marks starred tasks inline without adding another section", () => {
    const message = formatOpenTasks(
      [
        task({ publicId: "TASK-2", title: "Important task", pinnedAt: new Date("2026-07-05T00:01:00.000Z") }),
        task({ publicId: "TASK-1", title: "Regular task" })
      ],
      "Asia/Singapore"
    );

    expect(message).toContain("1 ⭐ <b>Important task</b>");
    expect(message).not.toContain("starred task");
    expect(message.indexOf("Important task")).toBeLessThan(message.indexOf("Regular task"));
  });

  it("marks starred task details as important", () => {
    const message = formatTaskDetail(task({ title: "Reply to bank", pinnedAt: new Date("2026-07-05T00:01:00.000Z") }));

    expect(message).toContain("<b>📋 Task</b>");
    expect(message).toContain("⭐ Important");
    expect(message).not.toContain("Task ID");
    expect(message).not.toContain("Reminders Sent");
    expect(message).not.toContain("Captured Text");
  });

  it("removes a repeated title from task details", () => {
    const message = formatTaskDetail(task({
      title: "Plan the launch",
      description: "Plan the launch — confirm the venue and invite the team."
    }));

    expect(message).toContain("<b>Plan the launch</b>");
    expect(message).toContain("confirm the venue and invite the team.");
    expect(message).not.toContain("Plan the launch — confirm");
  });

  it("formats newly created tasks without noisy calendar links", () => {
    const message = formatTaskCreated({
      publicId: "TASK-9",
      title: "Prepare a gift",
      dueAt: new Date("2026-07-06T18:44:35.000Z"),
      timezone: "Asia/Singapore",
      assignedUsername: "henry_derek",
      recurrenceRule: RecurrenceRule.DAILY
    }, "Asia/Singapore");

    expect(message).toContain("Prepare a gift");
    expect(message).toContain("<b>Due Date:</b>");
    expect(message).toContain("<b>Assigned To:</b> @henry_derek");
    expect(message).toContain("<b>Repeats:</b> Daily");
    expect(message).not.toContain("Task ID");
    expect(message).not.toContain("calendar.google.com");
  });

  it("formats recurring task completion as one occurrence", () => {
    const message = formatTaskCompleted(task({
      title: "Have dinner",
      recurrenceRule: RecurrenceRule.DAILY,
      recurrenceIntervalDays: 1,
      dueAt: new Date("2026-07-06T11:00:00.000Z")
    }), "Asia/Singapore");

    expect(message).toContain("This occurrence is done");
    expect(message).toContain("<b>Next Occurrence:</b>");
    expect(message).toContain("<b>Repeats:</b> Daily");
  });

  it("formats an already-completed task as a restore prompt", () => {
    const completed = task({ status: TaskStatus.DONE, title: "Submit report" });
    const message = formatTaskAlreadyCompleted(completed);
    const keyboard = restoreCompletedTaskKeyboard(completed.id);

    expect(message).toContain("Already complete");
    expect(message).toContain("restore it below");
    expect(keyboard.inline_keyboard[0]?.[0]).toEqual({
      text: "↩️ Restore task",
      callback_data: `task:restore:${completed.id}`
    });
  });

  it("escapes user task text in HTML output", () => {
    const message = formatOpenTasks([task({ title: "Read <draft> & reply", dueAt: null })], "Asia/Singapore");

    expect(message).toContain("Read &lt;draft&gt; &amp; reply");
    expect(message).not.toContain("Read <draft> & reply");
  });

  it("builds inline action buttons for numbered open tasks", () => {
    const keyboard = taskListKeyboard([task({ id: "task-uuid-1", title: "Drink water" })]);

    expect(keyboard?.inline_keyboard[0]?.[0]).toEqual({
      text: "1",
      callback_data: "item:task:open:task-uuid-1:1"
    });
    expect(keyboard?.inline_keyboard).toHaveLength(2);
    expect(keyboard?.inline_keyboard.at(-1)).toEqual([
      { text: "‹ Tasks", callback_data: "menu:tasks" }
    ]);
  });

  it("fits three list choices into one mobile-friendly button row", () => {
    const keyboard = taskListKeyboard([
      task({ id: "task-1" }), task({ id: "task-2" }), task({ id: "task-3" })
    ]);

    expect(keyboard?.inline_keyboard[0]?.map((button) => button.text)).toEqual(["1", "2", "3"]);
    expect(keyboard?.inline_keyboard).toHaveLength(2);
  });

  it("keeps global numbering and navigation on later task pages", () => {
    const page = { page: 2, totalPages: 3, offset: 10 };
    const item = task({ id: "task-uuid-11", title: "Later task" });
    const message = formatOpenTasks([item], "Asia/Singapore", page);
    const keyboard = taskListKeyboard([item], 10, { kind: "tasks", numberOffset: 10, page: 2, totalPages: 3 });

    expect(message).toContain("· 2/3");
    expect(message).toContain("11 · <b>Later task</b>");
    expect(keyboard?.inline_keyboard[0]?.[0]?.text).toBe("11");
    expect(keyboard?.inline_keyboard.at(-2)).toEqual([
      { text: "←", callback_data: "list:tasks:1" },
      { text: "2/3", callback_data: "list:tasks:2" },
      { text: "→", callback_data: "list:tasks:3" }
    ]);
    expect(keyboard?.inline_keyboard.at(-1)).toEqual([
      { text: "‹ Tasks", callback_data: "menu:tasks" }
    ]);
  });

  it("shows star or unstar on individual task action buttons", () => {
    const unpinned = taskActionsKeyboard(task({ id: "task-uuid-1" }));
    const pinned = taskActionsKeyboard(task({ id: "task-uuid-1", pinnedAt: new Date("2026-07-05T00:01:00.000Z") }));

    expect(unpinned.inline_keyboard[1]?.[0]).toEqual({
      text: "⭐ Star",
      callback_data: "item:task:pin:task-uuid-1"
    });
    expect(unpinned.inline_keyboard[1]?.[1]).toEqual({
      text: "✏️ Title",
      callback_data: "item:task:edit:title:task-uuid-1"
    });
    expect(unpinned.inline_keyboard[1]?.[2]).toEqual({
      text: "📝 Details",
      callback_data: "item:task:edit:description:task-uuid-1"
    });
    expect(pinned.inline_keyboard[1]?.[0]).toEqual({
      text: "☆ Unstar",
      callback_data: "item:task:unpin:task-uuid-1"
    });
  });

  it("shows star and edit controls for individual notes and ideas", () => {
    const noteKeyboard = itemActionsKeyboard("note", { id: "note-uuid-1" });
    const ideaKeyboard = itemActionsKeyboard("idea", { id: "idea-uuid-1", pinnedAt: new Date("2026-07-05T00:01:00.000Z") });

    expect(noteKeyboard.inline_keyboard[0]?.[0]).toEqual({
      text: "⭐ Star",
      callback_data: "item:note:pin:note-uuid-1"
    });
    expect(noteKeyboard.inline_keyboard[0]?.[1]).toEqual({
      text: "✏️ Title",
      callback_data: "item:note:edit:title:note-uuid-1"
    });
    expect(noteKeyboard.inline_keyboard[0]?.[2]).toEqual({
      text: "📝 Body",
      callback_data: "item:note:edit:body:note-uuid-1"
    });
    expect(noteKeyboard.inline_keyboard[1]?.[0]).toEqual({
      text: "🗃 Archive",
      callback_data: "item:note:archive:note-uuid-1"
    });
    expect(ideaKeyboard.inline_keyboard[0]?.[0]).toEqual({
      text: "☆ Unstar",
      callback_data: "item:idea:unpin:idea-uuid-1"
    });
    expect(ideaKeyboard.inline_keyboard[1]).toEqual([
      { text: "✨ Idea brief", callback_data: "item:idea:brief:idea-uuid-1" },
      { text: "‹ Ideas", callback_data: "menu:ideas" }
    ]);
  });

  it("makes settings and AI idea briefs discoverable through compact button flows", () => {
    expect(settingsModeKeyboard().inline_keyboard.flat()).toContainEqual({ text: "⏰ Reminders", callback_data: "setting:reminders" });
    expect(settingsModeKeyboard().inline_keyboard.flat()).toContainEqual({ text: "🌍 Region & language", callback_data: "setting:region" });
    expect(reminderSettingsKeyboard().inline_keyboard.flat()).toContainEqual({ text: "🔁 Repeat interval", callback_data: "setting:pick:interval" });
    expect(regionSettingsKeyboard().inline_keyboard.flat()).toContainEqual({ text: "🌍 Timezone", callback_data: "setting:pick:timezone" });
    expect(settingChoicesKeyboard("interval").inline_keyboard.flat()).toContainEqual({ text: "3 hours", callback_data: "setting:apply:interval:180" });
    expect(ideasModeKeyboard().inline_keyboard.flat()).toContainEqual({ text: "✨ Idea brief", callback_data: "menu:ideas-brief" });
  });

  it("formats a useful AI idea brief instead of exposing a bare score dump", () => {
    const message = formatIdeaScore("IDEA-7", {
      buildability: 8,
      usefulness: 9,
      novelty: 6,
      portfolioValue: 8,
      monetization: 5,
      difficulty: 4,
      risk: 3,
      summary: "A focused idea with a clear first user.",
      marketNotes: "Validate willingness to switch from existing tools.",
      dos: ["Test one workflow"],
      donts: ["Build every integration first"]
    });

    expect(message).toContain("<b>✨ Idea brief</b> · <code>IDEA-7</code>");
    expect(message).toContain("<b>Strength</b>");
    expect(message).toContain("<b>Trade-offs</b>");
    expect(message).toContain("not live market research");
  });

  it("keeps note and idea lists compact until an item is opened", () => {
    const keyboard = itemListKeyboard("note", [{ id: "note-uuid-1", publicId: "NOTE-1", pinnedAt: null }]);

    expect(keyboard?.inline_keyboard[0]?.[0]).toEqual({
      text: "1",
      callback_data: "item:note:open:NOTE-1:1"
    });
  });

  it("falls back to a row UUID for already-generated item buttons", () => {
    const keyboard = itemListKeyboard("note", [{ id: "note-uuid-1", pinnedAt: null }]);

    expect(keyboard?.inline_keyboard[0]?.[0]).toEqual({
      text: "1",
      callback_data: "item:note:open:note-uuid-1:1"
    });
  });

  it("numbers notes and ideas globally across compact pages", () => {
    const page = { page: 2, totalPages: 2, offset: 5 };
    const noteMessage = formatRecentNotes([{ publicId: "NOTE-6", title: "Note six", summary: "Saved" }], page);
    const ideaMessage = formatRecentIdeas([{ publicId: "IDEA-6", title: "Idea six", concept: "Saved" }], page);
    const keyboard = itemListKeyboard("note", [{ id: "note-uuid-6", publicId: "NOTE-6" }], 5, { kind: "notes", numberOffset: 5, page: 2, totalPages: 2 });

    expect(noteMessage).toContain("6 · <b>Note six</b>");
    expect(ideaMessage).toContain("6 · <b>Idea six</b>");
    expect(keyboard?.inline_keyboard[0]?.[0]?.text).toBe("6");
    expect(keyboard?.inline_keyboard.at(-2)).toEqual([
      { text: "←", callback_data: "list:notes:1" },
      { text: "2/2", callback_data: "list:notes:2" }
    ]);
    expect(keyboard?.inline_keyboard.at(-1)).toEqual([
      { text: "‹ Notes", callback_data: "menu:notes" }
    ]);
  });

  it("keeps note details focused on the saved content", () => {
    const message = formatNoteDetail({
      publicId: "NOTE-9",
      title: "OMG",
      body: "OMG",
      summary: "OMG",
      tags: [],
      createdAt: new Date("2026-07-06T18:44:35.000Z")
    }, "Asia/Singapore");

    expect(message).toContain("<b>📝 Note</b>");
    expect(message).toContain("<b>OMG</b>");
    expect(message).not.toContain("Saved Date");
    expect(message).not.toContain("Note ID");
    expect(message).not.toContain("<b>Summary</b>");
    expect(message).not.toContain("<b>Tags</b>");
  });

  it("keeps idea details focused on the concept", () => {
    const message = formatIdeaDetail({
      publicId: "IDEA-1",
      title: "Inbox helper",
      concept: "Capture useful thoughts quickly.",
      tags: [],
      createdAt: new Date("2026-07-06T18:44:35.000Z")
    }, "Asia/Singapore");

    expect(message).toContain("<b>💡 Idea</b>");
    expect(message).toContain("Capture useful thoughts quickly.");
    expect(message).not.toContain("Saved Date");
    expect(message).not.toContain("Idea ID");
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
      text: "✅ Merge",
      callback_data: "merge:confirm:pending-merge-1"
    });
    expect(keyboard.inline_keyboard[0]?.[1]).toEqual({
      text: "↻ Try again",
      callback_data: "merge:retry:pending-merge-1"
    });
    expect(keyboard.inline_keyboard[1]?.[0]).toEqual({
      text: "✕ Cancel",
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

  it("shows natural-language capability help without pagination", () => {
    const message = formatHelpPage(1);

    expect(message).toContain("<b>❓ Threadwise help</b>");
    expect(message).toContain("<b>⏰ Reminders And Tasks</b>");
    expect(message).toContain("<code>/help reminders</code>");
    expect(message).toContain("<b>⚙️ Settings</b>");
    expect(message).toContain("<b>🖼️ Images And OCR</b>");
    expect(message).toContain("<b>💰 Expenses</b>");
    expect(message).toContain("<b>📊 Excel</b>");
    expect(message).toContain("<code>/commands</code>");
    expect(message).not.toContain("Page 1/");
    expect(message.length).toBeLessThan(4_096);
  });

  it("keeps slash commands discoverable in the command reference", () => {
    const message = formatCommandReference();

    expect(message.indexOf("<code>/add</code>")).toBeLessThan(message.indexOf("<code>/archived</code>"));
    expect(message.indexOf("<code>/archived</code>")).toBeLessThan(message.indexOf("<code>/brief</code>"));
    expect(message).toContain("<code>/commands</code> - Show the full slash-command reference.");
    expect(message.length).toBeLessThan(4_096);
  });

  it("formats focused help topics for natural questions", () => {
    const reminders = formatHelpTopic("reminders");
    const notes = formatHelpTopic("notes");
    const commands = formatHelpTopic("commands");

    expect(reminders).toContain("<b>Help: ⏰ Reminders And Tasks</b>");
    expect(reminders).toContain("<code>remind me to check the washer after 5 mins</code>");
    expect(reminders).not.toContain("<b>Help: 📝 Notes</b>");
    expect(notes).toContain("<b>Help: 📝 Notes</b>");
    expect(notes).toContain("<code>show note 3</code>");
    expect(commands).toContain("<b>Threadwise commands</b>");
  });

  it("includes important and version commands in help metadata", () => {
    expect(HELP_COMMANDS.map((item) => item.command)).toContain("/archive");
    expect(HELP_COMMANDS.map((item) => item.command)).toContain("/googlecal");
    expect(HELP_COMMANDS.map((item) => item.command)).toContain("/important");
    expect(HELP_COMMANDS.map((item) => item.command)).toContain("/expense");
    expect(HELP_COMMANDS.map((item) => item.command)).toContain("/expenses");
    expect(HELP_COMMANDS.map((item) => item.command)).toContain("/excel");
    expect(HELP_COMMANDS.map((item) => item.command)).toContain("/images");
    expect(HELP_COMMANDS.map((item) => item.command)).toContain("/image");
    expect(HELP_COMMANDS.map((item) => item.command)).toContain("/version");
  });

  it("provides concise start navigation and image-choice buttons", () => {
    expect(startMenuKeyboard().inline_keyboard.flat()).toContainEqual({ text: "📋 Tasks", callback_data: "menu:tasks" });
    expect(startMenuKeyboard().inline_keyboard.flat()).toContainEqual({ text: "🖼️ Images", callback_data: "menu:images" });
    expect(startMenuKeyboard().inline_keyboard.flat()).toContainEqual({
      text: "🌐 Dashboard",
      web_app: { url: "https://threadwise-dashboard.vercel.app" }
    });
    expect(incomingImageKeyboard("pending-1").inline_keyboard).toEqual([
      [
        { text: "🖼️ Save image", callback_data: "image-upload:save:pending-1" },
        { text: "✏️ Save with caption", callback_data: "image-upload:caption:pending-1" }
      ],
      [
        { text: "🔎 Extract text", callback_data: "image-upload:extract:pending-1" },
        { text: "✅ Save + extract", callback_data: "image-upload:save-extract:pending-1" }
      ],
      [
        { text: "🧾 Read as receipt", callback_data: "image-upload:expense:pending-1" },
        { text: "✕ Discard", callback_data: "image-upload:discard:pending-1" }
      ]
    ]);
  });

  it("provides a persistent private-chat menu beneath the composer", () => {
    const menu = privateMenuKeyboard();
    expect(menu.is_persistent).toBe(true);
    expect(menu.resize_keyboard).toBe(true);
    expect(menu.keyboard).toHaveLength(1);
    expect(menu.keyboard.flat()).toContainEqual({ text: "☰ Menu" });
    expect(menu.keyboard.flat()).toContainEqual({ text: "🌐 Dashboard" });
  });

  it("keeps the start shortcut confirmation compact", () => {
    const message = formatStartShortcutText();

    expect(message).toBe("☰ Menu and 🌐 Dashboard are pinned below.");
    expect(message).not.toContain("Welcome to Threadwise");
    expect(message.length).toBeLessThan(80);
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
    assignedTelegramId: overrides.assignedTelegramId ?? null,
    assignedUsername: overrides.assignedUsername ?? null,
    assignedDisplayName: overrides.assignedDisplayName ?? null,
    recurrenceRule: overrides.recurrenceRule ?? null,
    recurrenceIntervalDays: overrides.recurrenceIntervalDays ?? null,
    pinnedAt: overrides.pinnedAt ?? null,
    archivedAt: overrides.archivedAt ?? null,
    createdAt: overrides.createdAt ?? new Date("2026-07-05T00:00:00.000Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-07-05T00:00:00.000Z")
  };
}
