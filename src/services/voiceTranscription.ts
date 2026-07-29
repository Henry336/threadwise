import { hostname } from "node:os";
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import {
  Prisma,
  VoiceCleanupMode,
  VoiceTranscriptionStatus,
  type VoiceTranscriptionJob
} from "@prisma/client";
import type { Api } from "grammy";
import type { AiProvider } from "../ai/types";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { logger } from "../logger";
import { nextPublicId } from "./publicIds";
import { recordCreateUndo } from "./undo";

export const TRANSCRIPTION_MODELS = [
  "gpt-4o-mini-transcribe",
  "gpt-4o-transcribe"
] as const;

export type TranscriptionModel = typeof TRANSCRIPTION_MODELS[number];
export type VoiceMedia = {
  telegramFileId: string;
  telegramFileUniqueId?: string;
  sourceKind: "VOICE" | "AUDIO";
  durationSeconds?: number;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
};

export type VoiceQueueInput = VoiceMedia & {
  userId: string;
  requesterTelegramId: string;
  telegramChatId: string;
  telegramMessageId: number;
  cleanupMode: VoiceCleanupMode;
  transcriptionModel: string;
  languageHint?: string;
};

export interface VoiceProvider {
  transcribe(input: {
    bytes: Buffer;
    fileName: string;
    mimeType?: string;
    model: TranscriptionModel;
    languageHint?: string;
  }): Promise<string>;
  cleanup(rawTranscript: string): Promise<string>;
}

export class OpenAiVoiceProvider implements VoiceProvider {
  private readonly client: OpenAI;

  constructor(apiKey = env.OPENAI_API_KEY) {
    if (!apiKey) throw new Error("OPENAI_API_KEY is required for voice transcription.");
    this.client = new OpenAI({ apiKey });
  }

  async transcribe(input: {
    bytes: Buffer;
    fileName: string;
    mimeType?: string;
    model: TranscriptionModel;
    languageHint?: string;
  }): Promise<string> {
    const file = await toFile(input.bytes, input.fileName, input.mimeType ? { type: input.mimeType } : undefined);
    const response = await this.client.audio.transcriptions.create({
      file,
      model: input.model,
      response_format: "json",
      language: input.languageHint
    });
    return response.text;
  }

  async cleanup(rawTranscript: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content: [
            "Lightly clean a voice-note transcript without changing its meaning.",
            "Only add punctuation and paragraph breaks, and remove obvious filler words or immediately repeated false starts.",
            "Do not summarize, translate, reorder, infer, add facts, or silently omit substantive wording.",
            "Preserve mixed languages, names, numbers, uncertainty, tone, and the speaker's first-person wording.",
            "Return only the cleaned note text."
          ].join(" ")
        },
        { role: "user", content: rawTranscript }
      ]
    });
    return response.choices[0]?.message.content ?? "";
  }
}

export function normalizeTranscriptionModel(value: string): TranscriptionModel | undefined {
  const normalized = value.trim().toLowerCase();
  if (["fast", "mini", TRANSCRIPTION_MODELS[0]].includes(normalized)) return TRANSCRIPTION_MODELS[0];
  if (["accurate", "accuracy", "high", TRANSCRIPTION_MODELS[1]].includes(normalized)) return TRANSCRIPTION_MODELS[1];
  return undefined;
}

const SUPPORTED_EXTENSIONS = new Set(["flac", "mp3", "mp4", "mpeg", "mpga", "m4a", "ogg", "wav", "webm"]);
const SUPPORTED_MIME_TYPES = new Set([
  "audio/flac",
  "audio/mpeg",
  "audio/mp4",
  "audio/mp4a-latm",
  "audio/x-m4a",
  "audio/ogg",
  "application/ogg",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "video/mp4",
  "video/webm"
]);

export function isSupportedVoiceMedia(media: Pick<VoiceMedia, "sourceKind" | "mimeType" | "fileName">): boolean {
  if (media.sourceKind === "VOICE") return !media.mimeType || SUPPORTED_MIME_TYPES.has(media.mimeType.toLowerCase());
  const mime = media.mimeType?.toLowerCase();
  if (mime && SUPPORTED_MIME_TYPES.has(mime)) return true;
  const extension = media.fileName?.split(".").pop()?.toLowerCase();
  return Boolean(extension && SUPPORTED_EXTENSIONS.has(extension));
}

