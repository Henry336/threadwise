import { StudyAnalysisMode, StudyItemSource, StudyResourceKind, type StudyWorkspace } from "@prisma/client";
import { prisma } from "../db/prisma";
import { StudyModeError } from "./study";

const MAX_SESSIONS = 20;
const MAX_RESOURCES = 28;
const MAX_ITEMS = 16;
const MAX_CANVAS_MATERIALS = 28;
const MAX_ASSIGNMENTS = 16;
const MAX_DETAIL = 1_200;
const MAX_EDITABLE_NOTE = 5_000;

export type StudyEvidenceKind = "SESSION" | "RESOURCE" | "WORK_ITEM" | "CANVAS_MATERIAL" | "CANVAS_ASSIGNMENT";
export type StudyEvidenceAuthority = "LEARNER_RECORD" | "OCR_TRANSCRIPT" | "COURSE_MATERIAL" | "COURSE_METADATA" | "ACTIVITY_LOG";
export type StudyEvidenceEdgeKind = "USED_IN_SESSION" | "CAPTURED_DURING_SESSION" | "SESSION_ADDRESSES_WORK";

export type StudyAnalysisEvidence = {
  id: string;
  kind: StudyEvidenceKind;
  authority: StudyEvidenceAuthority;
  title: string;
  detail?: string;
  occurredAt?: string;
  sessionId?: string;
  resourceId?: string;
  resourceKind?: StudyResourceKind;
  itemId?: string;
  canvasMaterialId?: string;
  canvasAssignmentId?: string;
  courseModulePosition?: number;
  editableText?: string;
};

export type StudyEvidenceEdge = {
  fromId: string;
  toId: string;
  kind: StudyEvidenceEdgeKind;
  confidence: number;
  basis: "EXPLICIT" | "TEMPORAL";
};

export type StudyCoverage = {
  status: "TIMED" | "UNKNOWN";
  explanation: string;
  canvasLastSuccessfulAt?: string;
  activeCourseModuleCount: number;
  expectedCourseModuleCount: number;
  expectedThroughPosition?: number;
  expectedMaterialCount: number;
  learnerEvidenceCount: number;
};

export type EvidenceSnapshot = {
  version: 2;
  mode: StudyAnalysisMode;
  asOfDate: string;
  module: { id: string; code: string; name: string };
  sessionCount: number;
  resourceCount: number;
  workItemCount: number;
  canvasMaterialCount: number;
  assignmentCount: number;
  coverage: StudyCoverage;
  evidence: StudyAnalysisEvidence[];
  edges: StudyEvidenceEdge[];
};

