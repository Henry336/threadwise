/**
 * Retention windows for AI analysis job payloads (Study and Ideas) and reviewed Study note-edit
 * suggestions. Only the manual, guarded script scripts/enforce-privacy-retention.ts uses these
 * (dry run by default; deletes or redacts only with --apply and explicit acknowledgements).
 * Kept here so the windows are one shared, testable definition. See docs/PHASE3_PRIVACY_RUNBOOK.md.
 */
import { CodexJobStatus, StudyNoteEditSuggestionStatus } from "@prisma/client";

/**
 * Days to keep each kind of row: failed/abandoned jobs are deleted, completed jobs have their prompt
 * and diagnostics redacted, superseded completed jobs are removed, and reviewed suggestions are cleared.
 */
export const PRIVACY_RETENTION = Object.freeze({
  failedOrAbandonedDays: 14,
  completedDiagnosticsDays: 7,
  supersededCompletedDays: 30,
  reviewedSuggestionDays: 30,
});

export type PrivacyRetentionCutoffs = {
  failedOrAbandonedBefore: Date;
  completedDiagnosticsBefore: Date;
  supersededCompletedBefore: Date;
  reviewedSuggestionBefore: Date;
};

/** Turns the day counts into absolute dates: rows older than each cutoff are eligible. */
export function privacyRetentionCutoffs(now = new Date()): PrivacyRetentionCutoffs {
  const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1_000);
  return {
    failedOrAbandonedBefore: daysAgo(PRIVACY_RETENTION.failedOrAbandonedDays),
    completedDiagnosticsBefore: daysAgo(PRIVACY_RETENTION.completedDiagnosticsDays),
    supersededCompletedBefore: daysAgo(PRIVACY_RETENTION.supersededCompletedDays),
    reviewedSuggestionBefore: daysAgo(PRIVACY_RETENTION.reviewedSuggestionDays),
  };
}

/** Job states that never produced a usable result, so their stored evidence can be deleted after the window. */
export const abandonedStudyAnalysisStatuses: CodexJobStatus[] = [
  CodexJobStatus.WAITING_APPROVAL,
  CodexJobStatus.PENDING,
  CodexJobStatus.RUNNING,
  CodexJobStatus.FAILED,
  CodexJobStatus.BLOCKED,
  CodexJobStatus.CANCELED,
];

export const reviewedSuggestionStatuses: StudyNoteEditSuggestionStatus[] = [
  StudyNoteEditSuggestionStatus.APPLIED,
  StudyNoteEditSuggestionStatus.DISMISSED,
  StudyNoteEditSuggestionStatus.SUPERSEDED,
];