export function voiceFileSizeError(fileSize?: number, maxBytes = env.VOICE_TRANSCRIPTION_MAX_BYTES): string | undefined {
  if (fileSize !== undefined && fileSize > maxBytes) {
    return `This audio is ${formatMegabytes(fileSize)}, above the configured ${formatMegabytes(maxBytes)} transcription limit.`;
  }
  return undefined;
}

export async function queueVoiceTranscription(
  input: VoiceQueueInput,
  database: Pick<typeof prisma, "voiceTranscriptionJob"> = prisma
): Promise<{ job: VoiceTranscriptionJob; created: boolean }> {
  try {
    const job = await database.voiceTranscriptionJob.create({
      data: {
        ...input,
        languageHint: input.languageHint || null,
        status: VoiceTranscriptionStatus.PENDING
      }
    });
    return { job, created: true };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const job = await database.voiceTranscriptionJob.findUniqueOrThrow({
      where: voiceJobUniqueWhere(input.telegramChatId, input.telegramMessageId)
    });
    return { job, created: false };
  }
}

export async function saveVoiceAcknowledgement(jobId: string, messageId: number): Promise<void> {
  await prisma.voiceTranscriptionJob.update({
    where: { id: jobId },
    data: { acknowledgementMessageId: messageId }
  });
}

export function isVoiceLeaseClaimable(status: VoiceTranscriptionStatus, leaseExpiresAt: Date | null, now = new Date()): boolean {
  return status === VoiceTranscriptionStatus.PENDING
    || (status === VoiceTranscriptionStatus.PROCESSING && (!leaseExpiresAt || leaseExpiresAt <= now));
}

export async function processVoiceTranscription(
  jobId: string,
  api: Api,
  botToken: string,
  ai: AiProvider,
  providerFactory: () => VoiceProvider = () => new OpenAiVoiceProvider()
): Promise<void> {
  const processorId = `${hostname()}-${process.pid}`;
  const job = await claimVoiceJob(jobId, processorId);
  if (!job) return;

  const heartbeat = setInterval(() => {
    void renewVoiceLease(job.id, processorId).catch((error) => {
      logger.warn("Could not renew voice transcription lease.", { jobId: job.id, error: String(error) });
    });
  }, Math.max(30_000, Math.floor(env.VOICE_TRANSCRIPTION_LEASE_SECONDS * 500)));

  try {
    let rawTranscript = job.rawTranscript;
    const provider = providerFactory();
    if (rawTranscript === null) {
      const bytes = await downloadTelegramAudio(api, botToken, job.telegramFileId, job.fileSize ?? undefined);
      rawTranscript = await transcribeWithValidation(provider, {
        bytes,
        fileName: transcriptionFileName(job.fileName, job.mimeType),
        mimeType: job.mimeType ?? undefined,
        model: normalizeTranscriptionModel(job.transcriptionModel) ?? TRANSCRIPTION_MODELS[0],
        languageHint: job.languageHint ?? undefined
      });
      await prisma.voiceTranscriptionJob.update({
        where: { id: job.id },
        data: { rawTranscript, transcribedAt: new Date() }
      });
    }

    const prepared = job.cleanedText !== null
      ? { cleanedText: job.cleanedText, cleanupError: job.cleanupError ?? undefined }
      : await prepareVoiceNoteText(rawTranscript, job.cleanupMode, (text) => provider.cleanup(text));
    if (job.cleanedText === null) {
      await prisma.voiceTranscriptionJob.update({
        where: { id: job.id },
        data: {
          cleanedText: prepared.cleanedText,
          cleanupError: prepared.cleanupError
        }
      });
    }
    const embedding = await ai.embed(`${voiceNoteTitle(prepared.cleanedText)}\n${prepared.cleanedText}\n${rawTranscript}`)
      .catch((error) => {
        logger.warn("Voice note embedding failed; saving the note without an embedding.", { jobId: job.id, error: String(error) });
        return undefined;
      });

    await completeVoiceJob(job.id, rawTranscript, prepared.cleanedText, prepared.cleanupError, embedding);
  } catch (error) {
    await failVoiceJob(job.id, error);
  } finally {
    clearInterval(heartbeat);
  }
}

