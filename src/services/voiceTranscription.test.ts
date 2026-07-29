import { Prisma, VoiceCleanupMode, VoiceTranscriptionStatus, type VoiceTranscriptionJob } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  canUndoVoiceJob,
  isSupportedVoiceMedia,
  isVoiceJobContext,
  isVoiceLeaseClaimable,
  normalizeTranscriptionModel,
  prepareVoiceNoteText,
  queueVoiceTranscription,
  rawTranscriptPage,
  transcribeWithValidation,
  validateConservativeCleanup,
  voiceFileSizeError,
  voiceJobUniqueWhere,
  type VoiceProvider
} from "./voiceTranscription";

function provider(overrides: Partial<VoiceProvider> = {}): VoiceProvider {
  return {
    transcribe: vi.fn(async () => "raw transcript"),
    cleanup: vi.fn(async (raw) => raw),
    ...overrides
  };
}

describe("voice note Capture", () => {
  it("recognizes OpenAI-supported audio formats and rejects unsupported documents", () => {
    expect(isSupportedVoiceMedia({ sourceKind: "VOICE", mimeType: "audio/ogg" })).toBe(true);
    expect(isSupportedVoiceMedia({ sourceKind: "AUDIO", fileName: "meeting.m4a" })).toBe(true);
    expect(isSupportedVoiceMedia({ sourceKind: "AUDIO", mimeType: "audio/webm" })).toBe(true);
    expect(isSupportedVoiceMedia({ sourceKind: "AUDIO", fileName: "notes.txt", mimeType: "text/plain" })).toBe(false);
  });

  it("rejects oversized files using the configured boundary", () => {
    expect(voiceFileSizeError(20_000_000, 20_000_000)).toBeUndefined();
    expect(voiceFileSizeError(20_000_001, 20_000_000)).toContain("above the configured 20 MB");
  });

  it("preserves mixed-language speech and all numbers during valid light cleanup", async () => {
    const raw = "Okay so meet me at 5:30. မနက်ဖြန်တွေ့မယ်. Budget 2500.";
    const cleaned = "Okay, so meet me at 5:30.\n\nမနက်ဖြန်တွေ့မယ်. Budget 2500.";
    expect(validateConservativeCleanup(raw, cleaned)).toBeUndefined();
    await expect(prepareVoiceNoteText(raw, VoiceCleanupMode.LIGHT, async () => cleaned))
      .resolves.toEqual({ cleanedText: cleaned });
  });

  it("falls back to the exact raw transcript when cleanup fails or changes a number", async () => {
    const raw = "Book it for 15 people at 7.";
    await expect(prepareVoiceNoteText(raw, VoiceCleanupMode.LIGHT, async () => {
      throw new Error("cleanup API unavailable");
    })).resolves.toMatchObject({ cleanedText: raw, cleanupError: expect.stringContaining("cleanup API unavailable") });

    await expect(prepareVoiceNoteText(raw, VoiceCleanupMode.LIGHT, async () => "Book it for 50 people at 7."))
      .resolves.toMatchObject({ cleanedText: raw, cleanupError: expect.stringContaining("changed a number") });
  });

  it("rejects invented or reordered wording even when cleanup length looks plausible", () => {
    expect(validateConservativeCleanup(
      "We should review the launch plan tomorrow.",
      "We should approve the launch plan tomorrow."
    )).toContain("introduced or reordered wording");
    expect(validateConservativeCleanup(
      "First review the plan, then send it.",
      "Then send it, first review the plan."
    )).toContain("introduced or reordered wording");
  });

  it("rejects silent summarization that omits too much original wording", () => {
    expect(validateConservativeCleanup(
      "We should review the plan with QA UX HR IT and legal tomorrow.",
      "We should review the plan with QA UX tomorrow."
    )).toContain("removed too much wording");
  });

  it("never calls cleanup in user-selected verbatim mode", async () => {
    const cleanup = vi.fn(async () => "changed");
    await expect(prepareVoiceNoteText("um exact words", VoiceCleanupMode.VERBATIM, cleanup))
      .resolves.toEqual({ cleanedText: "um exact words" });
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("propagates transcription API failure and rejects empty API output", async () => {
    await expect(transcribeWithValidation(provider({
      transcribe: vi.fn(async () => { throw new Error("OpenAI unavailable"); })
    }), {
      bytes: Buffer.from("audio"),
      fileName: "voice.ogg",
      model: "gpt-4o-mini-transcribe"
    })).rejects.toThrow("OpenAI unavailable");

    await expect(transcribeWithValidation(provider({
      transcribe: vi.fn(async () => "   ")
    }), {
      bytes: Buffer.from("audio"),
      fileName: "voice.ogg",
      model: "gpt-4o-mini-transcribe"
    })).rejects.toThrow("empty transcript");
  });

  it("paginates long raw transcripts without losing or changing a character", () => {
    const raw = "A".repeat(3199) + "😀" + "C".repeat(300) + "\nမြန်မာ" + "B".repeat(3500);
    const first = rawTranscriptPage(raw, 1, 3200);
    const second = rawTranscriptPage(raw, 2, 3200);
    const third = rawTranscriptPage(raw, 3, 3200);
    expect(first.text + second.text + third.text).toBe(raw);
    expect(third.totalPages).toBe(3);
  });

  it("uses durable update identity to make duplicate Telegram deliveries idempotent", () => {
    expect(voiceJobUniqueWhere("-5138765531", 42)).toEqual({
      telegramChatId_telegramMessageId: {
        telegramChatId: "-5138765531",
        telegramMessageId: 42
      }
    });
  });

  it("returns the existing durable job when Telegram retries the same message", async () => {
    const existing = { id: "existing-job" } as VoiceTranscriptionJob;
    const create = vi.fn(async () => {
      throw new Prisma.PrismaClientKnownRequestError("duplicate", {
        code: "P2002",
        clientVersion: "test"
      });
    });
    const findUniqueOrThrow = vi.fn(async () => existing);
    const database = { voiceTranscriptionJob: { create, findUniqueOrThrow } };

    await expect(queueVoiceTranscription({
      userId: "user-1",
      requesterTelegramId: "5969845149",
      telegramChatId: "-5138765531",
      telegramMessageId: 42,
      telegramFileId: "file-1",
      sourceKind: "VOICE",
      cleanupMode: VoiceCleanupMode.LIGHT,
      transcriptionModel: "gpt-4o-mini-transcribe"
    }, database as never)).resolves.toEqual({ job: existing, created: false });

    expect(findUniqueOrThrow).toHaveBeenCalledWith({
      where: voiceJobUniqueWhere("-5138765531", 42)
    });
  });

  it("recovers an expired processing lease after restart but not a live one", () => {
    const now = new Date("2026-07-30T00:00:00.000Z");
    expect(isVoiceLeaseClaimable(VoiceTranscriptionStatus.PENDING, null, now)).toBe(true);
    expect(isVoiceLeaseClaimable(VoiceTranscriptionStatus.PROCESSING, new Date(now.getTime() - 1), now)).toBe(true);
    expect(isVoiceLeaseClaimable(VoiceTranscriptionStatus.PROCESSING, new Date(now.getTime() + 1), now)).toBe(false);
    expect(isVoiceLeaseClaimable(VoiceTranscriptionStatus.COMPLETED, null, now)).toBe(false);
  });

  it("scopes group transcript controls to the exact workspace user and chat", () => {
    const job = { userId: "group-workspace-user", telegramChatId: "-100123" };
    expect(isVoiceJobContext(job, "group-workspace-user", "-100123")).toBe(true);
    expect(isVoiceJobContext(job, "other-user", "-100123")).toBe(false);
    expect(isVoiceJobContext(job, "group-workspace-user", "-100999")).toBe(false);
  });

  it("only allows undo for a completed job with a saved note", () => {
    expect(canUndoVoiceJob({ status: VoiceTranscriptionStatus.COMPLETED, cleanedNoteId: "note-1" })).toBe(true);
    expect(canUndoVoiceJob({ status: VoiceTranscriptionStatus.UNDONE, cleanedNoteId: "note-1" })).toBe(false);
    expect(canUndoVoiceJob({ status: VoiceTranscriptionStatus.COMPLETED, cleanedNoteId: null })).toBe(false);
  });

  it("supports the configured fast and higher-accuracy model aliases", () => {
    expect(normalizeTranscriptionModel("fast")).toBe("gpt-4o-mini-transcribe");
    expect(normalizeTranscriptionModel("accuracy")).toBe("gpt-4o-transcribe");
    expect(normalizeTranscriptionModel("unknown")).toBeUndefined();
  });
});
