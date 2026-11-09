/**
 * Size limits for Study Mode so large notes and Canvas mirrors stay cheap to load and analyse.
 * Holds the shared budget table plus helpers that precompute bounded excerpts and previews when a
 * resource is saved, so the dashboard and AI evidence graph can read short columns instead of whole
 * bodies. Used by studyResources, studyMarkdown, studyCanvas, studyEvidenceGraph and the dashboard.
 */
import { StudyResourceKind } from "@prisma/client";

/** Central caps (row counts and character counts) for evidence gathering, dashboard pages, and note revisions. */
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

/**
 * Computes the stored analysis excerpt and short caption/OCR previews for a Study resource.
 * Callers spread the result into the same write that saves the body, so these derived columns never
 * go stale. Notes use only their body; images and files also include caption and OCR text.
 * Slicing uses Array.from so emoji and other multi-unit characters are never split.
 */
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

/** Bounded excerpt of Canvas page text, so AI evidence never pulls whole extracted pages. */
export function deriveCanvasAnalysisExcerpt(extractedText?: string | null): string | null {
  const clean = extractedText?.trim();
  return clean ? Array.from(clean).slice(0, STUDY_SCALE_BUDGETS.canvasAnalysisExcerptChars).join("") : null;
}

/**
 * Normalized names a [[wiki link]] can use to reach this note: its title and its public id.
 * Only notes are link targets, so other kinds return an empty list.
 */
export function studyResourceWikiLookupKeys(input: { kind: StudyResourceKind; title: string; publicId: string }): string[] {
  if (input.kind !== StudyResourceKind.NOTE) return [];
  return [...new Set([input.title, input.publicId].map(normalizeStudyWikiTarget).filter(Boolean))];
}

/** Canonical form for wiki link matching: Unicode-normalized, trimmed, single-spaced, lower case. */
export function normalizeStudyWikiTarget(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en");
}