export async function transcribeWithValidation(
  provider: VoiceProvider,
  input: Parameters<VoiceProvider["transcribe"]>[0]
): Promise<string> {
  const transcript = await provider.transcribe(input);
  if (!transcript.trim()) throw new Error("The transcription API returned an empty transcript.");
  return transcript;
}

export async function processRecoverableVoiceTranscriptions(
  api: Api,
  botToken: string,
  ai: AiProvider
): Promise<void> {
  const now = new Date();
  const job = await prisma.voiceTranscriptionJob.findFirst({
    where: {
      OR: [
        { status: VoiceTranscriptionStatus.PENDING },
        { status: VoiceTranscriptionStatus.PROCESSING, leaseExpiresAt: { lte: now } }
      ]
    },
    orderBy: { createdAt: "asc" }
  });
  if (job) await processVoiceTranscription(job.id, api, botToken, ai);
}

export async function prepareVoiceNoteText(
  rawTranscript: string,
  mode: VoiceCleanupMode,
  cleanup: (raw: string) => Promise<string>
): Promise<{ cleanedText: string; cleanupError?: string }> {
  if (mode === VoiceCleanupMode.VERBATIM) return { cleanedText: rawTranscript };
  try {
    const candidate = await cleanup(rawTranscript);
    const validationError = validateConservativeCleanup(rawTranscript, candidate);
    return validationError
      ? { cleanedText: rawTranscript, cleanupError: validationError }
      : { cleanedText: candidate };
  } catch (error) {
    return { cleanedText: rawTranscript, cleanupError: `Cleanup failed; saved verbatim: ${safeError(error)}` };
  }
}

export function validateConservativeCleanup(raw: string, cleaned: string): string | undefined {
  if (!cleaned.trim()) return "Cleanup returned empty text; saved verbatim.";
  const ratio = cleaned.length / Math.max(1, raw.length);
  if (ratio < 0.55 || ratio > 1.35) return "Cleanup changed the transcript length too much; saved verbatim.";
  const rawNumbers = raw.match(/\p{N}+(?:[.,:/-]\p{N}+)*/gu) ?? [];
  const cleanedNumbers = cleaned.match(/\p{N}+(?:[.,:/-]\p{N}+)*/gu) ?? [];
  if (rawNumbers.join("|") !== cleanedNumbers.join("|")) return "Cleanup changed a number; saved verbatim.";
  const rawTokens = lexicalTokens(raw);
  const cleanedTokens = lexicalTokens(cleaned);
  if (cleanedTokens.length < rawTokens.length * 0.75) {
    return "Cleanup removed too much wording; saved verbatim.";
  }
  let rawIndex = 0;
  for (const token of cleanedTokens) {
    while (rawIndex < rawTokens.length && rawTokens[rawIndex] !== token) rawIndex += 1;
    if (rawIndex >= rawTokens.length) return "Cleanup introduced or reordered wording; saved verbatim.";
    rawIndex += 1;
  }
  return undefined;
}

export function rawTranscriptPage(raw: string, page: number, pageSize = 3200): {
  text: string;
  page: number;
  totalPages: number;
} {
  const chunks = splitUnicodeSafe(raw, pageSize);
  const totalPages = chunks.length;
  const safePage = Math.min(totalPages, Math.max(1, page));
  return {
    text: chunks[safePage - 1] ?? "",
    page: safePage,
    totalPages
  };
}

export async function findVoiceJobForContext(jobId: string, userId: string, telegramChatId: string) {
  return prisma.voiceTranscriptionJob.findFirst({
    where: { id: jobId, userId, telegramChatId },
    include: { cleanedNote: true }
  });
}

export function isVoiceJobContext(
  job: Pick<VoiceTranscriptionJob, "userId" | "telegramChatId">,
  userId: string,
  telegramChatId: string
): boolean {
  return job.userId === userId && job.telegramChatId === telegramChatId;
}

