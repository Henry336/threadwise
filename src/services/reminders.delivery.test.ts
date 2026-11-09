import type { Bot } from "grammy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Characterization tests for the four reminder delivery paths in `runReminderPass`:
// explicit custom times, single (interval or due-nudge) reminders, private digests,
// and undated group follow-ups. They run the real pass against an in-memory database
// and a fake Telegram API, and assert on the resulting rows and messages.

const db = vi.hoisted(() => {
  type Row = Record<string, any>;
  const state = { tasks: [] as Row[], deliveries: [] as Row[], schedules: [] as Row[], users: [] as Row[] };
  let nextId = 1;
  const isObject = (value: unknown): value is Row =>
    value !== null && typeof value === "object" && !(value instanceof Date) && !Array.isArray(value);
  const same = (left: unknown, right: unknown) =>
    left instanceof Date || right instanceof Date ? left != null && right != null && +left === +(right as Date) : left === right;
  const operators = ["in", "notIn", "lt", "lte", "gt", "gte", "not", "equals"];

  /** Evaluates the small subset of Prisma `where` syntax the reminder code uses. */
  function matches(row: Row | undefined, where: Row = {}): boolean {
    return Object.entries(where).every(([key, condition]) => {
      if (key === "OR") return (condition as Row[]).some((branch) => matches(row, branch));
      const value = row?.[key];
      if (condition === null) return value == null;
      if (!isObject(condition)) return same(value, condition);
      if (!Object.keys(condition).some((name) => operators.includes(name))) return matches(value, condition);
      if ("in" in condition && !condition.in.some((item: unknown) => same(value, item))) return false;
      if ("lt" in condition && !(value != null && value < condition.lt)) return false;
      if ("lte" in condition && !(value != null && value <= condition.lte)) return false;
      if ("gt" in condition && !(value != null && value > condition.gt)) return false;
      if ("gte" in condition && !(value != null && value >= condition.gte)) return false;
      if ("not" in condition && (condition.not === null ? value == null : same(value, condition.not))) return false;
      if ("equals" in condition && String(value).toLowerCase() !== String(condition.equals).toLowerCase()) return false;
      return true;
    });
  }

  /** Applies a Prisma `data` payload, including `{ increment }`. */
  function apply(row: Row, data: Row): Row {
    for (const [key, value] of Object.entries(data)) {
      row[key] = isObject(value) && "increment" in value ? (row[key] ?? 0) + value.increment : value;
    }
    return row;
  }

  const prisma = {
    task: {
      findMany: async ({ where, take }: Row) => state.tasks
        .filter((task) => matches(task, where))
        .sort((left, right) => +left.nextReminderAt - +right.nextReminderAt)
        .slice(0, take),
      update: async ({ where, data }: Row) => apply(state.tasks.find((task) => task.id === where.id)!, data),
      updateMany: async ({ where, data }: Row) => {
        const rows = state.tasks.filter((task) => matches(task, where));
        rows.forEach((row) => apply(row, data));
        return { count: rows.length };
      },
    },
    reminderDelivery: {
      findFirst: async ({ where }: Row) => [...state.deliveries]
        .sort((left, right) => +right.sentAt - +left.sentAt)
        .find((delivery) => matches(delivery, where)) ?? null,
      findUnique: async ({ where }: Row) => state.deliveries.find((delivery) => delivery.deliveryKey === where.deliveryKey) ?? null,
      findMany: async ({ where }: Row) => state.deliveries.filter((delivery) => matches(delivery, where)),
      create: async ({ data }: Row) => {
        const row = { id: `delivery-${nextId++}`, sentAt: new Date(), messageId: null, deliveryKey: null, ...data };
        state.deliveries.push(row);
        return row;
      },
    },
    taskReminderSchedule: {
      findMany: async ({ where, take }: Row) => state.schedules
        .filter((schedule) => matches(schedule, where))
        .sort((left, right) => +left.scheduledAt - +right.scheduledAt)
        .slice(0, take)
        .map((schedule) => ({ ...schedule })),
      update: async ({ where, data }: Row) => apply(state.schedules.find((schedule) => schedule.id === where.id)!, data),
      updateMany: async ({ where, data }: Row) => {
        const rows = state.schedules.filter((schedule) => matches(schedule, where));
        rows.forEach((row) => apply(row, data));
        return { count: rows.length };
      },
    },
    user: {
      findUnique: async ({ where }: Row) => state.users.find((user) => user.telegramId === where.telegramId) ?? null,
      findMany: async ({ where }: Row) => state.users.filter((user) => matches(user, where)),
    },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  };

  return {
    state,
    prisma,
    reset() {
      state.tasks = [];
      state.deliveries = [];
      state.schedules = [];
      state.users = [];
      nextId = 1;
    },
  };
});

