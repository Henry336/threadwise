import type { Bot, InlineKeyboard } from "grammy";
import { describe, expect, it, vi } from "vitest";
import type { AiProvider } from "../ai/types";

vi.mock("../db/prisma", () => ({ prisma: {} }));

import { registerCallbacks } from "./callbacks";
import { registerCodexMode } from "./codex";
import { registerThreadwiseCommandMenus } from "./commandMenus";
import { registerCommands } from "./commands";
import { registerFileCourier } from "./files";
import { registerGeminiIdeas } from "./geminiIdeas";
import { registerGroupTopics } from "./groupTopics";
import { HELP_COMMANDS } from "./help";
import { registerImageMessages } from "./imageMessages";
import * as keyboards from "./keyboards";
import { registerNaturalLanguage } from "./naturalLanguage";
import { registerNoteSessions } from "./noteSessions";
import { registerGroupScheduling } from "./scheduling";
import { registerStudyMode } from "./study";
import { registerTaskImports } from "./taskImports";
import { registerTodayInteractions } from "./today";
import { registerVoiceCapture } from "./voiceCapture";

/**
 * A stand-in Bot that records every callbackQuery trigger and command name the Threadwise
 * modules register, and absorbs every other call (use, on, chatType(...), api...) so the
 * real register functions run unchanged.
 */
function recordingBot() {
  const triggers: Array<string | RegExp> = [];
  const commands = new Set<string>();
  const sentMenus: Array<Array<{ command: string }>> = [];
  const absorb: unknown = new Proxy(function absorbAll() {}, {
    get(_target, property) {
      if (property === "then") return undefined;
      if (property === "callbackQuery") return (trigger: string | RegExp | Array<string | RegExp>) => {
        triggers.push(...[trigger].flat());
        return absorb;
      };
      if (property === "command") return (names: string | string[]) => {
        for (const name of [names].flat()) commands.add(name);
        return absorb;
      };
      if (property === "setMyCommands") return async (list: Array<{ command: string }>) => {
        sentMenus.push(list);
        return true;
      };
      return absorb;
    },
    apply: () => absorb,
  });
  return { bot: absorb as Bot, triggers, commands, sentMenus };
}

/** Registers everything createThreadwiseBot registers, in the same order. */
function registeredThreadwiseBot() {
  const recorder = recordingBot();
  const { bot } = recorder;
  const ai = {} as AiProvider;
  registerTodayInteractions(bot);
  registerNoteSessions(bot);
  registerStudyMode(bot);
  registerCommands(bot, ai);
  registerFileCourier(bot);
  registerVoiceCapture(bot, "token");
  registerCodexMode(bot);
  registerGeminiIdeas(bot);
  registerGroupScheduling(bot);
  registerGroupTopics(bot);
  registerTaskImports(bot);
  registerCallbacks(bot, ai);
  registerImageMessages(bot, ai, "token");
  registerNaturalLanguage(bot, ai);
  return recorder;
}

// Long ids are the worst case for Telegram's 64-byte callback_data limit.
const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
const dueAt = new Date("2026-11-09T10:00:00.000Z");
const task = { id, publicId: "TASK-12345", pinnedAt: null, dueAt, calendarEventId: null, calendarEventUrl: null } as never;
const linkedTask = { id, calendarEventId: "evt", calendarEventUrl: "https://calendar.google.com/x" } as never;
const navigation = { kind: "tasks" as const, page: 2, totalPages: 3, numberOffset: 5, workspaceId: id };
const settingFields: keyboards.SettingChoiceField[] = ["interval", "mode", "quiet", "due-nudge", "max", "timezone", "currency", "ocr", "dm"];
const audiences: keyboards.GroupTaskAudience[] = ["unassigned", "everyone", "assignee", "manager", "other"];

