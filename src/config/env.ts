import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-5.4-mini"),
  OPENAI_MODEL_FALLBACKS: z.string().default("gpt-5.5,gpt-5.4,gpt-5.4-nano"),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  ADMIN_STATUS_TOKEN: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(3000),
  WEBHOOK_URL: z.string().url().optional(),
  WEBHOOK_SECRET_PATH: z.string().startsWith("/").default("/telegram/webhook"),
  REMINDER_POLL_MS: z.coerce.number().int().positive().default(60_000),
  DEFAULT_TIMEZONE: z.string().default("Asia/Singapore"),
  DEFAULT_REMINDER_INTERVAL_MINUTES: z.coerce.number().int().positive().default(180),
  DEFAULT_QUIET_HOURS_START: z.string().default("22:00"),
  DEFAULT_QUIET_HOURS_END: z.string().default("08:00"),
  BOT_ALLOWED_TELEGRAM_IDS: z.string().optional()
});

export const env = envSchema.parse(process.env);

export function allowedTelegramIds(): Set<string> | undefined {
  if (!env.BOT_ALLOWED_TELEGRAM_IDS) {
    return undefined;
  }

  return new Set(
    env.BOT_ALLOWED_TELEGRAM_IDS.split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  );
}
