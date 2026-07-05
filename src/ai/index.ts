import { env } from "../config/env";
import { logger } from "../logger";
import { HeuristicAiProvider } from "./heuristicProvider";
import { OpenAiProvider } from "./openaiProvider";
import type { AiProvider } from "./types";

export function createAiProvider(): AiProvider {
  if (!env.OPENAI_API_KEY) {
    logger.warn("OPENAI_API_KEY is not set; using heuristic AI fallback.");
    return new HeuristicAiProvider();
  }

  return new OpenAiProvider(env.OPENAI_API_KEY);
}

