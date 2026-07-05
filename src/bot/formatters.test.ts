import { describe, expect, it } from "vitest";
import { TaskStatus } from "@prisma/client";
import { formatOpenTasks } from "./formatters";
import { taskListKeyboard } from "./keyboards";
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
    expect(keyboard?.inline_keyboard).toHaveLength(1);
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
    reminderCount: overrides.reminderCount ?? 0,
    createdAt: overrides.createdAt ?? new Date("2026-07-05T00:00:00.000Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-07-05T00:00:00.000Z")
  };
}
