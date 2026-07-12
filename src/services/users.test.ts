import { describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";

vi.mock("../config/env", () => ({
  env: {
    DEFAULT_TIMEZONE: "Asia/Singapore",
    DEFAULT_REMINDER_INTERVAL_MINUTES: 180,
    DEFAULT_QUIET_HOURS_START: "22:00",
    DEFAULT_QUIET_HOURS_END: "08:00"
  }
}));

vi.mock("../db/prisma", () => ({
  prisma: {}
}));

import { defaultTimezoneForTelegramLanguage, threadwiseUserIdentity } from "./users";

describe("user defaults", () => {
  it("infers common timezone defaults from Telegram language codes when possible", () => {
    expect(defaultTimezoneForTelegramLanguage("my")).toBe("Asia/Yangon");
    expect(defaultTimezoneForTelegramLanguage("my-MM")).toBe("Asia/Yangon");
    expect(defaultTimezoneForTelegramLanguage("ms")).toBe("Asia/Kuala_Lumpur");
    expect(defaultTimezoneForTelegramLanguage("en")).toBeUndefined();
  });

  it("uses a group chat as the Threadwise data owner in groups", () => {
    const identity = threadwiseUserIdentity({
      chat: {
        id: -100123,
        type: "supergroup",
        title: "Family reminders",
        username: "family_reminders"
      },
      from: {
        id: 456,
        is_bot: false,
        first_name: "Parent",
        language_code: "my"
      }
    } as Context);

    expect(identity).toMatchObject({
      telegramId: "chat:-100123",
      username: "family_reminders",
      firstName: "Family reminders",
      defaultTimezone: "Asia/Singapore",
      reminderChatId: "-100123",
      isGroup: true,
      defaultCurrency: "SGD",
      defaultOcrLanguages: "eng"
    });
  });

  it("uses Myanmar-friendly defaults for a new private user", () => {
    const identity = threadwiseUserIdentity({
      chat: { id: 456, type: "private", first_name: "Henry" },
      from: { id: 456, is_bot: false, first_name: "Henry", language_code: "my" }
    } as Context);

    expect(identity).toMatchObject({
      defaultTimezone: "Asia/Yangon",
      defaultCurrency: "MMK",
      defaultOcrLanguages: "eng+mya"
    });
  });
});
