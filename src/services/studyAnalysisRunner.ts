/**
 * Background worker that runs queued Study analysis jobs on the server with OpenAI.
 * Started once from main.ts. Each pass leases one job from the database queue
 * (studyAnalysis.ts), sends its prompt to openAiStudyApi.ts, and stores the result or a
 * safe error. It replaced the older laptop-side Gemini CLI worker.
 */
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
import { startLoop, type StopLoop } from "../utils/loop";

/** Unique per process, so a job lease can only be completed by the process that claimed it. */
const SERVER_WORKER_ID = `study-api:${hostname()}:${process.pid}:${randomUUID()}`;
let passInFlight: Promise<boolean> | undefined;

/** Works through queued Study analysis jobs when the OpenAI key is configured. */
export function startStudyAnalysisLoop(pollMs = env.STUDY_ANALYSIS_POLL_MS): StopLoop | undefined {
  if (!openAiStudyApiConfigured()) {
    logger.info("Server-side Study analysis is disabled because OPENAI_API_KEY is not configured.");
    return undefined;
  }
  return startLoop("Study analysis queue", pollMs, () => runStudyAnalysisPass(), { runImmediately: true });
}

/**
 * Runs one pass, reusing the pass already in flight if there is one (single-flight).
 * This keeps the loop tick and any direct caller from processing two jobs at once.
 * Resolves true when a job was claimed, false when the queue was empty or AI is off.
 */
export function runStudyAnalysisPass(): Promise<boolean> {
  if (passInFlight) return passInFlight;
  passInFlight = executePass().finally(() => {
    passInFlight = undefined;
  });
  return passInFlight;
}

/**
 * Claims one job under a time-limited lease, calls OpenAI, and records success or failure.
 * Completion is guarded by the worker id, so a result that arrives after the lease expired
 * (and another worker may have taken the job) is dropped with a warning instead of saved.
 * Only safe provider metadata (status, code, type) is logged, never the prompt or key.
 */
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