const study = vi.hoisted(() => ({
  runStudyReminderPass: vi.fn(async () => ({ sent: 0, failed: 0, unsafeChat: false })),
  runPendingStudyCalendarSyncs: vi.fn(async () => 0),
}));

vi.mock("../db/prisma", () => ({ prisma: db.prisma }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("./studyReminders", () => ({ runStudyReminderPass: study.runStudyReminderPass }));
vi.mock("./studyCalendar", () => ({ runPendingStudyCalendarSyncs: study.runPendingStudyCalendarSyncs }));

import { reminderActionsKeyboard } from "../bot/keyboards";
import { formatGroupUndatedReminderDigest, formatReminderDigest, formatReminderMessage, getReminderDiagnostics, runReminderPass, runStudyReminderLoopPass } from "./reminders";

const DAY = new Date("2026-11-09T04:00:00.000Z"); // 12:00 in Singapore
const NIGHT = new Date("2026-11-09T15:00:00.000Z"); // 23:00 in Singapore, inside 22:00-08:00
const QUIET_END = new Date("2026-11-10T00:00:00.000Z"); // 08:00 the next morning in Singapore
const minutes = (base: Date, amount: number) => new Date(base.getTime() + amount * 60_000);

// Never reset: failed-send counts are module state keyed by task id, so ids stay unique per test.
let taskNumber = 0;

function settings(overrides: Record<string, unknown> = {}) {
  return {
    timezone: "Asia/Singapore",
    quietHoursStart: "22:00",
    quietHoursEnd: "08:00",
    maxRemindersPerDay: 200,
    reminderIntervalMinutes: 180,
    dueNudgeMinutes: 3,
    reminderMode: "INDIVIDUAL" as "INDIVIDUAL" | "DIGEST",
    reminderChatId: null,
    directNudgesEnabled: false,
    ...overrides,
  };
}

function user(telegramId: string, settingsOverrides: Record<string, unknown> | null = {}) {
  return {
    id: `user-${telegramId}`,
    telegramId,
    firstName: telegramId.startsWith("chat:") ? "Project group" : "Henry",
    settings: settingsOverrides === null ? null : settings(settingsOverrides),
  };
}

function addTask(owner: ReturnType<typeof user>, overrides: Record<string, unknown> = {}) {
  taskNumber += 1;
  const task = {
    id: `task-${taskNumber}`,
    userId: owner.id,
    publicId: `TASK-${taskNumber}`,
    title: `Task ${taskNumber}`,
    status: "OPEN",
    audience: "UNASSIGNED" as const,
    dueAt: null,
    timezone: null,
    nextReminderAt: minutes(new Date(), -1),
    snoozedUntil: null,
    archivedAt: null,
    remindersDismissedAt: null,
    lastRemindedAt: null,
    reminderCount: 0,
    automaticReminderCount: 0,
    automaticReminderBudget: 7,
    undatedNudgeCount: 0,
    reminderIntervalMinutes: null,
    pinnedAt: null,
    recurrenceRule: null,
    assignedTelegramId: null,
    assignedUsername: null,
    assignedDisplayName: null,
    assignees: [],
    user: owner,
    ...overrides,
  };
  db.state.tasks.push(task);
  return task;
}

function addSchedule(task: ReturnType<typeof addTask>, overrides: Record<string, unknown> = {}) {
  const schedule = {
    id: `schedule-${task.id}`,
    userId: task.userId,
    taskId: task.id,
    scheduledAt: minutes(new Date(), -1),
    status: "PENDING",
    leaseExpiresAt: null,
    deliveredAt: null,
    taskStateCanceled: false,
    attemptCount: 0,
    lastError: null,
    task,
    ...overrides,
  };
  db.state.schedules.push(schedule);
  return schedule;
}

function addDelivery(row: Record<string, unknown>) {
  db.state.deliveries.push({ id: `seed-${db.state.deliveries.length}`, sentAt: minutes(new Date(), -30), messageId: null, deliveryKey: null, ...row });
}

function fakeBot() {
  let messageId = 100;
  const sendMessage = vi.fn(async (chatId: string, text: string, _options?: Record<string, unknown>) =>
    ({ message_id: messageId++, chat: { id: Number(chatId) }, date: 0, text }));
  const deleteMessage = vi.fn(async (_chatId: string, _messageId: number) => true);
  return { bot: { api: { sendMessage, deleteMessage } } as unknown as Bot, sendMessage, deleteMessage };
}

function callbacks(options: Record<string, any> | undefined): string[] {
  return options?.reply_markup?.inline_keyboard.flat().map((button: { callback_data?: string; url?: string }) => button.callback_data ?? button.url);
}

function at(time: Date) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(time);
}

beforeEach(() => {
  db.reset();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("custom reminder times", () => {
  it("delivers an explicit time even inside quiet hours and records it once by delivery key", async () => {
    at(NIGHT);
    const owner = user("777");
    const task = addTask(owner, { nextReminderAt: null });
    const schedule = addSchedule(task);
    addDelivery({ userId: owner.id, taskId: task.id, chatId: "777", messageId: "42" });
    const { bot, sendMessage, deleteMessage } = fakeBot();

    const run = await runReminderPass(bot, "manual");

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, options] = sendMessage.mock.calls[0]!;
    expect(chatId).toBe("777");
    expect(text).toBe(formatReminderMessage(task, owner.settings!));
    expect(callbacks(options)).toEqual(callbacks({ reply_markup: reminderActionsKeyboard(task) }));
    expect(db.state.deliveries.at(-1)).toMatchObject({ taskId: task.id, chatId: "777", messageId: "100", deliveryKey: `task-custom:${schedule.id}`, sentAt: NIGHT });
    expect(schedule).toMatchObject({ status: "SENT", deliveredAt: NIGHT, leaseExpiresAt: null, lastError: null, attemptCount: 1 });
    expect(task).toMatchObject({ lastRemindedAt: NIGHT, reminderCount: 1, automaticReminderCount: 0, nextReminderAt: minutes(NIGHT, 180) });
    expect(deleteMessage).toHaveBeenCalledWith("777", 42);
    expect(run).toMatchObject({ customRemindersDue: 1, customRemindersSent: 1, remindersSent: 1, failedDeliveries: 0 });
  });

  it("settles an already-delivered schedule without sending it again", async () => {
    at(DAY);
    const owner = user("777");
    const task = addTask(owner, { nextReminderAt: null });
    const schedule = addSchedule(task);
    const sentAt = minutes(DAY, -5);
    addDelivery({ userId: owner.id, taskId: task.id, chatId: "777", messageId: "9", deliveryKey: `task-custom:${schedule.id}`, sentAt });
    const { bot, sendMessage } = fakeBot();

    const run = await runReminderPass(bot, "manual");

    expect(sendMessage).not.toHaveBeenCalled();
    expect(schedule).toMatchObject({ status: "SENT", deliveredAt: sentAt, leaseExpiresAt: null });
    expect(run.remindersSent).toBe(0);
  });

  it("falls back to text when Telegram rejects the reminder buttons", async () => {
    at(DAY);
    const owner = user("777");
    const task = addTask(owner, { nextReminderAt: null });
    const schedule = addSchedule(task);
    const { bot, sendMessage } = fakeBot();
    sendMessage.mockRejectedValueOnce(new Error("400: Bad Request: BUTTON_TYPE_INVALID"));

    const run = await runReminderPass(bot, "manual");

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[1]![2]).toEqual({ parse_mode: "HTML" });
    expect(schedule.status).toBe("SENT");
    expect(run).toMatchObject({ customRemindersSent: 1, failedDeliveries: 0 });
  });

  it("holds a schedule whose owner has no settings", async () => {
    at(DAY);
    const owner = user("777", null);
    const schedule = addSchedule(addTask(owner, { nextReminderAt: null }));
    const { bot, sendMessage } = fakeBot();

    const run = await runReminderPass(bot, "manual");

    expect(sendMessage).not.toHaveBeenCalled();
    expect(schedule).toMatchObject({ status: "PROCESSING", lastError: "Reminder settings are missing." });
    expect(run.skippedMissingSettings).toBe(1);
  });
});

describe("single reminders", () => {
  it("sends an interval reminder, advances the cycle and replaces the previous message", async () => {
    at(DAY);
    const owner = user("777");
    const task = addTask(owner);
    addDelivery({ userId: owner.id, taskId: task.id, chatId: "777", messageId: "42" });
    const { bot, sendMessage, deleteMessage } = fakeBot();

    const run = await runReminderPass(bot, "manual");

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, options] = sendMessage.mock.calls[0]!;
    expect(chatId).toBe("777");
    expect(text).toBe(formatReminderMessage(task, owner.settings!));
    expect(callbacks(options)).toEqual(callbacks({ reply_markup: reminderActionsKeyboard(task) }));
    expect(db.state.deliveries.at(-1)).toMatchObject({ taskId: task.id, chatId: "777", messageId: "100", deliveryKey: null });
    expect(task).toMatchObject({
      lastRemindedAt: DAY,
      reminderCount: 1,
      automaticReminderCount: 1,
      reminderIntervalMinutes: 180,
      nextReminderAt: minutes(DAY, 180),
    });
    expect(deleteMessage).toHaveBeenCalledWith("777", 42);
    expect(run).toMatchObject({ dueTasksFound: 1, remindersSent: 1 });
  });

  it("defers an interval reminder to the end of quiet hours", async () => {
    at(NIGHT);
    const task = addTask(user("777"));
    const { bot, sendMessage } = fakeBot();

    const run = await runReminderPass(bot, "manual");

    expect(sendMessage).not.toHaveBeenCalled();
    expect(task.nextReminderAt).toEqual(QUIET_END);
    expect(run.deferredForQuietHours).toBe(1);
  });

  it("lets a due nudge through quiet hours", async () => {
    at(NIGHT);
    const task = addTask(user("777"), { dueAt: minutes(NIGHT, 2) });
    const { bot, sendMessage } = fakeBot();

    const run = await runReminderPass(bot, "manual");

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(task.nextReminderAt).toEqual(minutes(NIGHT, 2));
    expect(run).toMatchObject({ remindersSent: 1, deferredForQuietHours: 0 });
  });

  it("waits one interval when the daily cap is reached", async () => {
    at(DAY);
    const owner = user("777", { maxRemindersPerDay: 1 });
    const task = addTask(owner);
    addDelivery({ userId: owner.id, taskId: "other", chatId: "777", messageId: "1" });
    const { bot, sendMessage } = fakeBot();

    const run = await runReminderPass(bot, "manual");

    expect(sendMessage).not.toHaveBeenCalled();
    expect(task.nextReminderAt).toEqual(minutes(DAY, 180));
    expect(run.cappedByDailyLimit).toBe(1);
  });

  it("falls back to text when Telegram rejects the reminder buttons", async () => {
    at(DAY);
    const task = addTask(user("777"));
    const { bot, sendMessage } = fakeBot();
    sendMessage.mockRejectedValueOnce(new Error("400: Bad Request: BUTTON_TYPE_INVALID"));

    const run = await runReminderPass(bot, "manual");

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[1]![2]).toEqual({ parse_mode: "HTML" });
    expect(task.reminderCount).toBe(1);
    expect(run).toMatchObject({ remindersSent: 1, failedDeliveries: 0 });
  });

  it("skips a task whose owner has no settings without touching it", async () => {
    at(DAY);
    const task = addTask(user("777", null));
    const before = task.nextReminderAt;
    const { bot, sendMessage } = fakeBot();

    const run = await runReminderPass(bot, "manual");

    expect(sendMessage).not.toHaveBeenCalled();
    expect(task.nextReminderAt).toEqual(before);
    expect(run.skippedMissingSettings).toBe(1);
  });

  it("sends a private nudge to an opted-in assignee of a group task", async () => {
    at(DAY);
    const group = user("chat:-1002", { reminderChatId: "-1002" });
    db.state.users.push({ id: "user-42", telegramId: "42", settings: settings({ directNudgesEnabled: true }) });
    addTask(group, { dueAt: minutes(DAY, 2 * 24 * 60), assignees: [{ telegramId: "42", username: null, displayName: "Ana" }] });
    const { bot, sendMessage } = fakeBot();

    const run = await runReminderPass(bot, "manual");

    expect(sendMessage.mock.calls.map(([chatId]) => chatId)).toEqual(["-1002", "42"]);
    expect(run).toMatchObject({ remindersSent: 1, directNudgesSent: 1 });
  });

  it("replaces the previous group reminder even when no reminder chat is configured", async () => {
    at(DAY);
    const group = user("chat:-1003");
    const task = addTask(group, { dueAt: minutes(DAY, 2 * 24 * 60) });
    addDelivery({ userId: group.id, taskId: task.id, chatId: "-1003", messageId: "7" });
    const { bot, sendMessage, deleteMessage } = fakeBot();

    await runReminderPass(bot, "manual");

    expect(sendMessage.mock.calls[0]![0]).toBe("-1003");
    expect(deleteMessage).toHaveBeenCalledWith("-1003", 7);
  });
});

