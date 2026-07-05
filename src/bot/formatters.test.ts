import { describe, expect, it } from "vitest";
import { TaskStatus } from "@prisma/client";
import { formatOpenTasks } from "./formatters";
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

    expect(message).toContain("1. Drink water");
    expect(message).toContain("ID: TASK-999");
    expect(message).toContain("Use /done 1");
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
