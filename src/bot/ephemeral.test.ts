import type { Context } from "grammy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  callbackMatchesEphemeralReceiver,
  configureEphemeralTransport,
  editOrSendEphemeral,
  preferEphemeralInteraction,
  replyToIncomingEphemeral,
} from "./ephemeral";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      result: {
        chat: { id: -1001 },
        receiver_user: { id: 77 },
        ephemeral_message_id: 92,
      },
    }),
  });
  vi.stubGlobal("fetch", fetchMock);
  configureEphemeralTransport("test-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Telegram ephemeral delivery", () => {
  it("opens a private group menu from a public callback", async () => {
    const ctx = callbackContext({
      callbackQuery: { id: "callback-1", message: publicMessage() },
    });
    preferEphemeralInteraction(ctx);

    await editOrSendEphemeral(ctx, "<b>Notes</b>", {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "menu:home" }]] },
    });

    expect(methodName(0)).toBe("sendMessage");
    expect(payload(0)).toEqual(expect.objectContaining({
      chat_id: -1001,
      receiver_user_id: 77,
      callback_query_id: "callback-1",
      text: "<b>Notes</b>",
    }));
  });

  it("edits only the existing user's ephemeral menu", async () => {
    const ctx = callbackContext({
      callbackQuery: {
        id: "callback-2",
        message: {
          ...publicMessage(),
          receiver_user: { id: 77 },
          ephemeral_message_id: 91,
        },
      },
    });

    await editOrSendEphemeral(ctx, "Page two", {
      reply_markup: { inline_keyboard: [] },
    });

    expect(methodName(0)).toBe("editEphemeralMessageText");
    expect(payload(0)).toEqual(expect.objectContaining({
      receiver_user_id: 77,
      ephemeral_message_id: 91,
      text: "Page two",
    }));
  });

  it("answers an incoming ephemeral ForceReply without leaking into the group", async () => {
    const ctx = callbackContext({
      message: {
        ...publicMessage(),
        receiver_user: { id: 999 },
        ephemeral_message_id: 31,
        text: "The answer",
      },
    });

    await replyToIncomingEphemeral(ctx, "Saved", { parse_mode: "HTML" });

    expect(methodName(0)).toBe("sendMessage");
    expect(payload(0)).toEqual(expect.objectContaining({
      chat_id: -1001,
      receiver_user_id: 77,
      reply_parameters: { ephemeral_message_id: 31 },
      text: "Saved",
    }));
  });

  it("rejects callbacks from anyone other than the ephemeral receiver", () => {
    const own = callbackContext({
      callbackQuery: {
        id: "own",
        message: { ...publicMessage(), receiver_user: { id: 77 }, ephemeral_message_id: 2 },
      },
    });
    const someoneElse = callbackContext({
      callbackQuery: {
        id: "other",
        message: { ...publicMessage(), receiver_user: { id: 88 }, ephemeral_message_id: 3 },
      },
    });

    expect(callbackMatchesEphemeralReceiver(own)).toBe(true);
    expect(callbackMatchesEphemeralReceiver(someoneElse)).toBe(false);
  });

  it("does not fall back to editing the shared group card when Telegram rejects ephemeral delivery", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ephemeral unavailable"));
    const ctx = callbackContext({
      callbackQuery: { id: "callback-3", message: publicMessage() },
    });
    preferEphemeralInteraction(ctx);

    await expect(editOrSendEphemeral(ctx, "Private controls", {})).resolves.toBe(true);
  });
});

function callbackContext(overrides: Record<string, unknown>): Context {
  return {
    from: { id: 77, is_bot: false, first_name: "Henry" },
    chat: { id: -1001, type: "supergroup", title: "Test" },
    ...overrides,
  } as unknown as Context;
}

function publicMessage() {
  return {
    message_id: 12,
    date: 0,
    chat: { id: -1001, type: "supergroup", title: "Test" },
    text: "Threadwise",
  };
}

function methodName(index: number): string {
  return String(fetchMock.mock.calls[index]?.[0]).split("/").at(-1) ?? "";
}

function payload(index: number): Record<string, unknown> {
  return JSON.parse(String((fetchMock.mock.calls[index]?.[1] as RequestInit | undefined)?.body));
}
