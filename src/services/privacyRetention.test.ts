import { describe, expect, it } from "vitest";
import { compactStudyAnalysisSnapshot } from "./geminiStudyAnalysis";
import { privacyRetentionCutoffs } from "./privacyRetention";
import { StudyAnalysisMode, StudyResourceKind } from "@prisma/client";

describe("privacy retention", () => {
  it("produces stable policy cutoffs", () => {
    const now = new Date("2026-08-17T12:00:00.000Z");
    const cutoffs = privacyRetentionCutoffs(now);
    expect(cutoffs.completedDiagnosticsBefore.toISOString()).toBe("2026-08-10T12:00:00.000Z");
    expect(cutoffs.failedOrAbandonedBefore.toISOString()).toBe("2026-08-03T12:00:00.000Z");
    expect(cutoffs.supersededCompletedBefore.toISOString()).toBe("2026-07-18T12:00:00.000Z");
  });

  it("removes detailed and editable evidence while retaining citations", () => {
    const compact = compactStudyAnalysisSnapshot({
      version: 2,
      mode: StudyAnalysisMode.CONNECTIONS,
      asOfDate: "2026-08-17",
      module: { id: "m1", code: "CS2100", name: "Computer Organisation" },
      sessionCount: 1,
      resourceCount: 1,
      workItemCount: 0,
      canvasMaterialCount: 0,
      assignmentCount: 0,
      coverage: { status: "UNKNOWN", explanation: "No Canvas data.", activeCourseModuleCount: 0, expectedCourseModuleCount: 0, expectedMaterialCount: 0, learnerEvidenceCount: 1 },
      evidence: [{ id: "e1", kind: "RESOURCE", authority: "LEARNER_RECORD", title: "Note", detail: "private detail", resourceId: "r1", resourceKind: StudyResourceKind.NOTE, editableText: "private body" }],
      edges: [{ fromId: "e1", toId: "e2", kind: "USED_IN_SESSION", confidence: 1, basis: "EXPLICIT" }],
    });
    expect(compact.evidence).toEqual([{ id: "e1", kind: "RESOURCE", authority: "LEARNER_RECORD", title: "Note", resourceId: "r1", resourceKind: StudyResourceKind.NOTE }]);
    expect(compact.edges).toEqual([]);
  });
});
