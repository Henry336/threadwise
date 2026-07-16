import { env } from "./config/env";
import { createAiProvider } from "./ai";
import { createThreadwiseBot } from "./bot";
import { defaultDashboardPublicKey } from "./dashboard/publicKey";
import { prisma } from "./db/prisma";
import { logger } from "./logger";
import { startGmailScanLoop } from "./services/gmail";
import { startReminderLoop } from "./services/reminders";
import { startServer } from "./server";

async function main() {
  const ai = createAiProvider();
  const bot = createThreadwiseBot(env.TELEGRAM_BOT_TOKEN, ai);
  const reminderLoop = startReminderLoop(bot, env.REMINDER_POLL_MS);
  const gmailLoop = startGmailScanLoop(bot, ai, env.GMAIL_SCAN_POLL_MS);
  let server: Awaited<ReturnType<typeof startServer>> | undefined;

  const shutdown = async (signal: string) => {
    logger.info("Shutting down Threadwise.", { signal });
    clearInterval(reminderLoop);
    if (gmailLoop) clearInterval(gmailLoop);
    await server?.close();
    await bot.stop();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  if (env.WEBHOOK_URL) {
    await bot.init();
    const webhookUrl = `${env.WEBHOOK_URL.replace(/\/$/, "")}${env.WEBHOOK_SECRET_PATH}`;
    await bot.api.setWebhook(webhookUrl, { allowed_updates: ["message", "callback_query", "my_chat_member"] });
    const webhookInfo = await bot.api.getWebhookInfo();
    server = await startServer(bot, ai, {
      port: env.PORT,
      webhookPath: env.WEBHOOK_SECRET_PATH,
      adminStatusToken: env.ADMIN_STATUS_TOKEN,
      dashboardPublicKey: env.DASHBOARD_API_PUBLIC_KEY ?? defaultDashboardPublicKey
    });
    logger.info("Threadwise is running with Telegram webhooks.", {
      webhookUrl,
      botUsername: bot.botInfo.username,
      allowedUpdates: webhookInfo.allowed_updates,
      pendingUpdates: webhookInfo.pending_update_count,
      lastWebhookError: webhookInfo.last_error_message
    });
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
