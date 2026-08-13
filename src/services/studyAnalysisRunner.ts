import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { env } from "../config/env";
import { logger } from "../logger";
import {
  claimStudyAnalysisJob,
  completeStudyAnalysisJob,
  failStudyAnalysisJob,
} from "./studyAnalysis";
import { generateOpenAiStudyAnalysis, openAiStudyApiConfigured, openAiStudyFailureMetadata } from "./openAiStudyApi";

const SERVER_WORKER_ID = `study-api:${hostname()}:${process.pid}:${randomUUID()}`;
let passInFlight: Promise<boolean> | undefined;

export function startStudyAnalysisLoop(pollMs = env.STUDY_ANALYSIS_POLL_MS): NodeJS.Timeout | undefined {
  if (!openAiStudyApiConfigured()) {
    logger.info("Server-side Study analysis is disabled because OPENAI_API_KEY is not configured.");
    return undefined;
  }
  triggerPass();
  const timer = setInterval(triggerPass, pollMs);
  timer.unref?.();
  return timer;
}

function triggerPass(): void {
  void runStudyAnalysisPass().catch((error) => {
    logger.error("Study analysis queue pass failed.", { error: String(error) });
  });
}

export function runStudyAnalysisPass(): Promise<boolean> {
  if (passInFlight) return passInFlight;
  passInFlight = executePass().finally(() => {
    passInFlight = undefined;
  });
  return passInFlight;
}

async function executePass(): Promise<boolean> {
  if (!openAiStudyApiConfigured()) return false;
  const job = await claimStudyAnalysisJob(SERVER_WORKER_ID, env.STUDY_ANALYSIS_LEASE_SECONDS);
  if (!job) return false;
  try {
    const generated = await generateOpenAiStudyAnalysis(job.prompt);
    const completed = await completeStudyAnalysisJob({
      id: job.id,
      workerId: SERVER_WORKER_ID,
      finalResponse: generated.text,
      model: generated.model,
    });
    if (!completed) logger.warn("Study analysis completed after its lease was no longer owned.", { jobId: job.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The analysis service failed.";
    const provider = openAiStudyFailureMetadata(error);
    await failStudyAnalysisJob({ id: job.id, workerId: SERVER_WORKER_ID, error: message, model: job.model ?? undefined });
    logger.warn("Server-side Study analysis failed.", { jobId: job.id, error: message, ...provider });
  }
  return true;
}