export function voiceJobUniqueWhere(telegramChatId: string, telegramMessageId: number) {
  return {
    telegramChatId_telegramMessageId: {
      telegramChatId,
      telegramMessageId
    }
  };
}

export function canUndoVoiceJob(
  job: Pick<VoiceTranscriptionJob, "status" | "cleanedNoteId">
): boolean {
  return job.status === VoiceTranscriptionStatus.COMPLETED && Boolean(job.cleanedNoteId);
}

export async function keepVoiceNoteVerbatim(jobId: string, userId: string, telegramChatId: string) {
  const job = await findVoiceJobForContext(jobId, userId, telegramChatId);
  if (!job?.rawTranscript || !job.cleanedNoteId || job.status === VoiceTranscriptionStatus.UNDONE) return undefined;
  const note = await prisma.note.update({
    where: { id: job.cleanedNoteId, userId },
    data: {
      title: voiceNoteTitle(job.rawTranscript),
      body: job.rawTranscript,
      summary: voiceNoteSummary(job.rawTranscript),
      sourceText: job.rawTranscript
    }
  });
  await prisma.voiceTranscriptionJob.update({
    where: { id: job.id },
    data: {
      cleanupMode: VoiceCleanupMode.VERBATIM,
      cleanedText: job.rawTranscript,
      cleanupError: null
    }
  });
  return note;
}

export async function undoVoiceNote(jobId: string, userId: string, telegramChatId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const job = await tx.voiceTranscriptionJob.findFirst({
      where: { id: jobId, userId, telegramChatId, status: VoiceTranscriptionStatus.COMPLETED }
    });
    if (!job || !canUndoVoiceJob(job)) return false;
    const noteId = job.cleanedNoteId;
    if (!noteId) return false;
    await tx.note.update({
      where: { id: noteId, userId },
      data: { archivedAt: new Date(), archivedReason: "voice_capture_undo" }
    });
    await tx.voiceTranscriptionJob.update({
      where: { id: job.id },
      data: { status: VoiceTranscriptionStatus.UNDONE, undoneAt: new Date() }
    });
    return true;
  });
}

export async function undeliveredVoiceJobs() {
  return prisma.voiceTranscriptionJob.findMany({
    where: {
      status: { in: [VoiceTranscriptionStatus.COMPLETED, VoiceTranscriptionStatus.FAILED] },
      deliveredAt: null
    },
    include: { cleanedNote: true },
    orderBy: { completedAt: "asc" },
    take: 10
  });
}

export async function markVoiceJobDelivered(jobId: string, messageId: number): Promise<void> {
  await prisma.voiceTranscriptionJob.updateMany({
    where: { id: jobId, deliveredAt: null },
    data: { telegramResultMessageId: messageId, deliveredAt: new Date() }
  });
}

async function claimVoiceJob(jobId: string, processorId: string) {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + env.VOICE_TRANSCRIPTION_LEASE_SECONDS * 1_000);
  const claimed = await prisma.voiceTranscriptionJob.updateMany({
    where: {
      id: jobId,
      OR: [
        { status: VoiceTranscriptionStatus.PENDING },
        { status: VoiceTranscriptionStatus.PROCESSING, leaseExpiresAt: { lte: now } }
      ]
    },
    data: {
      status: VoiceTranscriptionStatus.PROCESSING,
      processorId,
      leaseExpiresAt,
      startedAt: now,
      error: null,
      attemptCount: { increment: 1 }
    }
  });
  return claimed.count === 1
    ? prisma.voiceTranscriptionJob.findUnique({ where: { id: jobId } })
    : undefined;
}

async function renewVoiceLease(jobId: string, processorId: string): Promise<void> {
  await prisma.voiceTranscriptionJob.updateMany({
    where: { id: jobId, processorId, status: VoiceTranscriptionStatus.PROCESSING },
    data: { leaseExpiresAt: new Date(Date.now() + env.VOICE_TRANSCRIPTION_LEASE_SECONDS * 1_000) }
  });
}