export async function collectStudyEvidence(
  workspace: StudyWorkspace,
  moduleId: string,
  mode: StudyAnalysisMode,
  now = new Date(),
): Promise<EvidenceSnapshot> {
  const module = await prisma.studyModule.findFirst({
    where: { id: moduleId, workspaceId: workspace.id },
    select: { id: true, code: true, name: true },
  });
  if (!module) throw new StudyModeError("Study module not found.", "not_found");

  const [sessionsNewest, resourcesNewest, itemsNewest, courseModules, materials, assignments, canvasSync] = await Promise.all([
    prisma.studySession.findMany({
      where: { workspaceId: workspace.id, moduleId, endedAt: { not: null }, archivedAt: null },
      orderBy: { endedAt: "desc" },
      take: MAX_SESSIONS,
      select: {
        id: true, itemId: true, startedAt: true, endedAt: true, durationMinutes: true, method: true,
        topic: true, focusStructure: true, techniques: true, result: true, topicsMixed: true,
        usedNotes: true, timed: true,
        resources: { select: { resourceId: true, addedAt: true } },
      },
    }),
    prisma.studyResource.findMany({
      where: { workspaceId: workspace.id, moduleId, archivedAt: null },
      orderBy: [{ pinnedAt: "desc" }, { createdAt: "desc" }],
      take: MAX_RESOURCES,
      select: {
        id: true, publicId: true, kind: true, title: true, body: true, url: true, tags: true,
        caption: true, ocrText: true, sourceSentAt: true, createdAt: true,
      },
    }),
    prisma.studyItem.findMany({
      where: { workspaceId: workspace.id, moduleId },
      orderBy: [{ dueAt: "desc" }, { createdAt: "desc" }],
      take: MAX_ITEMS,
      select: { id: true, publicId: true, title: true, notes: true, source: true, status: true, dueAt: true, completedAt: true, createdAt: true },
    }),
    prisma.studyCanvasCourseModule.findMany({
      where: { workspaceId: workspace.id, moduleId, active: true, published: { not: false } },
      orderBy: { position: "asc" },
      select: { id: true, name: true, position: true, unlockAt: true },
    }),
    prisma.studyCanvasMaterial.findMany({
      where: { workspaceId: workspace.id, moduleId, active: true, published: { not: false } },
      orderBy: [{ courseModule: { position: "asc" } }, { position: "asc" }],
      take: MAX_CANVAS_MATERIALS,
      select: {
        id: true, kind: true, title: true, position: true, contentType: true, byteSize: true,
        extractedText: true, unlockAt: true, sourceUpdatedAt: true, updatedAt: true,
        courseModule: { select: { id: true, name: true, position: true, unlockAt: true } },
      },
    }),
    prisma.studyCanvasAssignment.findMany({
      where: { workspaceId: workspace.id, moduleId, userArchivedAt: null },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      take: MAX_ASSIGNMENTS,
      select: { id: true, title: true, description: true, dueAt: true, unlockAt: true, submittedAt: true, submissionState: true, workflowState: true },
    }),
    prisma.studyCanvasSync.findUnique({ where: { workspaceId: workspace.id }, select: { lastSuccessfulAt: true } }),
  ]);

  const sessions = sessionsNewest.reverse();
  const resources = resourcesNewest.reverse();
  const items = itemsNewest.reverse();
  const evidence: StudyAnalysisEvidence[] = [];
  const sessionEvidenceById = new Map<string, string>();
  const resourceEvidenceById = new Map<string, string>();
  const itemEvidenceById = new Map<string, string>();

  for (const [index, session] of sessions.entries()) {
    const id = `S${index + 1}`;
    sessionEvidenceById.set(session.id, id);
    evidence.push({
      id,
      kind: "SESSION",
      authority: "ACTIVITY_LOG",
      title: cleanText(session.topic || session.method || "Completed study session", 180),
      detail: cleanText([
        `Method: ${session.method}`,
        session.focusStructure ? `Structure: ${session.focusStructure}` : "",
        session.techniques.length ? `Techniques: ${session.techniques.join(", ")}` : "",
        session.result ? `Learner outcome: ${session.result}` : "",
        session.topicsMixed.length ? `Topics: ${session.topicsMixed.join(", ")}` : "",
        `Duration: ${session.durationMinutes ?? 0} minutes`,
        `Timed: ${session.timed ? "yes" : "no"}`,
        session.usedNotes === null ? "" : `Used notes: ${session.usedNotes ? "yes" : "no"}`,
      ].filter(Boolean).join("\n"), MAX_DETAIL),
      occurredAt: (session.endedAt ?? session.startedAt).toISOString(),
      sessionId: session.id,
    });
  }

  for (const [index, resource] of resources.entries()) {
    const id = `R${index + 1}`;
    resourceEvidenceById.set(resource.id, id);
    const occurredAt = resource.sourceSentAt ?? resource.createdAt;
    const userText = resource.body?.trim();
    evidence.push({
      id,
      kind: "RESOURCE",
      authority: resource.ocrText && !userText ? "OCR_TRANSCRIPT" : "LEARNER_RECORD",
      title: cleanText(`${resource.kind}: ${resource.title}`, 180),
      detail: cleanText([
        resource.caption ? `Caption: ${resource.caption}` : undefined,
        userText ? `Learner text: ${userText}` : undefined,
        resource.ocrText ? `OCR transcript (may contain recognition errors): ${resource.ocrText}` : undefined,
        resource.tags.length ? `Tags: ${resource.tags.join(", ")}` : undefined,
        resource.url ? "A saved link is present; its contents were not fetched." : undefined,
      ].filter(Boolean).join("\n"), MAX_DETAIL),
      occurredAt: occurredAt.toISOString(),
      resourceId: resource.id,
      resourceKind: resource.kind,
      ...(resource.kind === StudyResourceKind.NOTE && userText ? { editableText: cleanText(userText, MAX_EDITABLE_NOTE) } : {}),
    });
  }

  for (const [index, item] of items.entries()) {
    const id = `W${index + 1}`;
    itemEvidenceById.set(item.id, id);
    evidence.push({
      id,
      kind: "WORK_ITEM",
      authority: item.source === StudyItemSource.CANVAS ? "COURSE_METADATA" : "LEARNER_RECORD",
      title: cleanText(`${item.publicId}: ${item.title}`, 180),
      detail: cleanText([
        `Status: ${item.status}`,
        item.notes ? `Notes: ${item.notes}` : undefined,
        item.dueAt ? `Due: ${item.dueAt.toISOString()}` : undefined,
      ].filter(Boolean).join("\n"), MAX_DETAIL),
      occurredAt: (item.completedAt ?? item.createdAt).toISOString(),
      itemId: item.id,
    });
  }

  for (const [index, material] of materials.entries()) {
    const id = `C${index + 1}`;
    const coursePosition = material.courseModule?.position;
    evidence.push({
      id,
      kind: "CANVAS_MATERIAL",
      authority: material.extractedText ? "COURSE_MATERIAL" : "COURSE_METADATA",
      title: cleanText(`${material.courseModule?.name ? `${material.courseModule.name}: ` : ""}${material.title}`, 180),
      detail: cleanText(material.extractedText
        ? `Published Canvas text: ${material.extractedText}`
        : [
            `Published ${material.kind.toLowerCase()} metadata; body was not downloaded.`,
            material.contentType ? `Content type: ${material.contentType}` : undefined,
            material.byteSize != null ? `Size: ${material.byteSize} bytes` : undefined,
          ].filter(Boolean).join("\n"), MAX_DETAIL),
      occurredAt: (material.sourceUpdatedAt ?? material.updatedAt).toISOString(),
      canvasMaterialId: material.id,
      courseModulePosition: coursePosition,
    });
  }

  for (const [index, assignment] of assignments.entries()) {
    evidence.push({
      id: `A${index + 1}`,
      kind: "CANVAS_ASSIGNMENT",
      authority: "COURSE_METADATA",
      title: cleanText(`Canvas assignment: ${assignment.title}`, 180),
      detail: cleanText([
        assignment.description ? `Description: ${assignment.description}` : undefined,
        assignment.dueAt ? `Due: ${assignment.dueAt.toISOString()}` : undefined,
        assignment.submittedAt ? `Submitted: ${assignment.submittedAt.toISOString()}` : undefined,
        assignment.submissionState ? `Submission state: ${assignment.submissionState}` : undefined,
        assignment.workflowState ? `Workflow state: ${assignment.workflowState}` : undefined,
      ].filter(Boolean).join("\n"), MAX_DETAIL),
      occurredAt: (assignment.submittedAt ?? assignment.dueAt ?? assignment.unlockAt)?.toISOString(),
      canvasAssignmentId: assignment.id,
    });
  }

  const edges = buildStudyEvidenceEdges({ sessions, resources, sessionEvidenceById, resourceEvidenceById, itemEvidenceById });

  const timedModules = courseModules.filter((entry) => entry.unlockAt);
  const expectedModules = timedModules.filter((entry) => entry.unlockAt!.getTime() <= now.getTime());
  const expectedThroughPosition = expectedModules.length ? Math.max(...expectedModules.map((entry) => entry.position)) : undefined;
  const expectedMaterialCount = expectedThroughPosition === undefined
    ? 0
    : materials.filter((entry) => (entry.courseModule?.position ?? Number.MAX_SAFE_INTEGER) <= expectedThroughPosition).length;
  const coverage: StudyCoverage = {
    status: timedModules.length ? "TIMED" : "UNKNOWN",
    explanation: timedModules.length
      ? `Canvas exposes release timing for ${timedModules.length} course module${timedModules.length === 1 ? "" : "s"}; expected coverage is bounded to modules released by ${dateKey(now, workspace.timezone)}.`
      : "Canvas does not expose enough module release timing to determine how far ahead or behind the learner should be.",
    canvasLastSuccessfulAt: canvasSync?.lastSuccessfulAt?.toISOString(),
    activeCourseModuleCount: courseModules.length,
    expectedCourseModuleCount: expectedModules.length,
    expectedThroughPosition,
    expectedMaterialCount,
    learnerEvidenceCount: sessions.length + resources.length,
  };

  return {
    version: 2,
    mode,
    asOfDate: dateKey(now, workspace.timezone),
    module,
    sessionCount: sessions.length,
    resourceCount: resources.length,
    workItemCount: items.length,
    canvasMaterialCount: materials.length,
    assignmentCount: assignments.length,
    coverage,
    evidence,
    edges,
  };
}

