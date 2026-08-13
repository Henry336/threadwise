import { describe, expect, it, vi } from "vitest";
import { generateGeminiStudyAnalysis } from "./geminiStudyApi";

function providerResponse(text: string, status = 200): Response {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
  }), { status, headers: { "content-type": "application/json" } });
}

describe("server-side Gemini Study API", () => {
  it("sends the secret only as a provider header and returns bounded model text", async () => {
    const request = vi.fn().mockResolvedValue(providerResponse('{"summary":"Grounded"}'));
    const result = await generateGeminiStudyAnalysis("bounded prompt", {
      apiKey: "test-secret",
      fetch: request,
      models: ["gemini-test"],
      timeoutMs: 1_000,
      maxOutputTokens: 2_048,
    });
    expect(result).toEqual({ text: '{"summary":"Grounded"}', model: "gemini-test" });
    const [url, init] = request.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/models/gemini-test:generateContent");
    expect(url).not.toContain("test-secret");
    expect(init.headers).toMatchObject({ "x-goog-api-key": "test-secret" });
    expect(String(init.body)).not.toContain("test-secret");
  });

  it("falls back only when a configured model is unavailable", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":{"message":"model not found"}}', { status: 404 }))
      .mockResolvedValueOnce(providerResponse('{"summary":"Fallback"}'));
    const result = await generateGeminiStudyAnalysis("prompt", {
      apiKey: "test-secret",
      fetch: request,
      models: ["gemini-new", "gemini-stable"],
      timeoutMs: 1_000,
    });
    expect(result.model).toBe("gemini-stable");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("returns safe provider errors without retaining the upstream body", async () => {
    const request = vi.fn().mockResolvedValue(new Response('{"error":{"message":"private provider detail"}}', { status: 429 }));
    await expect(generateGeminiStudyAnalysis("prompt", {
      apiKey: "test-secret",
      fetch: request,
      models: ["gemini-test"],
      timeoutMs: 1_000,
    })).rejects.toThrow("busy");
  });
});
