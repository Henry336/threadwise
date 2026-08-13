import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  generate: vi.fn(),
}));

vi.mock("../config/env", () => ({
  env: { STUDY_ANALYSIS_POLL_MS: 10_000, STUDY_ANALYSIS_LEASE_SECONDS: 180 },
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("./studyAnalysis", () => ({
  claimStudyAnalysisJob: mocks.claim,
  completeStudyAnalysisJob: mocks.complete,
  failStudyAnalysisJob: mocks.fail,
}));
vi.mock("./openAiStudyApi", () => ({
  openAiStudyApiConfigured: () => true,
  generateOpenAiStudyAnalysis: mocks.generate,
}));

import { runStudyAnalysisPass } from "./studyAnalysisRunner";

describe("OpenAI Study server runner", () => {
  beforeEach(() => vi.clearAllMocks());

  it("claims and completes one leased job with the actual provider model", async () => {
    mocks.claim.mockResolvedValue({ id: "job-1", prompt: "bounded", model: "configured" });
    mocks.generate.mockResolvedValue({ text: '{"summary":"done"}', model: "gpt-fallback" });
    mocks.complete.mockResolvedValue(true);
    await expect(runStudyAnalysisPass()).resolves.toBe(true);
    expect(mocks.claim).toHaveBeenCalledWith(expect.stringMatching(/^study-api:/), 180);
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({
      id: "job-1",
      finalResponse: '{"summary":"done"}',
      model: "gpt-fallback",
    }));
    expect(mocks.fail).not.toHaveBeenCalled();
  });

  it("records a safe failed job without throwing into the server loop", async () => {
    mocks.claim.mockResolvedValue({ id: "job-2", prompt: "bounded", model: "configured" });
    mocks.generate.mockRejectedValue(new Error("The analysis service is busy. Try again shortly."));
    mocks.fail.mockResolvedValue(true);
    await expect(runStudyAnalysisPass()).resolves.toBe(true);
    expect(mocks.fail).toHaveBeenCalledWith(expect.objectContaining({ id: "job-2" }));
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("does no provider work when the durable queue is empty", async () => {
    mocks.claim.mockResolvedValue(undefined);
    await expect(runStudyAnalysisPass()).resolves.toBe(false);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
});
