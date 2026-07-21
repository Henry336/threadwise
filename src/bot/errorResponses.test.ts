import type { Context } from "grammy";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_BOT_ERROR_MESSAGE, errorLogMetadata, respondToUnhandledBotError, userFacingError } from "./errorResponses";

describe("Telegram error responses", () => {
  it("turns Prisma record failures into a useful recovery message", () => {
    const error = Object.assign(new Error("Invalid `prisma.task.findFirstOrThrow()` invocation: No record was found for a query."), {
      code: "P2025",
      name: "PrismaClientKnownRequestError"
    });

    const message = userFacingError(error, "I couldn't save that reminder. Try again in a moment.");

    expect(message).toContain("open the latest list");
    expect(message).not.toContain("prisma");
    expect(message).not.toContain("P2025");
  });

  it("preserves deliberately written validation guidance", () => {
    expect(userFacingError(new Error("No recent note numbered 12. Run /notes to see the current list."))).toBe(
      "No recent note numbered 12. Run /notes to see the current list."
    );
  });

  it("never exposes unknown implementation failures", () => {
    expect(userFacingError(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(DEFAULT_BOT_ERROR_MESSAGE);
  });

  it("maps unavailable database connections without leaking connection details", () => {
    const error = Object.assign(new Error("Timed out fetching a new connection from postgresql://private-host"), { code: "P2024" });
    expect(userFacingError(error)).toBe("Threadwise couldn't reach its data store just now. Please try again in a moment.");
  });

  it("logs only error classification metadata", () => {
    const error = Object.assign(new Error("secret query text"), { code: "P2025", name: "PrismaClientKnownRequestError" });
    expect(errorLogMetadata(error)).toEqual({ errorType: "PrismaClientKnownRequestError", errorCode: "P2025" });
  });

  it("turns an unhandled callback failure into a Telegram alert", async () => {
    const answerCallbackQuery = vi.fn().mockResolvedValue(undefined);
    const reply = vi.fn();
    const ctx = { callbackQuery: { id: "callback-1" }, chat: { id: 1 }, answerCallbackQuery, reply } as unknown as Context;

    await respondToUnhandledBotError(ctx, new TypeError("Cannot read properties of undefined"));

    expect(answerCallbackQuery).toHaveBeenCalledWith({ text: DEFAULT_BOT_ERROR_MESSAGE, show_alert: true });
    expect(reply).not.toHaveBeenCalled();
  });

  it("sends a normal reply when an unhandled message operation fails", async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const ctx = { chat: { id: 1 }, reply } as unknown as Context;

    await respondToUnhandledBotError(ctx, new Error("unexpected internal failure"));

    expect(reply).toHaveBeenCalledWith(DEFAULT_BOT_ERROR_MESSAGE);
  });
});
