import { createHash } from "node:crypto";
import { StudyNoteEditSuggestionStatus, type StudyWorkspace } from "@prisma/client";
import { prisma } from "../db/prisma";
import { StudyModeError } from "./study";

export type StudyNoteSuggestionReview = {
  action: "APPLY" | "DISMISS";
  replacementText?: string;
};

export async function reviewStudyNoteEditSuggestion(
  workspace: StudyWorkspace,
  suggestionId: string,
  review: StudyNoteSuggestionReview,
) {
  const suggestion = await prisma.studyNoteEditSuggestion.findFirst({
    where: { id: suggestionId, workspaceId: workspace.id },
    include: { resource: { select: { id: true, body: true, archivedAt: true } } },
  });
  if (!suggestion) throw new StudyModeError("That note suggestion could not be found.", "not_found");
  if (suggestion.status !== StudyNoteEditSuggestionStatus.PENDING) {
    throw new StudyModeError("That note suggestion has already been reviewed.", "conflict");
  }
  if (review.action === "DISMISS") {
    return prisma.studyNoteEditSuggestion.update({
      where: { id: suggestion.id },
      data: { status: StudyNoteEditSuggestionStatus.DISMISSED, reviewedAt: new Date() },
    });
  }
  const appliedBody = cleanReplacement(review.replacementText ?? suggestion.suggestedBody);
  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.studyNoteEditSuggestion.findFirst({
      where: { id: suggestion.id, workspaceId: workspace.id },
      include: { resource: { select: { body: true, archivedAt: true } } },
    });
    if (!current || current.status !== StudyNoteEditSuggestionStatus.PENDING) return { conflict: "reviewed" as const };
    if (current.resource.archivedAt || hashText(current.resource.body ?? "") !== current.originalBodyHash) {
      await tx.studyNoteEditSuggestion.update({
        where: { id: current.id },
        data: { status: StudyNoteEditSuggestionStatus.SUPERSEDED, reviewedAt: new Date() },
      });
      return { conflict: "changed" as const };
    }
    await tx.studyResource.update({ where: { id: current.resourceId }, data: { body: appliedBody } });
    const applied = await tx.studyNoteEditSuggestion.update({
      where: { id: current.id },
      data: { status: StudyNoteEditSuggestionStatus.APPLIED, appliedBody, reviewedAt: new Date() },
    });
    return { applied };
  });
  if ("applied" in result) return result.applied;
  if (result.conflict === "changed") throw new StudyModeError("This note changed after the suggestion was created. Review the current note before editing it.", "conflict");
  throw new StudyModeError("That note suggestion has already been reviewed.", "conflict");
}

function cleanReplacement(value: string): string {
  const clean = Array.from(value.replace(/\u0000/g, "").trim()).slice(0, 5_000).join("");
  if (!clean) throw new StudyModeError("The replacement note cannot be empty.", "invalid");
  return clean;
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