describe("private reminder digests", () => {
  const digestOwner = () => user("777", { reminderMode: "DIGEST" });

  it("combines two due tasks into one message recorded against both", async () => {
    at(DAY);
    const owner = digestOwner();
    const dueAt = minutes(DAY, 2 * 24 * 60);
    const tasks = [addTask(owner, { dueAt }), addTask(owner, { dueAt })];
    const { bot, sendMessage } = fakeBot();

    const run = await runReminderPass(bot, "manual");

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, options] = sendMessage.mock.calls[0]!;
    expect(chatId).toBe("777");
    expect(text).toBe(formatReminderDigest(tasks, "Asia/Singapore"));
    expect(callbacks(options)).toEqual(tasks.map((task) => `task:view-full:${task.id}`));
    expect(db.state.deliveries.map((delivery) => [delivery.taskId, delivery.messageId])).toEqual(tasks.map((task) => [task.id, "100"]));
    for (const task of tasks) {
      expect(task).toMatchObject({
        lastRemindedAt: DAY,
        reminderCount: 1,
        automaticReminderCount: 1,
        reminderIntervalMinutes: 180,
        nextReminderAt: minutes(DAY, 24 * 60),
      });
    }
    expect(run.remindersSent).toBe(1);
  });

  it("defers the whole digest during quiet hours and counts it once", async () => {
    at(NIGHT);
    const owner = digestOwner();
    const dueAt = minutes(NIGHT, 2 * 24 * 60);
    const tasks = [addTask(owner, { dueAt }), addTask(owner, { dueAt })];
    const { bot, sendMessage } = fakeBot();

    const run = await runReminderPass(bot, "manual");

    expect(sendMessage).not.toHaveBeenCalled();
    expect(tasks.map((task) => task.nextReminderAt)).toEqual([QUIET_END, QUIET_END]);
    expect(run.deferredForQuietHours).toBe(1);
  });

  it("waits an hour when the daily cap is reached", async () => {
    at(DAY);
    const owner = user("777", { reminderMode: "DIGEST", maxRemindersPerDay: 1 });
    addDelivery({ userId: owner.id, taskId: "other", chatId: "777", messageId: "1" });
    const dueAt = minutes(DAY, 2 * 24 * 60);
    const tasks = [addTask(owner, { dueAt }), addTask(owner, { dueAt })];
    const { bot, sendMessage } = fakeBot();

    const run = await runReminderPass(bot, "manual");

    expect(sendMessage).not.toHaveBeenCalled();
    expect(tasks.map((task) => task.nextReminderAt)).toEqual([minutes(DAY, 60), minutes(DAY, 60)]);
    expect(run.cappedByDailyLimit).toBe(1);
  });
});

