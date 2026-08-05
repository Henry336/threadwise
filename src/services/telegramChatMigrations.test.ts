import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  userSettings: { updateMany: vi.fn() },
  reminderDelivery: { updateMany: vi.fn() },
  user: { findUnique: vi.fn(), update: vi.fn() },
  groupWorkspace: { findUnique: vi.fn(), update: vi.fn() }
}));

vi.mock("../db/prisma", () => ({ prisma: db }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

import {
  migrateTelegramGroupChat,
  migratedChatIdFromTelegramError,
  sendMessageWithChatMigrationRecovery
} from "./telegramChatMigrations";

beforeEach(() => {
  vi.clearAllMocks();
  db.userSettings.updateMany.mockResolvedValue({ count: 1 });
  db.reminderDelivery.updateMany.mockResolvedValue({ count: 2 });
  db.user.findUnique.mockResolvedValueOnce({ id: "old-user" }).mockResolvedValueOnce(null);
  db.groupWorkspace.findUnique.mockResolvedValueOnce({ id: "old-workspace" }).mockResolvedValueOnce(null);
  db.user.update.mockResolvedValue({});
  db.groupWorkspace.update.mockResolvedValue({});
});

describe("Telegram group migration recovery", () => {
  it("reads migrate_to_chat_id from a grammY-shaped API error", () => {
    expect(migratedChatIdFromTelegramError({
      parameters: { migrate_to_chat_id: -1001234567890 }
    })).toBe("-1001234567890");
    expect(migratedChatIdFromTelegramError(new Error("unrelated"))).toBeUndefined();
  });

  it("updates reminder destinations and moves unused group identities", async () => {
    const result = await migrateTelegramGroupChat("-123", "-100456");

    expect(db.userSettings.updateMany).toHaveBeenCalledWith({
      where: { reminderChatId: "-123" },
      data: { reminderChatId: "-100456" }
    });
    expect(db.reminderDelivery.updateMany).toHaveBeenCalledWith({
      where: { chatId: "-123" },
      data: { chatId: "-100456" }
    });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "old-user" },
      data: { telegramId: "chat:-100456" }
    });
    expect(db.groupWorkspace.update).toHaveBeenCalledWith({
      where: { id: "old-workspace" },
      data: { telegramChatId: "-100456" }
    });
    expect(result).toMatchObject({ userIdentityUpdated: true, workspaceIdentityUpdated: true });
  });

  it("retries a failed send once using Telegram's replacement chat ID", async () => {
    const sendMessage = vi.fn()
      .mockRejectedValueOnce({ parameters: { migrate_to_chat_id: -100456 } })
      .mockResolvedValueOnce({ message_id: 42 });
    const bot = { api: { sendMessage } } as never;

    const result = await sendMessageWithChatMigrationRecovery(bot, "-123", "Reminder");

    expect(sendMessage).toHaveBeenNthCalledWith(1, "-123", "Reminder", undefined);
    expect(sendMessage).toHaveBeenNthCalledWith(2, "-100456", "Reminder", undefined);
    expect(result).toEqual({ chatId: "-100456", message: { message_id: 42 } });
  });
});
