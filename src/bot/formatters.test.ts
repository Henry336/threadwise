import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecurrenceRule, TaskStatus } from "@prisma/client";
import { formatIdeaScore, formatOpenTasks, formatTaskDetail } from "./formatters";
import { archivedPageKeyboard, ideasModeKeyboard, incomingImageKeyboard, itemListKeyboard, noteMergePreviewKeyboard, regionSettingsKeyboard, reminderSettingsKeyboard, restoreCompletedTaskKeyboard, searchPageKeyboard, settingChoicesKeyboard, settingsModeKeyboard, startMenuKeyboard, taskListKeyboard } from "./keyboards";
import { formatCommandReference, formatHelpPage, formatHelpTopic, formatStartShortcutText, HELP_COMMANDS } from "./help";
import { formatTaskAlreadyCompleted, formatTaskCompleted, formatTaskCreated, formatTaskSavedAcknowledgement } from "../services/tasks";
import { formatNoteDetail, formatNoteSavedAcknowledgement } from "../services/notes";
import { formatIdeaDetail, formatIdeaSavedAcknowledgement } from "../services/ideas";
import { formatArchivedPage } from "../services/archives";
import { task } from "../test/builders";

// Copy is pinned with one inline snapshot per card type, so a wording change is one
// reviewable diff. The explicit assertions guard behaviour: escaping, timezones,
// ordering, Telegram's 4,096-character limit and callback data.
describe("bot formatter cards", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-05T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("open task list", () => {
    const message = formatOpenTasks(
      [
        task({ publicId: "TASK-999", title: "Drink water", dueAt: new Date("2026-07-06T01:29:00.000Z") }),
        task({ publicId: "TASK-1", title: "Overdue task", dueAt: new Date("2020-01-01T00:00:00.000Z") }),
        task({ publicId: "TASK-2", title: "No-date task", dueAt: null }),
        task({ publicId: "TASK-3", title: "Important task", pinnedAt: new Date("2026-07-05T00:01:00.000Z") })
      ],
      "Asia/Singapore"
    );

    expect(message).not.toContain("TASK-999");
    expect(message).toMatchInlineSnapshot(`
      "<b>📋 Tasks</b>



      1 · <b>Drink water</b>
      Tomorrow · 9:29 AM

      2 ⚠️ <b>Overdue task</b>
      Overdue · 1 Jan, 8:00 AM

      3 · <b>No-date task</b>
      No due date

      4 ⭐ <b>Important task</b>
      No due date



      <i>Tap a number to open it.</i>"
    `);
  });

  it("task detail", () => {
    expect(formatTaskDetail(task({ title: "Reply to bank", pinnedAt: new Date("2026-07-05T00:01:00.000Z") }))).toMatchInlineSnapshot(`
      "<b>📋 Task</b>

      <b>Reply to bank</b>

      ○ No due date
      ⭐ Important"
    `);
  });

  it("task created", () => {
    expect(formatTaskCreated({
      publicId: "TASK-9",
      title: "Prepare a gift",
      dueAt: new Date("2026-07-06T18:44:35.000Z"),
      timezone: "Asia/Singapore",
      assignedUsername: "henry_derek",
      recurrenceRule: RecurrenceRule.DAILY
    }, "Asia/Singapore")).toMatchInlineSnapshot(`
      "<b>✅ Task saved</b>

      Prepare a gift

      <b>Due Date:</b> Jul 7, 2026, 2:44 AM GMT+8
      <b>Assigned To:</b> @henry_derek
      <b>Repeats:</b> Daily

      I'll keep watch and bring this back at the right time.

      Want private deadline nudges too? Each assignee can open Threadwise privately and send /settings dm on."
    `);
  });

  it("recurring task completed", () => {
    expect(formatTaskCompleted(task({
      title: "Have dinner",
      recurrenceRule: RecurrenceRule.DAILY,
      recurrenceIntervalDays: 1,
      dueAt: new Date("2026-07-06T11:00:00.000Z")
    }), "Asia/Singapore")).toMatchInlineSnapshot(`
      "<b>✅ This occurrence is done</b> Have dinner

      <b>Next Occurrence:</b> Jul 6, 2026, 7:00 PM GMT+8
      <b>Repeats:</b> Daily"
    `);
  });

  it("saved acknowledgements", () => {
    expect([
      formatTaskSavedAcknowledgement({
        title: "Prepare a gift",
        dueAt: new Date("2026-07-06T18:44:35.000Z"),
        timezone: "Asia/Singapore",
        assignedUsername: "henry_derek",
        recurrenceRule: RecurrenceRule.DAILY
      }, "Asia/Singapore"),
      formatNoteSavedAcknowledgement({ title: "Launch notes" }),
      formatIdeaSavedAcknowledgement({ title: "Quiet capture" })
    ]).toMatchInlineSnapshot(`
      [
        "<b>Saved</b> · Prepare a gift

      <b>When:</b> Jul 7, 2026, 2:44 AM GMT+8
      <b>Repeats:</b> Daily
      <b>For:</b> @henry_derek",
        "<b>Note saved</b> · Launch notes",
        "<b>Idea saved</b> · Quiet capture",
      ]
    `);
  });

  it("already completed task", () => {
    const completed = task({ status: TaskStatus.DONE, title: "Submit report" });

    expect(formatTaskAlreadyCompleted(completed)).toMatchInlineSnapshot(`
      "<b>Already complete</b> Submit report
      Need it back on your list? You can restore it below."
    `);
    expect(restoreCompletedTaskKeyboard(completed.id).inline_keyboard[0]?.[0]).toMatchObject({
      callback_data: `task:restore:${completed.id}`
    });
  });

  it("idea brief", () => {
    expect(formatIdeaScore("IDEA-7", {
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
    })).toMatchInlineSnapshot(`
      "<b>✨ Idea brief</b> · <code>IDEA-7</code>

      A focused idea with a clear first user.

      <b>Strength</b> usefulness 9/10 · buildability 8/10 · novelty 6/10
      <b>Potential</b> portfolio 8/10 · monetization 5/10
      <b>Trade-offs</b> difficulty 4/10 · risk 3/10

      <b>Market read</b>
      Validate willingness to switch from existing tools.

      <b>Do next</b> Test one workflow
      <b>Avoid</b> Build every integration first

      AI assessment from the saved idea—not live market research."
    `);
  });

  it("note detail", () => {
    expect(formatNoteDetail({
      publicId: "NOTE-9",
      title: "OMG",
      body: "OMG",
      summary: "OMG",
      tags: [],
      createdAt: new Date("2026-07-06T18:44:35.000Z")
    }, "Asia/Singapore")).toMatchInlineSnapshot(`
      "<b>📝 Note</b>

      <b>OMG</b>

      OMG"
    `);
  });

  it("idea detail", () => {
    expect(formatIdeaDetail({
      publicId: "IDEA-1",
      title: "Inbox helper",
      concept: "Capture useful thoughts quickly.",
      tags: [],
      createdAt: new Date("2026-07-06T18:44:35.000Z")
    }, "Asia/Singapore")).toMatchInlineSnapshot(`
      "<b>💡 Idea</b>

      <b>Inbox helper</b>

      Capture useful thoughts quickly."
    `);
  });

  it("help topic", () => {
    expect(formatHelpTopic("reminders")).toMatchInlineSnapshot(`
      "<b>Help: ⏰ Reminders And Tasks</b>
      Add tasks to Today, then view, move, finish, snooze, cancel, or remind yourself about them.

      <b>Try saying</b>
      <code>add pay invoice tomorrow at 9am</code>
      <code>remind me to check the washer after 5 mins</code>
      <code>could you remind me to call Mum day after tomorrow at noon?</code>
      <code>remind me to have dinner at 7pm every day</code>
      <code>remind me to take out the trash every Friday at 7pm</code>
      <code>remind me to pay rent on the 1st of every month at 9am</code>
      <code>remind me of Mum's birthday on 26 July every year</code>
      <code>remind Dad and @alex to check the bot at 10pm</code>
      <code>assign task 2 to @alex and @sam</code>
      <code>remove @alex from task 2</code>
      <code>send me assigned task reminders in private</code>
      <code>show task 2</code>
      <code>complete task 1</code>
      <code>complete tasks 1, 2 and 3</code>
      <code>mark task 1 as done</code>
      <code>snooze task 1 for 1 hour</code>
      <code>move task 2 to Friday</code>
      <code>mark task 2 important</code>
      <code>remove important from task 2</code>
      <code>connect my Google Calendar</code>
      <code>add task 2 to my calendar</code>
      <code>cancel task 3</code>

      <b>Slash equivalents</b>
      <code>/todo buy groceries, prepare tutorial</code>
      <code>/today</code>
      <code>/add pay invoice tomorrow at 9am</code>
      <code>/remind 7pm every day | have dinner</code>
      <code>/remind every Friday at 7pm | take out the trash</code>
      <code>/assign 2 @alex and @sam</code>
      <code>/unassign 2 @alex</code>
      <code>/settings dm on</code>
      <code>/task 2</code>
      <code>/done 1 2 3</code>
      <code>/snooze 1 1h</code>
      <code>/reschedule 2 Friday</code>
      <code>/important 2</code>
      <code>/calendar</code>
      <code>/cancel 1 2 3</code>

      More help: <code>/help</code> or <code>/commands</code>."
    `);
  });

  it("start shortcut confirmation", () => {
    expect(formatStartShortcutText()).toMatchInlineSnapshot(`"Menu and Dashboard stay within reach below."`);
  });
});

