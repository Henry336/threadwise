import type { Bot } from "grammy";
import type { BotCommand, BotCommandScope, LanguageCode } from "@grammyjs/types";
import type { BeaconConfig } from "../config/env";
import { privateStudyConfig } from "../config/env";
import { prisma } from "../db/prisma";
import { logger } from "../logger";

const personalCommands: BotCommand[] = [
  { command: "menu", description: "Open Threadwise" },
  { command: "task", description: "Save or open a task" },
  { command: "note", description: "Save a note" },
  { command: "idea", description: "Save an idea" },
  { command: "search", description: "Search your captures" },
  { command: "dashboard", description: "Open your dashboard" },
  { command: "settings", description: "Open settings" },
  { command: "help", description: "Get help" },
];

const groupCommands: BotCommand[] = [
  { command: "menu", description: "Open group Threadwise" },
  { command: "tasks", description: "View shared tasks" },
  { command: "todo", description: "Import a TODO list" },
  { command: "search", description: "Search shared captures" },
  { command: "dashboard", description: "Open the group dashboard" },
  { command: "help", description: "Get group help" },
];

const studyCommands: BotCommand[] = [
  { command: "study", description: "Open Study Mode" },
  { command: "attention", description: "Show what needs attention" },
  { command: "upcoming", description: "Show upcoming work" },
  { command: "modules", description: "Open modules" },
  { command: "travel", description: "Plan a campus route" },
  { command: "timetable", description: "Open the timetable" },
  { command: "nusmods", description: "Import a NUSMods timetable" },
  { command: "dashboard", description: "Open the Study dashboard" },
  { command: "help", description: "Get Study help" },
];

const beaconMemberCommands: BotCommand[] = [
  { command: "beacon", description: "Open Beacon" },
  { command: "rules", description: "Show community rules" },
  { command: "report", description: "Report the replied message" },
];

const beaconMemberCommandsMy: BotCommand[] = [
  { command: "beacon", description: "Beacon ကို ဖွင့်ရန်" },
  { command: "rules", description: "အဖွဲ့စည်းမျဉ်းများ ကြည့်ရန်" },
  { command: "report", description: "ပြန်စာပေးထားသော မက်ဆေ့ချ်ကို တိုင်ကြားရန်" },
];

async function setCommands(bot: Bot, commands: BotCommand[], scope: BotCommandScope, languageCode?: LanguageCode): Promise<void> {
  await bot.api.setMyCommands(commands, {
    scope,
    ...(languageCode ? { language_code: languageCode } : {}),
  });
}

export async function registerThreadwiseCommandMenus(bot: Bot): Promise<void> {
  try {
    await setCommands(bot, personalCommands, { type: "all_private_chats" });
    await setCommands(bot, groupCommands, { type: "all_group_chats" });
    const study = privateStudyConfig();
    if (study) await setCommands(bot, studyCommands, { type: "chat", chat_id: study.allowedChatId });
    logger.info("Threadwise Telegram command menus registered.");
  } catch (error) {
    logger.warn("Could not register Threadwise Telegram command menus.", { error: String(error) });
  }
}

export async function registerBeaconCommandMenus(bot: Bot, config: BeaconConfig): Promise<void> {
  try {
    await setCommands(bot, beaconMemberCommands, { type: "all_private_chats" });
    await setCommands(bot, beaconMemberCommands, { type: "all_group_chats" });
    await setCommands(bot, beaconMemberCommandsMy, { type: "all_private_chats" }, "my");
    await setCommands(bot, beaconMemberCommandsMy, { type: "all_group_chats" }, "my");

    const groups = await prisma.communityGroup.findMany({
      where: { enabled: true },
      include: { moderators: { where: { status: "ACTIVE" } } },
    });
    for (const group of groups) {
      const chatId = group.telegramChatId;
      for (const moderator of group.moderators) {
        await setCommands(bot, beaconMemberCommands, {
          type: "chat_member",
          chat_id: chatId,
          user_id: Number(moderator.telegramId),
        });
      }
      await setCommands(bot, [
        ...beaconMemberCommands,
        { command: "purge", description: "Purge the current topic" },
      ], {
        type: "chat_member",
        chat_id: chatId,
        user_id: Number(config.ownerTelegramId),
      });
    }
    await setCommands(bot, [
      ...beaconMemberCommands,
      { command: "purge", description: "Purge the current topic" },
    ], { type: "chat", chat_id: config.ownerTelegramId });
    logger.info("Beacon Telegram command menus registered.");
  } catch (error) {
    logger.warn("Could not register Beacon Telegram command menus.", { error: String(error) });
  }
}
