/**
 * Chooses the AI provider at startup. main.ts calls createAiProvider once and passes the result
 * to the bot and dashboard. AI is an optional adapter: the bot stays usable without an API key.
 */

import { env } from "../config/env";
import { logger } from "../logger";
import { HeuristicAiProvider } from "./heuristicProvider";
import { OpenAiProvider } from "./openaiProvider";
import { ResilientAiProvider } from "./resilientProvider";
import type { AiProvider } from "./types";

/**
 * Returns the heuristic provider when OPENAI_API_KEY is missing. Otherwise returns OpenAI wrapped
 * so that any failed call (quota, outage) falls back to the heuristic answer instead of erroring.
 */
export function createAiProvider(): AiProvider {
  if (!env.OPENAI_API_KEY) {
    logger.warn("OPENAI_API_KEY is not set; using heuristic AI fallback.");
    return new HeuristicAiProvider();
  }

  return new ResilientAiProvider(new OpenAiProvider(env.OPENAI_API_KEY), new HeuristicAiProvider());
}
