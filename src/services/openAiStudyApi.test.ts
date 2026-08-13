import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { generateOpenAiStudyAnalysis } from "./openAiStudyApi";

type StudyClient = Pick<OpenAI, "chat">;

function clientWith(create: ReturnType<typeof vi.fn>): StudyClient {
  return { chat: { completions: { create } } } as unknown as StudyClient;
}

function providerError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

describe("server-side OpenAI Study API", () => {
  it("uses JSON mode with the bounded Study prompt and returns the actual model", async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: '{"summary":"Grounded"}' } }] });
    const result = await generateOpenAiStudyAnalysis("bounded prompt", {
      apiKey: "test-secret",
      client: clientWith(create),
      models: ["gpt-test"],
      timeoutMs: 1_000,
      maxOutputTokens: 2_048,
    });
    expect(result).toEqual({ text: '{"summary":"Grounded"}', model: "gpt-test" });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-test",
      response_format: { type: "json_object" },
      max_completion_tokens: 2_048,
      messages: expect.arrayContaining([expect.objectContaining({ role: "user", content: "bounded prompt" })]),
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(JSON.stringify(create.mock.calls)).not.toContain("test-secret");
  });

  it("falls back only when a configured model is unavailable", async () => {
    const create = vi.fn()
      .mockRejectedValueOnce(providerError(404, "model not found"))
      .mockResolvedValueOnce({ choices: [{ message: { content: '{"summary":"Fallback"}' } }] });
    const result = await generateOpenAiStudyAnalysis("prompt", {
      apiKey: "test-secret",
      client: clientWith(create),
      models: ["gpt-new", "gpt-stable"],
      timeoutMs: 1_000,
    });
    expect(result.model).toBe("gpt-stable");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("returns safe provider errors without retaining upstream detail", async () => {
    const create = vi.fn().mockRejectedValue(providerError(429, "private provider detail"));
    await expect(generateOpenAiStudyAnalysis("prompt", {
      apiKey: "test-secret",
      client: clientWith(create),
      models: ["gpt-test"],
      timeoutMs: 1_000,
    })).rejects.toThrow("busy");
  });
});
