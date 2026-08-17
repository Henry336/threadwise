import { describe, expect, it } from "vitest";
import { StudyResourceKind } from "@prisma/client";
import { deriveCanvasAnalysisExcerpt, deriveStudyResourceAnalysis, STUDY_SCALE_BUDGETS, studyResourceWikiLookupKeys } from "./studyScale";

describe("Study scale budgets", () => {
  it("bounds analysis excerpts without splitting Unicode code points", () => {
    const body = "🧠".repeat(STUDY_SCALE_BUDGETS.resourceAnalysisExcerptChars + 5);
    const result = deriveStudyResourceAnalysis({ kind: StudyResourceKind.NOTE, body });
    expect(Array.from(result.analysisExcerpt ?? "")).toHaveLength(STUDY_SCALE_BUDGETS.resourceAnalysisExcerptChars);
    expect(result.analysisExcerptTruncated).toBe(true);
    expect(Array.from(deriveCanvasAnalysisExcerpt(body) ?? "")).toHaveLength(STUDY_SCALE_BUDGETS.canvasAnalysisExcerptChars);
    const image = deriveStudyResourceAnalysis({ kind: StudyResourceKind.IMAGE, caption: "caption", ocrText: body });
    expect(image.captionPreview).toBe("caption");
    expect(Array.from(image.ocrPreview ?? "")).toHaveLength(STUDY_SCALE_BUDGETS.dashboardResourcePreviewChars);
    expect(image.ocrPreviewTruncated).toBe(true);
  });

  it("uses stable indexed wiki lookup keys only for notes", () => {
    expect(studyResourceWikiLookupKeys({ kind: StudyResourceKind.NOTE, title: "  Cache   Coherence ", publicId: "NOTE-9" }))
      .toEqual(["cache coherence", "note-9"]);
    expect(studyResourceWikiLookupKeys({ kind: StudyResourceKind.IMAGE, title: "Diagram", publicId: "IMAGE-1" })).toEqual([]);
  });

  it("derives ten thousand bounded records within the local CPU budget", () => {
    const started = performance.now();
    for (let index = 0; index < 10_000; index += 1) {
      deriveStudyResourceAnalysis({ kind: StudyResourceKind.NOTE, body: `Synthetic note ${index} ${"x".repeat(2_000)}` });
    }
    expect(performance.now() - started).toBeLessThan(1_500);
  });
});
