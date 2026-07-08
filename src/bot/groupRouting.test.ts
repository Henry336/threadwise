import type { Context } from "grammy";
import { describe, expect, it } from "vitest";
import { isTelegramContextAllowed, prepareNaturalLanguageText, telegramAllowlistKeys } from "./groupRouting";

const bot = {
  id: 99,
  is_bot: true,
  first_name: "Threadwise",
  username: "threadwise_1_bot"
};

function context(overrides: Record<string, unknown>): Context {
  return {
    me: bot,
    ...overrides
  } as Context;
}

describe("group routing", () => {
  it("builds allowlist keys for both sender and chat scopes", () => {
    const ctx = context({
      from: { id: 123, is_bot: false, first_name: "Henry" },
      chat: { id: -100456, type: "supergroup", title: "Family" }
    });

    expect(telegramAllowlistKeys(ctx)).toEqual(["123", "-100456", "chat:-100456"]);
  });

  it("allows a group when the group chat id is allowlisted", () => {
    const ctx = context({
      from: { id: 456, is_bot: false, first_name: "Parent" },
      chat: { id: -100456, type: "supergroup", title: "Family" }
    });

    expect(isTelegramContextAllowed(ctx, new Set(["chat:-100456"]))).toBe(true);
  });

  it("ignores unaddressed natural language in groups", () => {
    const ctx = context({
      from: { id: 456, is_bot: false, first_name: "Parent" },
      chat: { id: -100456, type: "supergroup", title: "Family" }
    });

    expect(prepareNaturalLanguageText(ctx, "remind me to buy rice at 5pm")).toBeUndefined();
  });

  it("strips bot mentions before natural command parsing", () => {
    const ctx = context({
      from: { id: 456, is_bot: false, first_name: "Parent" },
      chat: { id: -100456, type: "supergroup", title: "Family" }
    });

    expect(prepareNaturalLanguageText(ctx, "hey @threadwise_1_bot remind me to buy rice at 5pm")).toBe("remind me to buy rice at 5pm");
  });

  it("uses Telegram mention entities when the runtime bot username is missing", () => {
    const ctx = {
      me: { id: 99, is_bot: true, first_name: "Threadwise" },
      from: { id: 456, is_bot: false, first_name: "Parent" },
      chat: { id: -100456, type: "supergroup", title: "Family" },
      message: {
        message_id: 11,
        date: 0,
        chat: { id: -100456, type: "supergroup", title: "Family" },
        text: "@threadwise_1_bot remind @henry_derek to submit his assignment at 10:19 am",
        entities: [{ type: "mention", offset: 0, length: 17 }]
      }
    } as unknown as Context;

    expect(prepareNaturalLanguageText(ctx, ctx.message?.text ?? "")).toBe("remind @henry_derek to submit his assignment at 10:19 am");
  });

  it("accepts the screenshot-style bot mention and keeps the assignee mention", () => {
    const ctx = context({
      from: { id: 456, is_bot: false, first_name: "Parent" },
      chat: { id: -100456, type: "supergroup", title: "Family" },
      message: {
        message_id: 12,
        date: 0,
        chat: { id: -100456, type: "supergroup", title: "Family" },
        text: "@threadwise_1_bot remind @henry_derek to submit his assignment at 10:19 am",
        entities: [{ type: "mention", offset: 0, length: 17 }, { type: "mention", offset: 25, length: 12 }]
      }
    });

    expect(prepareNaturalLanguageText(ctx, "@threadwise_1_bot remind @henry_derek to submit his assignment at 10:19 am")).toBe("remind @henry_derek to submit his assignment at 10:19 am");
  });

  it("accepts replies to the bot in groups", () => {
    const ctx = context({
      from: { id: 456, is_bot: false, first_name: "Parent" },
      chat: { id: -100456, type: "supergroup", title: "Family" },
      message: {
        message_id: 10,
        date: 0,
        chat: { id: -100456, type: "supergroup", title: "Family" },
        text: "show tasks",
        reply_to_message: {
          message_id: 9,
          date: 0,
          chat: { id: -100456, type: "supergroup", title: "Family" },
          from: bot,
          text: "What should I do next?"
        }
      }
    });

    expect(prepareNaturalLanguageText(ctx, "show tasks")).toBe("show tasks");
  });
});
