import type { Bot } from "grammy";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, privateStudyConfig } = vi.hoisted(() => ({
  findMany: vi.fn(),
  privateStudyConfig: vi.fn(() => ({ ownerTelegramId: "5969845149", allowedChatId: "-5507412311" })),
}));

vi.mock("../config/env", () => ({ privateStudyConfig }));
vi.mock("../db/prisma", () => ({ prisma: { communityGroup: { findMany } } }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

import { registerBeaconCommandMenus, registerThreadwiseCommandMenus } from "./commandMenus";

function botWithCommandRecorder() {
  const setMyCommands = vi.fn().mockResolvedValue(true);
  return {
    bot: { api: { setMyCommands } } as unknown as Bot,
    setMyCommands,
  };
}

describe("Telegram command discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    privateStudyConfig.mockReturnValue({ ownerTelegramId: "5969845149", allowedChatId: "-5507412311" });
  });

  it("publishes distinct personal, group, and sealed Study command sets", async () => {
    const { bot, setMyCommands } = botWithCommandRecorder();
    await registerThreadwiseCommandMenus(bot);

    expect(setMyCommands).toHaveBeenCalledTimes(3);
    expect(setMyCommands).toHaveBeenNthCalledWith(1, expect.arrayContaining([
      expect.objectContaining({ command: "task" }),
      expect.objectContaining({ command: "dashboard" }),
    ]), { scope: { type: "all_private_chats" } });
    expect(setMyCommands).toHaveBeenNthCalledWith(2, expect.arrayContaining([
      expect.objectContaining({ command: "todo" }),
      expect.objectContaining({ command: "tasks" }),
    ]), { scope: { type: "all_group_chats" } });
    expect(setMyCommands).toHaveBeenNthCalledWith(3, expect.arrayContaining([
      expect.objectContaining({ command: "travel" }),
      expect.objectContaining({ command: "timetable" }),
    ]), { scope: { type: "chat", chat_id: "-5507412311" } });
  });

  it("keeps Beacon purge owner-only while publishing English and Burmese discovery", async () => {
    findMany.mockResolvedValue([{ telegramChatId: "-100200", moderators: [{ telegramId: "777" }] }]);
    const { bot, setMyCommands } = botWithCommandRecorder();
    await registerBeaconCommandMenus(bot, { ownerTelegramId: "5969845149" } as never);

    expect(setMyCommands).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({
      scope: { type: "all_group_chats" },
      language_code: "my",
    }));
    const moderatorCall = setMyCommands.mock.calls.find(([, options]) => options.scope?.type === "chat_member" && options.scope.user_id === 777);
    expect(moderatorCall?.[0]).not.toEqual(expect.arrayContaining([expect.objectContaining({ command: "purge" })]));
    const ownerCall = setMyCommands.mock.calls.find(([, options]) => options.scope?.type === "chat_member" && options.scope.user_id === 5969845149);
    expect(ownerCall?.[0]).toEqual(expect.arrayContaining([expect.objectContaining({ command: "purge" })]));
  });
});
