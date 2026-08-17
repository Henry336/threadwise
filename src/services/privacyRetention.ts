import { CodexJobStatus, StudyNoteEditSuggestionStatus } from "@prisma/client";

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

export function privacyRetentionCutoffs(now = new Date()): PrivacyRetentionCutoffs {
  const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1_000);
  return {
    failedOrAbandonedBefore: daysAgo(PRIVACY_RETENTION.failedOrAbandonedDays),
    completedDiagnosticsBefore: daysAgo(PRIVACY_RETENTION.completedDiagnosticsDays),
    supersededCompletedBefore: daysAgo(PRIVACY_RETENTION.supersededCompletedDays),
    reviewedSuggestionBefore: daysAgo(PRIVACY_RETENTION.reviewedSuggestionDays),
  };
}

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