/** Every exported keyboard builder with representative inputs, including every branch that adds buttons. */
const builds: Record<string, () => Array<InlineKeyboard | undefined>> = {
  startMenuKeyboard: () => [keyboards.startMenuKeyboard()],
  groupStartMenuKeyboard: () => [keyboards.groupStartMenuKeyboard(id), keyboards.groupStartMenuKeyboard()],
  groupLibraryMenuKeyboard: () => [keyboards.groupLibraryMenuKeyboard(id)],
  groupMoreMenuKeyboard: () => [keyboards.groupMoreMenuKeyboard(id)],
  dashboardLinkKeyboard: () => [keyboards.dashboardLinkKeyboard()],
  groupDashboardLinkKeyboard: () => [keyboards.groupDashboardLinkKeyboard(id)],
  tasksModeKeyboard: () => [keyboards.tasksModeKeyboard()],
  notesModeKeyboard: () => [keyboards.notesModeKeyboard()],
  ideasModeKeyboard: () => [keyboards.ideasModeKeyboard()],
  imagesModeKeyboard: () => [keyboards.imagesModeKeyboard()],
  groupImagesModeKeyboard: () => [keyboards.groupImagesModeKeyboard(id)],
  searchModeKeyboard: () => [keyboards.searchModeKeyboard()],
  archivedKindsKeyboard: () => [keyboards.archivedKindsKeyboard()],
  settingsModeKeyboard: () => [keyboards.settingsModeKeyboard()],
  groupSettingsModeKeyboard: () => [keyboards.groupSettingsModeKeyboard(id)],
  voiceSettingsKeyboard: () => [keyboards.voiceSettingsKeyboard()],
  reminderSettingsKeyboard: () => [keyboards.reminderSettingsKeyboard()],
  regionSettingsKeyboard: () => [keyboards.regionSettingsKeyboard()],
  settingChoicesKeyboard: () => settingFields.map((field) => keyboards.settingChoicesKeyboard(field)),
  settingInputKeyboard: () => [keyboards.settingInputKeyboard("reminders"), keyboards.settingInputKeyboard("region")],
  integrationsSettingsKeyboard: () => [keyboards.integrationsSettingsKeyboard()],
  calendarSettingsKeyboard: () => [
    keyboards.calendarSettingsKeyboard({ connected: true, autoSync: true }),
    keyboards.calendarSettingsKeyboard({ connected: true, autoSync: false }),
    keyboards.calendarSettingsKeyboard({ connected: false, autoSync: false, reconnectRequired: true }, "https://accounts.example/connect"),
  ],
  calendarTaskKeyboard: () => [keyboards.calendarTaskKeyboard(task, "https://accounts.example/connect"), keyboards.calendarTaskKeyboard(linkedTask)],
  disconnectIntegrationKeyboard: () => [keyboards.disconnectIntegrationKeyboard("calendar")],
  taskCancelCalendarKeyboard: () => [keyboards.taskCancelCalendarKeyboard(id)],
  privacySettingsKeyboard: () => [keyboards.privacySettingsKeyboard()],
  menuInputCancelKeyboard: () => [keyboards.menuInputCancelKeyboard("menu:settings")],
  helpTopicsKeyboard: () => [keyboards.helpTopicsKeyboard()],
  groupHelpTopicsKeyboard: () => [keyboards.groupHelpTopicsKeyboard(id)],
  menuBackKeyboard: () => [keyboards.menuBackKeyboard()],
  modeBackKeyboard: () => (["tasks", "notes", "ideas", "images", "expenses", "search"] as const).map((mode) => keyboards.modeBackKeyboard(mode)),
  taskActionsKeyboard: () => [keyboards.taskActionsKeyboard(task), keyboards.taskActionsKeyboard(id, false)],
  groupTaskActionsKeyboard: () => audiences.flatMap((audience) => [
    keyboards.groupTaskActionsKeyboard(task, audience, id),
    keyboards.groupTaskActionsKeyboard(task, audience, id, true),
  ]),
  reminderActionsKeyboard: () => [keyboards.reminderActionsKeyboard(task)],
  taskListKeyboard: () => [keyboards.taskListKeyboard([task], 3, navigation), keyboards.taskListKeyboard([task, task, task], 3, navigation, true)],
  undoKeyboard: () => [keyboards.undoKeyboard()],
  restoreCompletedTaskKeyboard: () => [keyboards.restoreCompletedTaskKeyboard(id)],
  editCancelKeyboard: () => [keyboards.editCancelKeyboard()],
  itemActionsKeyboard: () => (["task", "note", "idea"] as const).map((kind) => keyboards.itemActionsKeyboard(kind, { id, publicId: "NOTE-12345" }, true, { page: 2, totalPages: 3 })),
  itemListKeyboard: () => (["note", "idea"] as const).flatMap((kind) => [
    keyboards.itemListKeyboard(kind, [{ id, publicId: "NOTE-12345" }], 3, navigation),
    keyboards.itemListKeyboard(kind, [{ id, publicId: "NOTE-12345" }], 3, navigation, true),
  ]),
  ideaBriefKeyboard: () => [keyboards.ideaBriefKeyboard("IDEA-12345")],
  captureConfirmationKeyboard: () => [keyboards.captureConfirmationKeyboard(id), ...(["task", "reminder", "note", "idea"] as const).map((kind) => keyboards.captureConfirmationKeyboard(id, kind))],
  captureTypeKeyboard: () => [keyboards.captureTypeKeyboard(id)],
  noteMergePreviewKeyboard: () => [keyboards.noteMergePreviewKeyboard(id)],
  searchPageKeyboard: () => [keyboards.searchPageKeyboard(id, 2, 3)],
  archivedPageKeyboard: () => (["notes", "ideas", "tasks"]).map((kind) => keyboards.archivedPageKeyboard(kind, 2, 3)),
  archivedNoteDetailKeyboard: () => [keyboards.archivedNoteDetailKeyboard("NOTE-12345", 2, 3)],
  bulkActionConfirmationKeyboard: () => [keyboards.bulkActionConfirmationKeyboard(id)],
  imageTextActionsKeyboard: () => [keyboards.imageTextActionsKeyboard(id)],
  imageReminderTimeKeyboard: () => [keyboards.imageReminderTimeKeyboard(id)],
  incomingImageKeyboard: () => [keyboards.incomingImageKeyboard(id)],
  storedImageListKeyboard: () => [
    keyboards.storedImageListKeyboard([{ id }, { id }], 2, 3, 5),
    keyboards.storedImageListKeyboard([{ id }, { id }], 2, 3, 5, id),
    keyboards.storedImageListKeyboard([{ id }, { id }], 2, 3, 5, undefined, true, id),
    keyboards.storedImageListKeyboard([{ id }, { id }], 2, 3, 5, id, true, id),
  ],
  storedImageActionsKeyboard: () => [keyboards.storedImageActionsKeyboard(id)],
  storedImageDeleteKeyboard: () => [keyboards.storedImageDeleteKeyboard(id)],
};

