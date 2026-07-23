import type { Context } from "grammy";
import { truncate } from "../utils/text";
import { isEphemeralInteractionContext } from "./ephemeral";

export const DEFAULT_BOT_ERROR_MESSAGE = "I couldn't complete that request just now. Please try again in a moment.";

type ErrorDetails = {
  code?: string;
  message?: string;
  name?: string;
};

export function userFacingError(error: unknown, fallback = DEFAULT_BOT_ERROR_MESSAGE): string {
  const safeFallback = safeFallbackText(fallback);
  const details = errorDetails(error);
  const message = details.message ?? "";
  const code = details.code?.toUpperCase();

  if (code === "P2025" || /no record was found for a query|record to (?:update|delete) does not exist/i.test(message)) {
    return "I couldn't find something that request depended on. It may have changed or been removed—open the latest list and try again.";
  }

  if (code === "P2002" || /unique constraint/i.test(message)) {
    return "That change conflicts with something already saved. Refresh the latest list and try again.";
  }

  if (isDatabaseUnavailable(code, message)) {
    return "Threadwise couldn't reach its data store just now. Please try again in a moment.";
  }

  if (isConnectedServiceFailure(message)) {
    return `${withoutRetrySuffix(safeFallback)} The connected service didn't respond safely; try again, or reconnect it from Settings if this continues.`;
  }

  if (isAiProviderFailure(message)) {
    return `${withoutRetrySuffix(safeFallback)} The AI helper is temporarily unavailable, so please try again shortly.`;
  }

  const cleanMessage = cleanUserMessage(message);
  if (cleanMessage && isClearlyUserFacing(cleanMessage) && !looksTechnical(cleanMessage)) {
    return cleanMessage;
  }

  return safeFallback;
}

export async function respondToUnhandledBotError(ctx: Context, error: unknown): Promise<void> {
  const message = userFacingError(error);

  if (ctx.callbackQuery) {
    try {
      await ctx.answerCallbackQuery({ text: truncate(message, 180), show_alert: true });
      return;
    } catch {
      // The callback may already have expired. Fall through to a normal chat reply.
    }
  }

  if (!ctx.chat) return;
  if (isEphemeralInteractionContext(ctx)) {
    if (!ctx.from?.id) return;
    try {
      await ctx.api.sendMessage(ctx.from.id, message);
    } catch {
      // A private recovery message is preferable to leaking the failed action
      // into the shared group, but it is not guaranteed if the user has never
      // opened the bot directly.
    }
    return;
  }

  try {
    await ctx.reply(message);
  } catch {
    // Reporting an error must never create another unhandled bot error.
  }
}

export function errorLogMetadata(error: unknown): Record<string, unknown> {
  const details = errorDetails(error);
  return {
    errorType: details.name ?? typeof error,
    ...(details.code ? { errorCode: details.code } : {})
  };
}

function errorDetails(error: unknown): ErrorDetails {
  if (!error || typeof error !== "object") {
    return { message: typeof error === "string" ? error : undefined };
  }

  const value = error as { code?: unknown; message?: unknown; name?: unknown };
  return {
    code: typeof value.code === "string" ? value.code : undefined,
    message: typeof value.message === "string" ? value.message : undefined,
    name: typeof value.name === "string" ? value.name : undefined
  };
}

function safeFallbackText(fallback: string): string {
  const clean = cleanUserMessage(fallback);
  return clean && !looksTechnical(clean) ? clean : DEFAULT_BOT_ERROR_MESSAGE;
}

function cleanUserMessage(message: string): string | undefined {
  const clean = message.replace(/\s+/g, " ").trim();
  return clean ? truncate(clean, 320) : undefined;
}

function withoutRetrySuffix(message: string): string {
  return message.replace(/\s*(?:Please\s+)?Try again(?:\s+in a moment|\s+shortly)?\.?$/i, "").trim();
}

function isDatabaseUnavailable(code: string | undefined, message: string): boolean {
  return Boolean(code && ["P1000", "P1001", "P1002", "P1008", "P1017", "P2024"].includes(code))
    || /(?:can't|cannot|could not) reach database|connection pool|timed out fetching a new connection|too many (?:database )?connections|emaxconn|database .* unavailable/i.test(message);
}

function isConnectedServiceFailure(message: string): boolean {
  return /(?:microsoft graph|google (?:calendar|oauth)|gmail api|oauth).*(?:failed|error|\b[45]\d\d\b)|invalid_grant|access[_ -]?token|refresh[_ -]?token/i.test(message);
}

function isAiProviderFailure(message: string): boolean {
  return /openai|chat completions|embedding provider|insufficient_quota|rate limit|model .*?(?:unavailable|not found)|api[_ -]?key/i.test(message);
}

function looksTechnical(message: string): boolean {
  return /prisma\.|prismaclient|invalid `?[^`\s]+\.(?:find|create|update|delete|upsert)|an operation failed because|no record was found for a query|\bP\d{4}\b|\b(?:select|insert|update|delete)\s+.+\b(?:from|into|set|where)\b|cannot read propert|is not a function|at \S+ \([^)]*:\d+:\d+\)|econn(?:refused|reset)|etimedout|fetch failed|socket hang up|\b(?:database|openai|google|microsoft|gmail)_[A-Z0-9_]+\b|secret|api[_ -]?key|bearer\s+[A-Za-z0-9._-]+|https?:\/\/\S+\/(?:oauth|token|v\d+\/)/i.test(message);
}

function isClearlyUserFacing(message: string): boolean {
  return /^(?:I (?:can't|cannot|couldn't|could not|need)|That |This |No |Only |Pick |Use |Try |You |Your |Task |Note |Idea |Expense |Excel |Gmail |Google Calendar |Microsoft Excel |Those |One of |The selected |Merge )/i.test(message);
}