export function buildStudyEvidenceEdges(input: {
  sessions: Array<{
    id: string; itemId: string | null; startedAt: Date; endedAt: Date | null; durationMinutes: number | null;
    resources: Array<{ resourceId: string; addedAt: Date }>;
  }>;
  resources: Array<{ id: string; sourceSentAt: Date | null; createdAt: Date }>;
  sessionEvidenceById: Map<string, string>;
  resourceEvidenceById: Map<string, string>;
  itemEvidenceById: Map<string, string>;
}): StudyEvidenceEdge[] {
  const edges: StudyEvidenceEdge[] = [];
  const explicit = new Set<string>();
  for (const session of input.sessions) {
    const sessionEvidenceId = input.sessionEvidenceById.get(session.id);
    if (!sessionEvidenceId) continue;
    for (const link of session.resources) {
      const resourceEvidenceId = input.resourceEvidenceById.get(link.resourceId);
      if (!resourceEvidenceId) continue;
      explicit.add(`${session.id}:${link.resourceId}`);
      edges.push({ fromId: sessionEvidenceId, toId: resourceEvidenceId, kind: "USED_IN_SESSION", confidence: 1, basis: "EXPLICIT" });
    }
    const itemEvidenceId = session.itemId ? input.itemEvidenceById.get(session.itemId) : undefined;
    if (itemEvidenceId) edges.push({ fromId: sessionEvidenceId, toId: itemEvidenceId, kind: "SESSION_ADDRESSES_WORK", confidence: 1, basis: "EXPLICIT" });
  }
  for (const resource of input.resources) {
    const occurredAt = resource.sourceSentAt ?? resource.createdAt;
    const resourceEvidenceId = input.resourceEvidenceById.get(resource.id);
    if (!resourceEvidenceId) continue;
    for (const session of input.sessions) {
      if (explicit.has(`${session.id}:${resource.id}`)) continue;
      const sessionEvidenceId = input.sessionEvidenceById.get(session.id);
      if (!sessionEvidenceId) continue;
      const end = session.endedAt ?? new Date(session.startedAt.getTime() + Math.max(0, session.durationMinutes ?? 0) * 60_000);
      if (occurredAt.getTime() >= session.startedAt.getTime() && occurredAt.getTime() <= end.getTime()) {
        edges.push({ fromId: sessionEvidenceId, toId: resourceEvidenceId, kind: "CAPTURED_DURING_SESSION", confidence: 0.75, basis: "TEMPORAL" });
      }
    }
  }
  return edges;
}

export function publicStudyEvidence(evidence: StudyAnalysisEvidence[]): StudyAnalysisEvidence[] {
  return evidence.map(({ editableText: _editableText, ...entry }) => entry);
}

function cleanText(value: string, maximum: number): string {
  return Array.from(value.replace(/\u0000/g, "").trim()).slice(0, maximum).join("");
}

function dateKey(value: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
  } catch {
    return value.toISOString().slice(0, 10);
  }
}