describe("undated group follow-ups", () => {
  it("sends one follow-up for the group's undated tasks and removes the old one", async () => {
    at(DAY);
    const group = user("chat:-1001");
    const tasks = [addTask(group), addTask(group)];
    for (const task of tasks) addDelivery({ userId: group.id, taskId: task.id, chatId: "-1001", messageId: "50" });
    const { bot, sendMessage, deleteMessage } = fakeBot();

    const run = await runReminderPass(bot, "manual");

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, options] = sendMessage.mock.calls[0]!;
    expect(chatId).toBe("-1001");
    expect(text).toBe(formatGroupUndatedReminderDigest(tasks));
    expect(callbacks(options)).toEqual(tasks.map((task) => `task:view-full:${task.id}`));
    for (const task of tasks) {
      expect(task).toMatchObject({
        lastRemindedAt: DAY,
        reminderCount: 1,
        automaticReminderCount: 1,
        undatedNudgeCount: 1,
        reminderIntervalMinutes: 180,
        nextReminderAt: minutes(DAY, 180),
      });
    }
    expect(deleteMessage).toHaveBeenCalledTimes(1);
    expect(deleteMessage).toHaveBeenCalledWith("-1001", 50);
    expect(run.remindersSent).toBe(1);
  });

  it("defers every task during quiet hours and counts each one", async () => {
    at(NIGHT);
    const group = user("chat:-1001");
    const tasks = [addTask(group), addTask(group)];
    const { bot, sendMessage } = fakeBot();

    const run = await runReminderPass(bot, "manual");

    expect(sendMessage).not.toHaveBeenCalled();
    expect(tasks.map((task) => task.nextReminderAt)).toEqual([QUIET_END, QUIET_END]);
    expect(run.deferredForQuietHours).toBe(2);
  });

  it("slows each capped task by its own follow-up count", async () => {
    at(DAY);
    const group = user("chat:-1001", { maxRemindersPerDay: 1 });
    addDelivery({ userId: group.id, taskId: "other", chatId: "-1001", messageId: "1" });
    const tasks = [addTask(group), addTask(group, { undatedNudgeCount: 3 })];
    const { bot, sendMessage } = fakeBot();

    const run = await runReminderPass(bot, "manual");

    expect(sendMessage).not.toHaveBeenCalled();
    expect(tasks.map((task) => task.nextReminderAt)).toEqual([minutes(DAY, 180), minutes(DAY, 24 * 60)]);
    expect(run.cappedByDailyLimit).toBe(2);
  });
});