async function downloadTelegramAudio(api: Api, botToken: string, fileId: string, expectedSize?: number): Promise<Buffer> {
  const initialError = voiceFileSizeError(expectedSize);
  if (initialError) throw new Error(initialError);
  const file = await api.getFile(fileId);
  if (!file.file_path) throw new Error("Telegram did not provide a downloadable path for this audio.");
  const response = await fetch(`https://api.telegram.org/file/bot${botToken}/${file.file_path}`);
  if (!response.ok) throw new Error(`Telegram audio download failed (${response.status}).`);
  const contentLength = Number(response.headers.get("content-length"));
  const headerError = voiceFileSizeError(Number.isFinite(contentLength) ? contentLength : undefined);
  if (headerError) throw new Error(headerError);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actualError = voiceFileSizeError(bytes.length);
  if (actualError) throw new Error(actualError);
  return bytes;
}

async function completeVoiceJob(
  jobId: string,
  rawTranscript: string,
  cleanedText: string,
  cleanupError: string | undefined,
  embedding: number[] | undefined
): Promise<void> {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await prisma.$transaction(async (tx) => {
        const job = await tx.voiceTranscriptionJob.findUniqueOrThrow({ where: { id: jobId } });
        if (job.cleanedNoteId || job.status === VoiceTranscriptionStatus.COMPLETED) return;
        const publicId = await nextPublicId(job.userId, "NOTE", tx);
        const note = await tx.note.create({
          data: {
            userId: job.userId,
            publicId,
            title: voiceNoteTitle(cleanedText),
            body: cleanedText,
            summary: voiceNoteSummary(cleanedText),
            sourceText: rawTranscript,
            tags: ["voice-note"],
            embedding
          }
        });
        await recordCreateUndo(tx, job.userId, { kind: "note", id: note.id, publicId, title: note.title });
        await tx.voiceTranscriptionJob.update({
          where: { id: job.id },
          data: {
            status: VoiceTranscriptionStatus.COMPLETED,
            rawTranscript,
            cleanedText,
            cleanedNoteId: note.id,
            cleanupError,
            error: null,
            processorId: null,
            leaseExpiresAt: null,
            completedAt: new Date()
          }
        });
      });
      return;
    } catch (error) {
      const publicIdCollision = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
      if (!publicIdCollision || attempt === 5) throw error;
    }
  }
}

function lexicalTokens(text: string): string[] {
  return (text.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? []);
}

function splitUnicodeSafe(text: string, pageSize: number): string[] {
  if (!text.length) return [""];
  const chunks: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(text.length, offset + pageSize);
    const finalCodeUnit = text.charCodeAt(end - 1);
    if (end < text.length && finalCodeUnit >= 0xD800 && finalCodeUnit <= 0xDBFF) end -= 1;
    chunks.push(text.slice(offset, end));
    offset = end;
  }
  return chunks;
}

async function failVoiceJob(jobId: string, error: unknown): Promise<void> {
  const message = safeError(error);
  logger.error("Voice transcription failed.", { jobId, error: message });
  await prisma.voiceTranscriptionJob.update({
    where: { id: jobId },
    data: {
      status: VoiceTranscriptionStatus.FAILED,
      error: message,
      processorId: null,
      leaseExpiresAt: null,
      completedAt: new Date()
    }
  });
}

function transcriptionFileName(fileName: string | null, mimeType: string | null): string {
  if (fileName && isSupportedVoiceMedia({ sourceKind: "AUDIO", fileName, mimeType: mimeType ?? undefined })) return fileName;
  if (mimeType?.includes("webm")) return "voice.webm";
  if (mimeType?.includes("wav")) return "voice.wav";
  if (mimeType?.includes("mpeg")) return "voice.mp3";
  return "voice.ogg";
}

export function voiceNoteTitle(text: string): string {
  const first = text.split(/\r?\n|(?<=[.!?])\s+/u).map((part) => part.trim()).find(Boolean) ?? "Voice note";
  return first.length <= 80 ? first : `${first.slice(0, 77).trimEnd()}…`;
}

export function voiceNoteSummary(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= 180 ? compact : `${compact.slice(0, 177).trimEnd()}…`;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000);
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(bytes % 1_000_000 === 0 ? 0 : 1)} MB`;
}
