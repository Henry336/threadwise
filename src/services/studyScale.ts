import { StudyResourceKind } from "@prisma/client";

export const STUDY_SCALE_BUDGETS = Object.freeze({
  evidenceSessions: 20,
  evidenceResources: 28,
  evidenceWorkItems: 16,
  evidenceCanvasMaterials: 28,
  evidenceAssignments: 16,
  resourceAnalysisExcerptChars: 5_000,
  canvasAnalysisExcerptChars: 1_600,
  dashboardResourcePage: 30,
  dashboardSnapshotResources: 400,
  dashboardResourcePreviewChars: 700,
  noteRevisions: 20,
  noteRevisionBodyChars: 100_000,
  analysisPromptChars: 48_000,
});

export function deriveStudyResourceAnalysis(input: {
  kind: StudyResourceKind;
  body?: string | null;
  caption?: string | null;
  ocrText?: string | null;
}): {
  analysisExcerpt: string | null;
  analysisExcerptReady: true;
  analysisExcerptTruncated: boolean;
  captionPreview: string | null;
  ocrPreview: string | null;
  ocrPreviewTruncated: boolean;
} {
  const pieces = input.kind === StudyResourceKind.NOTE
    ? [input.body]
    : [input.body, input.caption, input.ocrText];
  const content = pieces.map((value) => value?.trim()).filter((value): value is string => Boolean(value)).join("\n\n");
  const caption = boundedPreview(input.caption);
  const ocr = boundedPreview(input.ocrText);
  if (!content) return {
    analysisExcerpt: null,
    analysisExcerptReady: true,
    analysisExcerptTruncated: false,
    captionPreview: caption.value,
    ocrPreview: ocr.value,
    ocrPreviewTruncated: ocr.truncated,
  };
  const characters = Array.from(content);
  return {
    analysisExcerpt: characters.slice(0, STUDY_SCALE_BUDGETS.resourceAnalysisExcerptChars).join(""),
    analysisExcerptReady: true,
    analysisExcerptTruncated: characters.length > STUDY_SCALE_BUDGETS.resourceAnalysisExcerptChars,
    captionPreview: caption.value,
    ocrPreview: ocr.value,
    ocrPreviewTruncated: ocr.truncated,
  };
}

function boundedPreview(value?: string | null): { value: string | null; truncated: boolean } {
  const clean = value?.trim();
  if (!clean) return { value: null, truncated: false };
  const characters = Array.from(clean);
  return {
    value: characters.slice(0, STUDY_SCALE_BUDGETS.dashboardResourcePreviewChars).join(""),
    truncated: characters.length > STUDY_SCALE_BUDGETS.dashboardResourcePreviewChars,
  };
}

export function deriveCanvasAnalysisExcerpt(extractedText?: string | null): string | null {
  const clean = extractedText?.trim();
  return clean ? Array.from(clean).slice(0, STUDY_SCALE_BUDGETS.canvasAnalysisExcerptChars).join("") : null;
}

export function studyResourceWikiLookupKeys(input: { kind: StudyResourceKind; title: string; publicId: string }): string[] {
  if (input.kind !== StudyResourceKind.NOTE) return [];
  return [...new Set([input.title, input.publicId].map(normalizeStudyWikiTarget).filter(Boolean))];
}

export function normalizeStudyWikiTarget(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en");
}