describe("bot formatter behaviour", () => {
  it("lists starred tasks before regular tasks", () => {
    const message = formatOpenTasks(
      [
        task({ publicId: "TASK-2", title: "Important task", pinnedAt: new Date("2026-07-05T00:01:00.000Z") }),
        task({ publicId: "TASK-1", title: "Regular task" })
      ],
      "Asia/Singapore"
    );

    expect(message.indexOf("Important task")).toBeLessThan(message.indexOf("Regular task"));
  });

  it("removes a repeated title from task details", () => {
    const message = formatTaskDetail(task({
      title: "Plan the launch",
      description: "Plan the launch — confirm the venue and invite the team."
    }));

    expect(message).toContain("confirm the venue and invite the team.");
    expect(message).not.toContain("Plan the launch — confirm");
  });

  it("uses the preserved capture when a reminder has no separate description", () => {
    const message = formatTaskDetail(task({
      title: "Start drafting plans for my parents' visit...",
      description: null,
      sourceText: "Start drafting plans for my parents' visit, including precautions, hidden gifts, and gallery changes."
    }));

    expect(message).toContain("including precautions, hidden gifts, and gallery changes.");
  });

  it("escapes user task text in HTML output", () => {
    const message = formatOpenTasks([task({ title: "Read <draft> & reply", dueAt: null })], "Asia/Singapore");

    expect(message).toContain("Read &lt;draft&gt; &amp; reply");
    expect(message).not.toContain("Read <draft> & reply");
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

    expect(message).toContain("2:44");
    expect(message).not.toContain("6:44");
  });

  it("keeps the help page within Telegram's message limit and hides frozen surfaces", () => {
    const message = formatHelpPage(1);

    expect(message).not.toContain("Expenses");
    expect(message).not.toContain("Excel");
    expect(message).not.toContain("Page 1/");
    expect(message.length).toBeLessThan(4_096);
  });

  it("orders the command reference within Telegram's message limit", () => {
    const message = formatCommandReference();

    expect(message.indexOf("<code>/add</code>")).toBeLessThan(message.indexOf("<code>/archived</code>"));
    expect(message.indexOf("<code>/archived</code>")).toBeLessThan(message.indexOf("<code>/brief</code>"));
    expect(message).toContain("<code>/commands</code>");
    expect(message.length).toBeLessThan(4_096);
  });

  it("routes focused help topics to their own section", () => {
    expect(formatHelpTopic("reminders")).not.toBe(formatHelpTopic("notes"));
    expect(formatHelpTopic("commands")).toBe(formatCommandReference());
  });

  it("includes important and version commands in help metadata", () => {
    const commands = HELP_COMMANDS.map((item) => item.command);

    expect(commands).toEqual(expect.arrayContaining(["/archive", "/googlecal", "/important", "/findtime", "/images", "/image", "/version"]));
    expect(commands).not.toContain("/expense");
    expect(commands).not.toContain("/expenses");
    expect(commands).not.toContain("/excel");
  });
});

