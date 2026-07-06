import { beforeEach, describe, expect, it, vi } from "vitest";

describe("OpenAiProvider fallback handling", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@example.com:5432/threadwise");
    vi.stubEnv("OPENAI_MODEL", "gpt-a");
    vi.stubEnv("OPENAI_MODEL_FALLBACKS", "gpt-b");
  });

  it("moves to the next model after a rate limit", async () => {
    const { OpenAiProvider } = await import("./openaiProvider");
    const calls: string[] = [];
    const client = fakeClient(async (model) => {
      calls.push(model);
      if (model === "gpt-a") {
        throw rateLimitError();
      }

      return jsonResponse({ title: "Fallback task" });
    });

    const provider = new OpenAiProvider("test-key", client);
    await expect(provider.structureTask("do the thing")).resolves.toMatchObject({ title: "Fallback task" });
    await expect(provider.structureTask("do the next thing")).resolves.toMatchObject({ title: "Fallback task" });

    expect(calls).toEqual(["gpt-a", "gpt-b", "gpt-b"]);
    expect(provider.getStatus().activeChatModel).toBe("gpt-b");
  });

  it("does not keep hammering cooled-down rate-limited models", async () => {
    const { OpenAiProvider } = await import("./openaiProvider");
    const calls: string[] = [];
    const client = fakeClient(async (model) => {
      calls.push(model);
      throw rateLimitError();
    });

    const provider = new OpenAiProvider("test-key", client);
    await expect(provider.structureTask("do the thing")).rejects.toThrow("Rate limited");
    await expect(provider.structureTask("do the next thing")).rejects.toThrow("cooling down");

    expect(calls).toEqual(["gpt-a", "gpt-b"]);
  });
});

function fakeClient(create: (model: string) => Promise<unknown>) {
  return {
    chat: {
      completions: {
        create: (input: { model: string }) => create(input.model)
      }
    },
    embeddings: {
      create: async () => ({ data: [{ embedding: [1, 0, 0] }] })
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
