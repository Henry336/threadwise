import { beforeEach, describe, expect, it, vi } from "vitest";

describe("OpenAiProvider", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@example.com:5432/threadwise");
    vi.stubEnv("OPENAI_MODEL", "gpt-a");
    vi.stubEnv("OPENAI_MODEL_FALLBACKS", "gpt-b");
  });

  it("calls only the configured model and rethrows its failure for the heuristic fallback", async () => {
    const { OpenAiProvider } = await import("./openaiProvider");
    const calls: string[] = [];
    const provider = new OpenAiProvider("test-key", fakeClient(async (model) => {
      calls.push(model);
      throw rateLimitError();
    }));

    await expect(provider.structureTask("do the thing")).rejects.toThrow("Rate limited");
    await expect(provider.structureTask("do the next thing")).rejects.toThrow("Rate limited");

    expect(calls).toEqual(["gpt-a", "gpt-a"]);
    expect(provider.getStatus().lastError).toMatchObject({ model: "gpt-a", message: "Rate limited" });
  });

  it("uses the fallback when the reply is valid JSON of the wrong shape", async () => {
    const { OpenAiProvider } = await import("./openaiProvider");
    const provider = new OpenAiProvider("test-key", fakeClient(async () => jsonResponse({ kind: "spaceship", confidence: "high" })));

    await expect(provider.classifyMessage("buy milk")).resolves.toEqual({
      kind: "noise",
      confidence: 0.5,
      reason: "Could not confidently classify message."
    });
  });

  it("accepts a valid reply and treats null optional fields as absent", async () => {
    const { OpenAiProvider } = await import("./openaiProvider");
    const provider = new OpenAiProvider("test-key", fakeClient(async () => jsonResponse({ title: "Buy milk", description: null })));

    await expect(provider.structureTask("buy milk")).resolves.toEqual({ title: "Buy milk", description: undefined, dueDateText: undefined });
  });
});

function fakeClient(create: (model: string) => Promise<unknown>) {
  return {
    chat: {
      completions: {
        create: (input: { model: string }) => create(input.model)
      }
    }
  } as never;
}

function rateLimitError(): Error & { status: number; code: string; type: string } {
  return Object.assign(new Error("Rate limited"), {
    status: 429,
    code: "rate_limit_exceeded",
    type: "rate_limit_exceeded"
  });
}

function jsonResponse(value: unknown) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify(value)
        }
      }
    ]
  };
}
