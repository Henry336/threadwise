import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerAuthenticatedTelegramWebhook } from "./server";

const PATH = "/telegram/threadwise-v2";
const OLD_PATH = "/telegram/webhook";
const SECRET = "phase1_test_secret_0123456789_ABCDEFG";

function testServer() {
  const server = Fastify();
  const handler = vi.fn(async (_request, reply) => reply.code(204).send());
  registerAuthenticatedTelegramWebhook(server, { path: PATH, secret: SECRET, handler });
  return { server, handler };
}

describe("authenticated Telegram webhook", () => {
  it.each([
    ["missing", undefined],
    ["malformed", "spaces are not a Telegram secret"],
    ["invalid", "phase1_test_secret_0123456789_WRONGVALUE"]
  ])("rejects a %s secret before the bot handler", async (_label, secret) => {
    const { server, handler } = testServer();
    const response = await server.inject({
      method: "POST",
      url: PATH,
      headers: secret ? { "x-telegram-bot-api-secret-token": secret } : undefined,
      payload: {}
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "not_found" });
    expect(handler).not.toHaveBeenCalled();
    await server.close();
  });

  it("accepts the configured secret and invokes the bot handler once", async () => {
    const { server, handler } = testServer();
    const response = await server.inject({
      method: "POST",
      url: PATH,
      headers: { "x-telegram-bot-api-secret-token": SECRET },
      payload: {}
    });

    expect(response.statusCode).toBe(204);
    expect(handler).toHaveBeenCalledTimes(1);
    await server.close();
  });

  it("does not expose the retired webhook route", async () => {
    const { server, handler } = testServer();
    const response = await server.inject({
      method: "POST",
      url: OLD_PATH,
      headers: { "x-telegram-bot-api-secret-token": SECRET },
      payload: {}
    });

    expect(response.statusCode).toBe(404);
    expect(handler).not.toHaveBeenCalled();
    await server.close();
  });
});
