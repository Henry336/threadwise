import { z } from "zod";
import { normalizeClock } from "../utils/clock";

const clock = z.string()
  .refine((value) => Boolean(normalizeClock(value)), "Use a valid 24-hour time such as 03:00 or 22:30.")
  .transform((value) => normalizeClock(value)!);

const optional = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  schema.optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  DATABASE_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(10).default(3),
  DATABASE_POOL_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(120).default(30),
  SUPABASE_RUNTIME_POOL_MODE: z.enum(["auto", "session", "transaction"]).default("auto"),
  OPENAI_API_KEY: optional(z.string()),
  OPENAI_MODEL: z.string().default("gpt-5.4-mini"),
  OPENAI_MODEL_FALLBACKS: z.string().default("gpt-5.5,gpt-5.4,gpt-5.4-nano"),
  ADMIN_STATUS_TOKEN: optional(z.string()),
  PORT: z.coerce.number().int().positive().default(3000),
  WEBHOOK_URL: optional(z.string().url()),
  WEBHOOK_SECRET_PATH: z.string().startsWith("/").default("/telegram/webhook"),
  GOOGLE_CLIENT_ID: optional(z.string()),
  GOOGLE_CLIENT_SECRET: optional(z.string()),
  GOOGLE_CALENDAR_REDIRECT_URI: optional(z.string().url()),
  GOOGLE_TOKEN_ENCRYPTION_KEY: optional(z.string().min(16)),
  MICROSOFT_CLIENT_ID: optional(z.string()),
  MICROSOFT_CLIENT_SECRET: optional(z.string()),
  MICROSOFT_REDIRECT_URI: optional(z.string().url()),
  MICROSOFT_TOKEN_ENCRYPTION_KEY: optional(z.string().min(16)),
  REMINDER_POLL_MS: z.coerce.number().int().positive().default(60_000),
  DEFAULT_TIMEZONE: z.string().default("Asia/Singapore"),
  DEFAULT_REMINDER_INTERVAL_MINUTES: z.coerce.number().int().positive().default(180),
  DEFAULT_QUIET_HOURS_START: clock.default("22:00"),
  DEFAULT_QUIET_HOURS_END: clock.default("08:00"),
  BOT_ALLOWED_TELEGRAM_IDS: optional(z.string()),
  CODEX_OWNER_TELEGRAM_ID: optional(z.string().regex(/^\d+$/)),
  CODEX_TELEGRAM_CHAT_ID: optional(z.string().regex(/^-?\d+$/)),
  CODEX_WORKER_TOKEN: optional(z.string().min(24)),
  CODEX_JOB_LEASE_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3_600),
  FILE_COURIER_MAX_BYTES: z.coerce.number().int().min(1_024).max(50_000_000).default(50_000_000),
  VOICE_TRANSCRIPTION_MAX_BYTES: z.coerce.number().int().min(1_024).max(25_000_000).default(20_000_000),
  VOICE_TRANSCRIPTION_LEASE_SECONDS: z.coerce.number().int().min(60).max(3_600).default(300),
  STUDY_OWNER_TELEGRAM_ID: optional(z.string().regex(/^\d+$/)),
  STUDY_ALLOWED_CHAT_ID: optional(z.string().regex(/^-\d+$/)),
  CANVAS_ACCESS_TOKEN: optional(z.string().min(16)),
  CANVAS_BASE_URL: z.string().url().default("https://canvas.nus.edu.sg/api/v1"),
  STUDY_CANVAS_SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(5).max(1_440).default(30),
  STUDY_TRANSIT_BASE_URL: z.string().url().default("https://improved-nextbus.vercel.app"),
  STUDY_EXTERNAL_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(12_000)
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

export type PrivateCodexConfig = {
  ownerTelegramId: string;
  telegramChatId: string;
  workerToken: string;
  jobLeaseSeconds: number;
};

export type PrivateStudyConfig = {
  ownerTelegramId: string;
  allowedChatId: string;
};

export function privateStudyConfig(): PrivateStudyConfig | undefined {
  if (!env.STUDY_OWNER_TELEGRAM_ID || !env.STUDY_ALLOWED_CHAT_ID) return undefined;
  return {
    ownerTelegramId: env.STUDY_OWNER_TELEGRAM_ID,
    allowedChatId: env.STUDY_ALLOWED_CHAT_ID
  };
}

export function privateCodexConfig(): PrivateCodexConfig | undefined {
  if (!env.CODEX_OWNER_TELEGRAM_ID || !env.CODEX_TELEGRAM_CHAT_ID || !env.CODEX_WORKER_TOKEN) {
    return undefined;
  }

  return {
    ownerTelegramId: env.CODEX_OWNER_TELEGRAM_ID,
    telegramChatId: env.CODEX_TELEGRAM_CHAT_ID,
    workerToken: env.CODEX_WORKER_TOKEN,
    jobLeaseSeconds: env.CODEX_JOB_LEASE_SECONDS
  };
}
