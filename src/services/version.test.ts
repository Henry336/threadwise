import { describe, expect, it } from "vitest";
import { formatVersionStatus } from "./version";

describe("version status", () => {
  it("formats version, integration, and reminder diagnostics", () => {
    const message = formatVersionStatus({
      ai: {
        provider: "openai",
        apiKeyConfigured: true,
        chatModels: ["gpt-5.4-mini"],
        activeChatModel: "gpt-5.4-mini",
        embeddingModel: "text-embedding-3-small"
      },
      gmailConfigured: true,
      reminders: {
        source: "loop",
        lastStartedAt: "2026-07-06T01:00:00.000Z",
        lastFinishedAt: "2026-07-06T01:00:01.000Z",
        dueTasksFound: 3,
        remindersSent: 2,
        skippedMissingSettings: 0,
        deferredForQuietHours: 1,
        cappedByDailyLimit: 0,
        failedDeliveries: 0
      }
    }, new Date("2026-07-06T01:05:00.000Z"));

    expect(message).toContain("<b>Threadwise</b> <code>v");
    expect(message).toContain("<b>AI</b> OpenAI (gpt-5.4-mini)");
    expect(message).toContain("<b>Gmail</b> configured");
    expect(message).toContain("<b>Due tasks found</b> 3");
    expect(message).toContain("<b>Sent</b> 2");
  });
});