describe("Study reminder loop", () => {
  it("is not part of the Personal reminder pass", async () => {
    at(DAY);
    await runReminderPass(fakeBot().bot, "manual");

    expect(study.runStudyReminderPass).not.toHaveBeenCalled();
    expect(study.runPendingStudyCalendarSyncs).not.toHaveBeenCalled();
  });

  it("still runs Calendar retries and reports the failure when the Study pass throws", async () => {
    at(DAY);
    study.runStudyReminderPass.mockRejectedValueOnce(new Error("Study database blip"));

    await runStudyReminderLoopPass(fakeBot().bot, DAY);

    expect(study.runPendingStudyCalendarSyncs).toHaveBeenCalledWith(DAY);
    expect(getReminderDiagnostics()).toMatchObject({ studyRemindersSent: 0, studyRemindersFailed: 1 });
  });

  it("reports the latest Study figures alongside the Personal pass", async () => {
    at(DAY);
    study.runStudyReminderPass.mockResolvedValueOnce({ sent: 2, failed: 0, unsafeChat: false });

    await runStudyReminderLoopPass(fakeBot().bot, DAY);
    await runReminderPass(fakeBot().bot, "manual");

    expect(getReminderDiagnostics()).toMatchObject({ studyRemindersSent: 2, studyRemindersFailed: 0, source: "manual" });
  });
});

