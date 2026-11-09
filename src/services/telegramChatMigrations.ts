/**
 * Repairs stored chat ids when Telegram upgrades a basic group to a supergroup.
 * Called from src/bot/index.ts (for the migration service messages) and from
 * reminders.ts (when a send fails because the old chat id is gone).
 */
import type { Bot, Context } from "grammy";
import { prisma } from "../db/prisma";
import { logger } from "../logger";

type MigrationResult = {
  oldChatId: string;
  newChatId: string;
  reminderDestinationsUpdated: number;
  reminderDeliveriesUpdated: number;
  userIdentityUpdated: boolean;
  workspaceIdentityUpdated: boolean;
};

type SendMessageOptions = Parameters<Bot["api"]["sendMessage"]>[2];
type SentMessage = Awaited<ReturnType<Bot["api"]["sendMessage"]>>;

/**
 * Telegram replaces a basic-group ID when it is upgraded to a supergroup.
 * Keep Threadwise's stored delivery destination aligned with that replacement
 * instead of retrying the obsolete ID forever.
 */
export async function migrateTelegramGroupChat(
  oldChatIdInput: string | number,
  newChatIdInput: string | number
): Promise<MigrationResult> {
  const oldChatId = normalizeChatId(oldChatIdInput);
  const newChatId = normalizeChatId(newChatIdInput);
  const result: MigrationResult = {
    oldChatId,
    newChatId,
    reminderDestinationsUpdated: 0,
    reminderDeliveriesUpdated: 0,
    userIdentityUpdated: false,
    workspaceIdentityUpdated: false
  };

  if (!oldChatId || !newChatId || oldChatId === newChatId) return result;

  const destinationUpdate = await prisma.userSettings.updateMany({
    where: { reminderChatId: oldChatId },
    data: { reminderChatId: newChatId }
  });
  result.reminderDestinationsUpdated = destinationUpdate.count;

  const deliveryUpdate = await prisma.reminderDelivery.updateMany({
    where: { chatId: oldChatId },
    data: { chatId: newChatId }
  });
  result.reminderDeliveriesUpdated = deliveryUpdate.count;

  const oldIdentity = `chat:${oldChatId}`;
  const newIdentity = `chat:${newChatId}`;
  const [sourceUser, targetUser, sourceWorkspace, targetWorkspace] = await Promise.all([
    prisma.user.findUnique({ where: { telegramId: oldIdentity }, select: { id: true } }),
    prisma.user.findUnique({ where: { telegramId: newIdentity }, select: { id: true } }),
    prisma.groupWorkspace.findUnique({ where: { telegramChatId: oldChatId }, select: { id: true } }),
    prisma.groupWorkspace.findUnique({ where: { telegramChatId: newChatId }, select: { id: true } })
  ]);

  // Preserve existing records if the new ID has already been used. Delivery
  // repair still succeeds above; identities can then be reconciled manually
  // without deleting or silently merging either workspace.
  if (sourceUser && !targetUser) {
    await prisma.user.update({ where: { id: sourceUser.id }, data: { telegramId: newIdentity } });
    result.userIdentityUpdated = true;
  }
  if (sourceWorkspace && !targetWorkspace) {
    await prisma.groupWorkspace.update({ where: { id: sourceWorkspace.id }, data: { telegramChatId: newChatId } });
    result.workspaceIdentityUpdated = true;
  }

  logger.info("Recorded Telegram group-to-supergroup migration.", result);
  return result;
}

/**
 * Handles Telegram's migrate_to / migrate_from service messages. Returns true
 * when the update was a migration notice, so the caller can stop processing it.
 */
export async function handleTelegramGroupMigrationUpdate(ctx: Context): Promise<boolean> {
  const message = ctx.message;
  if (!message) return false;

  if ("migrate_to_chat_id" in message && typeof message.migrate_to_chat_id === "number") {
    await migrateTelegramGroupChat(message.chat.id, message.migrate_to_chat_id);
    return true;
  }
  if ("migrate_from_chat_id" in message && typeof message.migrate_from_chat_id === "number") {
    await migrateTelegramGroupChat(message.migrate_from_chat_id, message.chat.id);
    return true;
  }
  return false;
}

/**
 * Reads the new supergroup id that Telegram includes in a send error for a
 * migrated chat. Returns undefined for any other error.
 */
export function migratedChatIdFromTelegramError(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("parameters" in error)) return undefined;
  const parameters = error.parameters;
  if (!parameters || typeof parameters !== "object" || !("migrate_to_chat_id" in parameters)) return undefined;
  const chatId = parameters.migrate_to_chat_id;
  if (typeof chatId !== "number" && typeof chatId !== "string") return undefined;
  const normalized = normalizeChatId(chatId);
  return normalized || undefined;
}

/**
 * Sends a message and, if Telegram says the chat moved to a supergroup, records
 * the migration and retries once at the new id. Returns the chat id actually used
 * so callers can store it. Other errors are rethrown.
 */
export async function sendMessageWithChatMigrationRecovery(
  bot: Bot,
  chatIdInput: string | number,
  text: string,
  options?: SendMessageOptions
): Promise<{ chatId: string; message: SentMessage }> {
  const chatId = normalizeChatId(chatIdInput);
  try {
    return { chatId, message: await bot.api.sendMessage(chatId, text, options) };
  } catch (error) {
    const migratedChatId = migratedChatIdFromTelegramError(error);
    if (!migratedChatId || migratedChatId === chatId) throw error;

    await migrateTelegramGroupChat(chatId, migratedChatId);
    logger.warn("Retrying Telegram delivery with migrated supergroup chat ID.", {
      oldChatId: chatId,
      newChatId: migratedChatId
    });
    return {
      chatId: migratedChatId,
      message: await bot.api.sendMessage(migratedChatId, text, options)
    };
  }
}

/** Compares chat ids as plain strings, ignoring the synthetic "chat:" prefix. */
function normalizeChatId(value: string | number): string {
  return String(value).trim().replace(/^chat:/, "");
}
