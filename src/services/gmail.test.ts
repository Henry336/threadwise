import { describe, expect, it, vi } from "vitest";

vi.mock("../config/env", () => ({
  env: {
    GMAIL_DAILY_SCAN_HOUR: 8,
    GMAIL_MAX_UNREAD_PER_SCAN: 10,
    GMAIL_TOKEN_ENCRYPTION_KEY: "test-secret-at-least-sixteen-chars"
  }
}));

import { HeuristicAiProvider } from "../ai/heuristicProvider";
import type { EmailForSummary } from "../ai/types";
import { summarizeEmailsDeterministically, summarizeEmailsWithDeterministicGate } from "./gmail";

describe("Gmail deterministic summary gate", () => {
  it("summarizes ordinary email locally without calling the AI provider", async () => {
    const provider = new CountingAiProvider();
    const digest = await summarizeEmailsWithDeterministicGate([
      email({
        subject: "Weekly product newsletter",
        snippet: "A roundup of new features and product launches."
      })
    ], provider);

    expect(provider.summaryCalls).toBe(0);
    expect(digest.items[0]).toMatchObject({
      important: false,
      subject: "Weekly product newsletter"
    });
  });

  it("preserves important action signals even when AI is used for richer wording", async () => {
    const provider = new CountingAiProvider();
    const digest = await summarizeEmailsWithDeterministicGate([
      email({
        subject: "Action required: invoice due today",
        snippet: "Please review and pay the attached invoice today."
      })
    ], provider);

    expect(provider.summaryCalls).toBe(1);
    expect(digest.items[0]).toMatchObject({
      important: true,
      suggestedAction: "Review: Action required: invoice due today"
    });
  });

  it("creates useful local summaries for important messages", () => {
    const digest = summarizeEmailsDeterministically([
      email({
        subject: "Security verification required",
        snippet: "Verify your account before the deadline."
      })
    ]);

    expect(digest.overview).toContain("1 looked important");
    expect(digest.items[0]?.importanceReason).toContain("deadline");
  });
});

class CountingAiProvider extends HeuristicAiProvider {
  summaryCalls = 0;

  override async summarizeEmails(emails: EmailForSummary[]) {
    this.summaryCalls += 1;
    const digest = await super.summarizeEmails(emails);
    return {
      ...digest,
      items: digest.items.map((item) => ({
        ...item,
        summary: `AI-polished: ${item.summary}`,
        important: false
      }))
    };
  }
}

function email(overrides: Partial<EmailForSummary>): EmailForSummary {
  return {
    messageId: overrides.messageId ?? "msg-1",
    from: overrides.from ?? "sender@example.com",
    subject: overrides.subject ?? "Message",
    snippet: overrides.snippet ?? "",
    body: overrides.body ?? overrides.snippet ?? "",
    receivedAt: "2026-07-06T00:00:00.000Z"
  };
}
