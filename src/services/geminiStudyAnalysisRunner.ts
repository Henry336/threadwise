import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { env } from "../config/env";
import { logger } from "../logger";
import {
  claimGeminiStudyAnalysisJob,
  completeGeminiStudyAnalysisJob,
  failGeminiStudyAnalysisJob,
} from "./geminiStudyAnalysis";
import { generateGeminiStudyAnalysis, geminiStudyApiConfigured } from "./geminiStudyApi";

const SERVER_WORKER_ID = `study-api:${hostname()}:${process.pid}:${randomUUID()}`;
let passInFlight: Promise<boolean> | undefined;

export function startGeminiStudyAnalysisLoop(pollMs = env.GEMINI_STUDY_POLL_MS): NodeJS.Timeout | undefined {
  if (!geminiStudyApiConfigured()) {
    logger.info("Server-side Gemini Study analysis is disabled because GEMINI_API_KEY is not configured.");
    return undefined;
  }
  triggerPass();
  const timer = setInterval(triggerPass, pollMs);
  timer.unref?.();
  return timer;
}

function triggerPass(): void {
  void runGeminiStudyAnalysisPass().catch((error) => {
    logger.error("Gemini Study analysis queue pass failed.", { error: String(error) });
  });
}

export function runGeminiStudyAnalysisPass(): Promise<boolean> {
  if (passInFlight) return passInFlight;
  passInFlight = executePass().finally(() => {
    passInFlight = undefined;
  });
  return passInFlight;
}

async function executePass(): Promise<boolean> {
  if (!geminiStudyApiConfigured()) return false;
  const job = await claimGeminiStudyAnalysisJob(SERVER_WORKER_ID, env.GEMINI_STUDY_LEASE_SECONDS);
  if (!job) return false;
  try {
    const generated = await generateGeminiStudyAnalysis(job.prompt);
    const completed = await completeGeminiStudyAnalysisJob({
      id: job.id,
      workerId: SERVER_WORKER_ID,
      finalResponse: generated.text,
      model: generated.model,
    });
    if (!completed) logger.warn("Gemini Study analysis completed after its lease was no longer owned.", { jobId: job.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The analysis service failed.";
    await failGeminiStudyAnalysisJob({ id: job.id, workerId: SERVER_WORKER_ID, error: message, model: job.model ?? undefined });
    logger.warn("Server-side Gemini Study analysis failed.", { jobId: job.id, error: message });
  }
  return true;
}