describe("failed deliveries", () => {
  const transient = () => new Error("socket hang up");
  const kicked = () => Object.assign(new Error("Call to 'sendMessage' failed! (403: Forbidden: bot was kicked from the group chat)"), { error_code: 403 });

  it("backs a failing single reminder off, then keeps retrying every six hours", async () => {
    at(DAY);
    const task = addTask(user("777"));
    const { bot, sendMessage } = fakeBot();
    sendMessage.mockRejectedValue(transient());

    const delays: (number | null)[] = [];
    for (let attempt = 1; attempt <= 7; attempt += 1) {
      const startedAt = new Date();
      const run = await runReminderPass(bot, "manual");
      expect(run.failedDeliveries).toBe(1);
      delays.push(task.nextReminderAt ? (+task.nextReminderAt - +startedAt) / 60_000 : null);
      if (task.nextReminderAt) vi.setSystemTime(task.nextReminderAt);
    }

    expect(delays).toEqual([2, 4, 8, 16, 32, 360, 360]);
    expect(sendMessage).toHaveBeenCalledTimes(7);
    expect(task.reminderCount).toBe(0);
  });

  it("starts the backoff again once a send succeeds", async () => {
    at(DAY);
    const task = addTask(user("777"));
    const { bot, sendMessage } = fakeBot();
    sendMessage.mockRejectedValueOnce(transient());
    await runReminderPass(bot, "manual");
    vi.setSystemTime(task.nextReminderAt!);
    await runReminderPass(bot, "manual");
    expect(task.reminderCount).toBe(1);

    task.nextReminderAt = minutes(new Date(), -1);
    sendMessage.mockRejectedValueOnce(transient());
    await runReminderPass(bot, "manual");

    expect(task.nextReminderAt).toEqual(minutes(new Date(), 2));
  });

  it("stops at once when the bot was removed from the group", async () => {
    at(DAY);
    const group = user("chat:-1001");
    const tasks = [addTask(group), addTask(group)];
    const { bot, sendMessage } = fakeBot();
    sendMessage.mockRejectedValueOnce(kicked());

    const run = await runReminderPass(bot, "manual");

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(tasks.map((task) => task.nextReminderAt)).toEqual([null, null]);
    expect(tasks.map((task) => task.undatedNudgeCount)).toEqual([0, 0]);
    expect(run.failedDeliveries).toBe(1);
  });

  it("backs a failing digest off per task", async () => {
    at(DAY);
    const owner = user("777", { reminderMode: "DIGEST" });
    const dueAt = minutes(DAY, 2 * 24 * 60);
    const tasks = [addTask(owner, { dueAt }), addTask(owner, { dueAt })];
    const { bot, sendMessage } = fakeBot();
    sendMessage.mockRejectedValueOnce(transient());

    const run = await runReminderPass(bot, "manual");

    expect(tasks.map((task) => task.nextReminderAt)).toEqual([minutes(DAY, 2), minutes(DAY, 2)]);
    expect(run.failedDeliveries).toBe(1);
  });

  it("holds a failed custom reminder for the backoff, then retries it every six hours", async () => {
    at(DAY);
    const task = addTask(user("777"), { nextReminderAt: null });
    const schedule = addSchedule(task);
    const { bot, sendMessage } = fakeBot();
    sendMessage.mockRejectedValue(transient());

    const run = await runReminderPass(bot, "manual");
    expect(schedule).toMatchObject({ status: "PROCESSING", leaseExpiresAt: minutes(DAY, 2), lastError: "Error: socket hang up", attemptCount: 1 });
    expect(run.failedDeliveries).toBe(1);

    schedule.attemptCount = 5;
    vi.setSystemTime(schedule.leaseExpiresAt!);
    await runReminderPass(bot, "manual");

    const sixth = new Date();
    expect(schedule).toMatchObject({ status: "PROCESSING", leaseExpiresAt: minutes(sixth, 360), attemptCount: 6 });

    vi.setSystemTime(schedule.leaseExpiresAt!);
    sendMessage.mockReset();
    sendMessage.mockResolvedValue({ message_id: 200, chat: { id: 777 }, date: 0, text: "" });
    await runReminderPass(bot, "manual");

    expect(schedule).toMatchObject({ status: "SENT", attemptCount: 7 });
  });

  it("cancels a custom reminder at once when the bot was removed", async () => {
    at(DAY);
    const schedule = addSchedule(addTask(user("chat:-1001"), { nextReminderAt: null }));
    const { bot, sendMessage } = fakeBot();
    sendMessage.mockRejectedValueOnce(kicked());

    await runReminderPass(bot, "manual");

    expect(schedule).toMatchObject({ status: "CANCELED", attemptCount: 1 });
  });
});

