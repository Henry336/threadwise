import Tesseract from "tesseract.js";
import sharp from "sharp";
import os from "os";
import path from "path";
import { prisma } from "../db/prisma";
import { logger } from "../logger";

const englishLanguageData = require("@tesseract.js-data/eng") as { langPath: string };

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 20_000_000;
const OCR_TIMEOUT_MS = 60_000;

let workerPromise: Promise<Tesseract.Worker> | undefined;
let queue: Promise<void> = Promise.resolve();

export type ImageIntent = "note" | "task" | "reminder" | "expense" | "extract";

export async function extractTextFromImage(input: Buffer): Promise<{ text: string; confidence: number }> {
  if (input.length > MAX_IMAGE_BYTES) {
    throw new Error("That image is larger than 10 MB. Send a smaller or compressed image.");
  }

  return enqueue(async () => {
    const prepared = await sharp(input, { failOn: "warning", limitInputPixels: MAX_IMAGE_PIXELS })
      .rotate()
      .resize({ width: 2200, height: 2200, fit: "inside", withoutEnlargement: true })
      .grayscale()
      .normalise()
      .sharpen()
      .png()
      .toBuffer();

    const worker = await getWorker();
    try {
      const result = await withTimeout(worker.recognize(prepared), OCR_TIMEOUT_MS);
      const text = normalizeExtractedText(result.data.text);
      if (text.length < 2) {
        throw new Error("I couldn't find readable text in that image. Try a clearer, straighter photo with better lighting.");
      }
      return { text, confidence: result.data.confidence };
    } catch (error) {
      if (error instanceof Error && error.message === "OCR timed out") {
        await resetWorker();
      }
      throw error;
    }
  });
}

export function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function parseImageCaptionIntent(caption: string): ImageIntent {
  const text = caption.toLowerCase().trim();
  if (/\b(?:expense|receipt|purchase|spending|spent|paid|reimburse)\b/.test(text)) return "expense";
  if (/\b(?:remind|reminder|nudge|don't forget|do not forget)\b/.test(text)) return "reminder";
  if (/\b(?:task|todo|to-do|action item|something to do)\b/.test(text)) return "task";
  if (/\b(?:note|notes|remember this|save this|keep this|store this)\b/.test(text)) return "note";
  return "extract";
}

export async function createPendingImageCapture(input: {
  userId: string;
  extractedText: string;
  caption?: string;
  telegramFileId?: string;
  telegramUniqueId?: string;
  confidence?: number;
  awaitingAction?: string;
}) {
  return prisma.pendingImageCapture.create({
    data: {
      ...input,
      expiresAt: new Date(Date.now() + 24 * 60 * 60_000)
    }
  });
}

export async function findPendingImageCapture(userId: string, pendingId: string) {
  return prisma.pendingImageCapture.findFirstOrThrow({
    where: { id: pendingId, userId, expiresAt: { gt: new Date() } }
  });
}

export async function consumePendingImageCapture(userId: string, pendingId: string) {
  const pending = await findPendingImageCapture(userId, pendingId);
  await prisma.pendingImageCapture.delete({ where: { id: pending.id } });
  return pending;
}

export async function discardPendingImageCapture(userId: string, pendingId: string) {
  await prisma.pendingImageCapture.deleteMany({ where: { id: pendingId, userId } });
}

export async function awaitImageReminderTime(userId: string, pendingId: string) {
  const pending = await findPendingImageCapture(userId, pendingId);
  return prisma.pendingImageCapture.update({ where: { id: pending.id }, data: { awaitingAction: "reminder-time" } });
}

export async function findPendingImageReminder(userId: string) {
  return prisma.pendingImageCapture.findFirst({
    where: { userId, awaitingAction: "reminder-time", expiresAt: { gt: new Date() } },
    orderBy: { updatedAt: "desc" }
  });
}

async function getWorker(): Promise<Tesseract.Worker> {
  workerPromise ??= Tesseract.createWorker("eng", undefined, {
    langPath: englishLanguageData.langPath,
    cachePath: path.join(os.tmpdir(), "threadwise-tesseract"),
    logger: (message) => {
      if (message.status === "recognizing text" && message.progress === 1) {
        logger.info("Local image OCR completed.");
      }
    }
  });
  return workerPromise;
}

async function resetWorker(): Promise<void> {
  const current = workerPromise;
  workerPromise = undefined;
  if (current) {
    try {
      await (await current).terminate();
    } catch {
      // The worker is already unusable; the next request will create a fresh one.
    }
  }
}

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const job = queue.then(operation, operation);
  queue = job.then(() => undefined, () => undefined);
  return job;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("OCR timed out")), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
