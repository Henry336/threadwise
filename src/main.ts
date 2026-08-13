import { beaconConfig, env } from "./config/env";
import { createHash } from "node:crypto";
import { createAiProvider } from "./ai";
import { createThreadwiseBot } from "./bot";
import { defaultDashboardPublicKey } from "./dashboard/publicKey";
import { prisma } from "./db/prisma";
import { logger } from "./logger";
import { startReminderLoop } from "./services/reminders";
import { startNoteCaptureExpiryLoop } from "./services/noteCaptureSessions";
import { startServer } from "./server";
import { startCodexDeliveryLoop } from "./bot/codex";
import { startGeminiIdeaDeliveryLoop } from "./bot/geminiIdeas";
import { startFileCourierDeliveryLoop } from "./bot/files";
import { startVoiceCaptureRecoveryLoop } from "./bot/voiceCapture";
import { startStudyCanvasSyncLoop } from "./services/studyCanvas";
import { startStudyNoteCaptureExpiryLoop } from "./services/studyResources";
import { startStudyCaptureBatchLoop } from "./services/studyCaptureBatches";
import { seedStudySmokeTestIfRequested } from "./services/studySmokeSeed";
import { createBeaconBot, startBeaconCleanupLoop } from "./community";
import { registerBeaconCommandMenus, registerThreadwiseCommandMenus } from "./bot/commandMenus";

async function main() {
  const ai = createAiProvider();
  const bot = createThreadwiseBot(env.TELEGRAM_BOT_TOKEN, ai);
  const beacon = beaconConfig();
  const beaconBot = beacon && env.BEACON_BOT_TOKEN
    ? await createBeaconBot(env.BEACON_BOT_TOKEN, beacon)
    : undefined;
  const beaconWebhookSecret = beaconBot && env.BEACON_BOT_TOKEN
    ? createHash("sha256").update(`threadwise-beacon:${env.BEACON_BOT_TOKEN}`).digest("hex")
    : undefined;
  await seedStudySmokeTestIfRequested();
  const beaconCleanupLoop = beaconBot ? startBeaconCleanupLoop() : undefined;
  const reminderLoop = startReminderLoop(bot, env.REMINDER_POLL_MS);
  const noteCaptureLoop = startNoteCaptureExpiryLoop(bot);
  const codexDeliveryLoop = startCodexDeliveryLoop(bot);
  const geminiIdeaDeliveryLoop = startGeminiIdeaDeliveryLoop(bot);
  const fileCourierDeliveryLoop = startFileCourierDeliveryLoop(bot);
  const voiceCaptureLoop = startVoiceCaptureRecoveryLoop(bot, ai, env.TELEGRAM_BOT_TOKEN);
  const studyCanvasSyncLoop = startStudyCanvasSyncLoop();
  const studyNoteCaptureLoop = startStudyNoteCaptureExpiryLoop(bot);
  const studyCaptureBatchLoop = startStudyCaptureBatchLoop(bot);
  let server: Awaited<ReturnType<typeof startServer>> | undefined;

  const shutdown = async (signal: string) => {
    logger.info("Shutting down Threadwise.", { signal });
    clearInterval(reminderLoop);
    clearInterval(noteCaptureLoop);
    if (codexDeliveryLoop) clearInterval(codexDeliveryLoop);
    if (geminiIdeaDeliveryLoop) clearInterval(geminiIdeaDeliveryLoop);
    if (fileCourierDeliveryLoop) clearInterval(fileCourierDeliveryLoop);
    clearInterval(voiceCaptureLoop);
    clearInterval(studyCanvasSyncLoop);
    clearInterval(studyNoteCaptureLoop);
    clearInterval(studyCaptureBatchLoop);
    if (beaconCleanupLoop) clearInterval(beaconCleanupLoop);
    await server?.close();
    await bot.stop();
    await beaconBot?.stop();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  if (env.WEBHOOK_URL) {
    await bot.init();
    await beaconBot?.init();
    await registerThreadwiseCommandMenus(bot);
    if (beaconBot && beacon) await registerBeaconCommandMenus(beaconBot, beacon);
    const webhookUrl = `${env.WEBHOOK_URL.replace(/\/$/, "")}${env.WEBHOOK_SECRET_PATH}`;
    await bot.api.setWebhook(webhookUrl, { allowed_updates: ["message", "callback_query", "my_chat_member", "chat_member"] });
    const beaconWebhookUrl = beaconBot && beacon
      ? `${env.WEBHOOK_URL.replace(/\/$/, "")}${beacon.webhookPath}`
      : undefined;
    if (beaconBot && beaconWebhookUrl) {
      await beaconBot.api.setWebhook(beaconWebhookUrl, {
        allowed_updates: ["message", "callback_query", "my_chat_member", "chat_member"],
        secret_token: beaconWebhookSecret
      });
    }
    const webhookInfo = await bot.api.getWebhookInfo();
    server = await startServer(bot, ai, {
      port: env.PORT,
      webhookPath: env.WEBHOOK_SECRET_PATH,
      adminStatusToken: env.ADMIN_STATUS_TOKEN,
      // Keep production trust anchored to the reviewed public key in source.
      // A stale multiline Render value must never shadow it.
      dashboardPublicKey: defaultDashboardPublicKey,
      telegramBotToken: env.TELEGRAM_BOT_TOKEN,
      beaconBot,
      beaconWebhookPath: beacon?.webhookPath,
      beaconWebhookSecret
    });
    logger.info("Threadwise is running with Telegram webhooks.", {
      webhookUrl,
      botUsername: bot.botInfo.username,
      allowedUpdates: webhookInfo.allowed_updates,
      pendingUpdates: webhookInfo.pending_update_count,
      lastWebhookError: webhookInfo.last_error_message
    });
    if (beaconBot) {
      const beaconWebhookInfo = await beaconBot.api.getWebhookInfo();
      logger.info("Beacon is running with Telegram webhooks.", {
        webhookPath: beacon?.webhookPath,
        botUsername: beaconBot.botInfo.username,
        pendingUpdates: beaconWebhookInfo.pending_update_count,
        lastWebhookError: beaconWebhookInfo.last_error_message
      });
    }
  } else {
    await bot.init();
    await beaconBot?.init();
    await registerThreadwiseCommandMenus(bot);
    if (beaconBot && beacon) await registerBeaconCommandMenus(beaconBot, beacon);
    await bot.api.deleteWebhook();
    await beaconBot?.api.deleteWebhook();
    void bot.start({
      onStart: () => logger.info("Threadwise is running with Telegram long polling.")
    });
    if (beaconBot) {
      void beaconBot.start({
        onStart: () => logger.info("Beacon is running with Telegram long polling.")
      });
    }
    logger.info("Threadwise is running with Telegram long polling.");
  }
}

main().catch(async (error) => {
  logger.error("Threadwise failed to start.", { error: String(error) });
  await prisma.$disconnect();
  process.exit(1);
});
