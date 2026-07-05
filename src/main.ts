import { env } from "./config/env";
import { createAiProvider } from "./ai";
import { createThreadwiseBot } from "./bot";
import { prisma } from "./db/prisma";
import { logger } from "./logger";
import { startReminderLoop } from "./services/reminders";
import { startServer } from "./server";

async function main() {
  const ai = createAiProvider();
  const bot = createThreadwiseBot(env.TELEGRAM_BOT_TOKEN, ai);
  const reminderLoop = startReminderLoop(bot, env.REMINDER_POLL_MS);
  let server: Awaited<ReturnType<typeof startServer>> | undefined;

  const shutdown = async (signal: string) => {
    logger.info("Shutting down Threadwise.", { signal });
    clearInterval(reminderLoop);
    await server?.close();
    await bot.stop();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  if (env.WEBHOOK_URL) {
    const webhookUrl = `${env.WEBHOOK_URL.replace(/\/$/, "")}${env.WEBHOOK_SECRET_PATH}`;
    await bot.api.setWebhook(webhookUrl);
    server = await startServer(bot, { port: env.PORT, webhookPath: env.WEBHOOK_SECRET_PATH });
    logger.info("Threadwise is running with Telegram webhooks.", { webhookUrl });
  } else {
    await bot.api.deleteWebhook();
    void bot.start({
      onStart: () => logger.info("Threadwise is running with Telegram long polling.")
    });
    logger.info("Threadwise is running with Telegram long polling.");
  }
}

main().catch(async (error) => {
  logger.error("Threadwise failed to start.", { error: String(error) });
  await prisma.$disconnect();
  process.exit(1);
});