// Reply keyboards carry no callback data; the Done-button data helper is covered through the keyboards that use it.
const notInlineKeyboards = new Set(["privateMenuKeyboard", "noteSessionKeyboard", "taskDoneCallbackData"]);

function callbackData(keyboard: InlineKeyboard | undefined): string[] {
  return (keyboard?.inline_keyboard ?? []).flat().flatMap((button) => ("callback_data" in button ? [button.callback_data] : []));
}

describe("button contract (G5)", () => {
  const { triggers } = registeredThreadwiseBot();
  const routed = (data: string) => triggers.some((trigger) => (typeof trigger === "string" ? trigger === data : new RegExp(trigger.source, trigger.flags).test(data)));

  it("builds every exported keyboard", () => {
    const exported = Object.entries(keyboards).filter(([, value]) => typeof value === "function").map(([name]) => name);
    expect(exported.filter((name) => !builds[name] && !notInlineKeyboards.has(name))).toEqual([]);
  });

  it("routes every button to a registered callback handler and keeps it within Telegram's 64 bytes", () => {
    const all = Object.entries(builds).flatMap(([name, build]) => build().flatMap(callbackData).map((data) => ({ name, data })));
    expect(triggers.length).toBeGreaterThan(50);
    expect(all.length).toBeGreaterThan(100);
    expect(all.filter(({ data }) => !routed(data))).toEqual([]);
    expect(all.filter(({ data }) => Buffer.byteLength(data, "utf8") > 64)).toEqual([]);
  });
});

describe("command contract", () => {
  const { commands } = registeredThreadwiseBot();

  // noteSessions.ts matches these in its message:text handler instead, so they also work
  // while a note session is collecting messages.
  const textHandled = new Set(["note_session", "save_note", "cancel_note"]);

  it("registers a handler for every command in the help reference", () => {
    const listed = HELP_COMMANDS.map((entry) => entry.command.replace(/^\//, "").split(/\s/)[0]!);
    expect(listed.filter((name) => !commands.has(name) && !textHandled.has(name))).toEqual([]);
  });

  it("registers a handler for every command published to Telegram's command menus", async () => {
    const { bot, sentMenus } = recordingBot();
    await registerThreadwiseCommandMenus(bot);
    const published = sentMenus.flat().map((entry) => entry.command);
    expect(published.length).toBeGreaterThan(0);
    expect(published.filter((name) => !commands.has(name) && !textHandled.has(name))).toEqual([]);
  });
});
