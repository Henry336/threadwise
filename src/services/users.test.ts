import { describe, expect, it, vi } from "vitest";

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

import { defaultTimezoneForTelegramLanguage } from "./users";

describe("user defaults", () => {
  it("infers common timezone defaults from Telegram language codes when possible", () => {
    expect(defaultTimezoneForTelegramLanguage("my")).toBe("Asia/Yangon");
    expect(defaultTimezoneForTelegramLanguage("my-MM")).toBe("Asia/Yangon");
    expect(defaultTimezoneForTelegramLanguage("ms")).toBe("Asia/Kuala_Lumpur");
    expect(defaultTimezoneForTelegramLanguage("en")).toBeUndefined();
  });
});