describe("bot formatter keyboards", () => {
  it("fits three list choices into one mobile-friendly button row", () => {
    const keyboard = taskListKeyboard([
      task({ id: "task-1" }), task({ id: "task-2" }), task({ id: "task-3" })
    ], 3, undefined, true);

    expect(keyboard?.inline_keyboard[0]?.map((button) => button.text)).toEqual(["1", "2", "3"]);
    expect(keyboard?.inline_keyboard).toHaveLength(2);
  });

  it("makes settings and AI idea briefs discoverable through compact button flows", () => {
    expect(settingsModeKeyboard().inline_keyboard.flat()).toContainEqual({ text: "⏰ Reminders", callback_data: "setting:reminders" });
    expect(settingsModeKeyboard().inline_keyboard.flat()).toContainEqual({ text: "🌍 Region & language", callback_data: "setting:region" });
    expect(reminderSettingsKeyboard().inline_keyboard.flat()).toContainEqual({ text: "🔁 Repeat interval", callback_data: "setting:pick:interval" });
    expect(regionSettingsKeyboard().inline_keyboard.flat()).toContainEqual({ text: "🌍 Timezone", callback_data: "setting:pick:timezone" });
    expect(settingChoicesKeyboard("interval").inline_keyboard.flat()).toContainEqual({ text: "3 hours", callback_data: "setting:apply:interval:180" });
    expect(ideasModeKeyboard().inline_keyboard.flat()).toContainEqual({ text: "✨ Idea brief", callback_data: "menu:ideas-brief" });
  });

  it("opens list items by public id", () => {
    const keyboard = itemListKeyboard("note", [{ id: "note-uuid-1", publicId: "NOTE-1", pinnedAt: null }], 3, undefined, true);

    expect(keyboard?.inline_keyboard[0]?.[0]).toEqual({ text: "1", callback_data: "item:note:open:NOTE-1:1" });
  });

  it("falls back to a row UUID for already-generated item buttons", () => {
    const keyboard = itemListKeyboard("note", [{ id: "note-uuid-1", pinnedAt: null }], 3, undefined, true);

    expect(keyboard?.inline_keyboard[0]?.[0]).toEqual({ text: "1", callback_data: "item:note:open:note-uuid-1:1" });
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
      [{ text: "✕ Discard", callback_data: "image-upload:discard:pending-1" }]
    ]);
    expect(startMenuKeyboard().inline_keyboard.flat()).not.toContainEqual({ text: "💰 Expenses", callback_data: "menu:expenses" });
    expect(regionSettingsKeyboard().inline_keyboard.flat().some((button) => button.text.includes("Currency"))).toBe(false);
    expect(settingsModeKeyboard().inline_keyboard.flat()).toContainEqual({ text: "📅 Google Calendar", callback_data: "menu:calendar-settings" });
  });
});
