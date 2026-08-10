import {
  StudyCanvasAssignmentStatus,
  StudyItemStatus,
  StudyItemType,
  StudyPriority,
  StudyResourceKind,
  type StudyModule,
  type StudyWorkspace,
} from "@prisma/client";
import type { Context } from "grammy";
import { InlineKeyboard, Keyboard } from "grammy";
import { DateTime } from "luxon";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { logger } from "../logger";
import {
  StudyModeError,
  advanceStudyConversation,
  beginStudyConversation,
  clearStudyConversation,
  completeStudyItem,
  createStudyItem,
  findStudyItem,
  findStudyModule,
  getStudyConversation,
  listStudyModules,
  rescheduleStudyItem,
  studyConversationPayload,
  startStudySession,
  updateStudyScheduleBlock,
  updateStudyMastery,
} from "../services/study";
import { buildStudyAttentionSnapshot, buildStudyWeeklyPreview } from "../services/studyAttention";
import { studyCanvasConfigured, studyCanvasStatus, syncStudyCanvas } from "../services/studyCanvas";
import { extractTextFromImage, MAX_IMAGE_BYTES } from "../services/imageOcr";
import { parseStudyNaturalLanguage, type StudyNaturalIntent } from "../services/studyNaturalLanguage";
import {
  activeStudyModule,
  appendStudyNoteSegment,
  archiveStudyResource,
  cancelStudyNoteCaptureSession,
  consumeStudyPendingCapture,
  createStudyPendingCapture,
  createStudyResource,
  currentStudyNoteCaptureSession,
  finalizeStudyNoteCaptureSession,
  findStudyPendingCapture,
  findStudyResource,
  listStudyResources,
  paginateStudyText,
  pinStudyResource,
  requireActiveStudyModule,
  setActiveStudyModule,
  setStudyPendingCaptureModule,
  startStudyNoteCaptureSession,
  updateStudyResourceOcr,
} from "../services/studyResources";
import {
  activateStudyOrigin,
  addStudyOriginFromCandidate,
  addStudyOriginFromLocation,
  addStudyOriginFromVenue,
  buildStudyDeparturePlan,
  clearStudyScheduleTravel,
  currentStudyOrigin,
  deleteStudyOrigin,
  estimateStudyJourney,
  isStudyTravelMuted,
  listUpcomingStudyTravelBlocks,
  listStudyOrigins,
  muteStudyTravelForToday,
  renameStudyOrigin,
  resumeStudyTravelReminders,
  searchStudyOriginPlaces,
  setDefaultStudyOrigin,
  type StudyOriginPlaceCandidate,
} from "../services/studyTransit";
import { ocrLanguagesForCaption } from "../utils/ocrLanguages";
import { parseDueDate } from "../utils/dates";
import { bold, code, editOrReplyHtml, h, replyHtml } from "../utils/html";
import { truncate } from "../utils/text";
import { editEphemeralMessageText, ephemeralDeletionTarget } from "./ephemeral";
import { groupDashboardUrl } from "./links";
import { editOrReplyQuietAcknowledgementHtml, replyQuietAcknowledgementHtml } from "./quietAcknowledgements";

const EXTENDED_CALLBACKS = [
  "study:onboarding",
  "study:setup:start",
  "study:canvas:",
  "study:attention",
  "study:preview",
  "study:module:open:",
  "study:note:",
  "study:resources:",
  "study:res:",
  "study:cap:",
  "study:capm:",
  "study:capmods:",
  "study:origins",
  "study:origin:",
  "study:travel",
] as const;

type StudyMedia = {
  telegramFileId: string;
  telegramUniqueId?: string;
  mediaKind: "photo" | "document";
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
  caption?: string;
  sourceMessageId?: number;
};

export function isExtendedStudyCallback(data: string): boolean {
  return EXTENDED_CALLBACKS.some((prefix) => data === prefix || data.startsWith(prefix));
}

export function studyModeKeyboard(): Keyboard {
  return new Keyboard()
    .text("Study menu")
    .resized()
    .persistent()
    .placeholder("Capture for Study Mode…");
}

export function studyNoteModeKeyboard(): Keyboard {
  return new Keyboard()
    .text("Save note")
    .text("Cancel note")
    .resized()
    .persistent()
    .placeholder("Each message becomes a paragraph…");
}

export async function handleStudyAmbientText(
  ctx: Context,
  workspace: StudyWorkspace,
  rawOverride?: string,
): Promise<void> {
  const raw = rawOverride ?? (ctx.message && "text" in ctx.message ? ctx.message.text ?? "" : "");
  const text = raw.trim();
  const session = rawOverride === undefined ? await currentStudyNoteCaptureSession(workspace.id) : undefined;
  if (session) {
    if (/^(?:save note|\/save_note(?:@\w+)?)$/i.test(text)) {
      await finishStudyNoteSession(ctx, workspace);
      return;
    }
    if (/^(?:cancel note|\/cancel_note(?:@\w+)?)$/i.test(text)) {
      await cancelStudyNoteSession(ctx, workspace);
      return;
    }
    if (session.expiresAt <= new Date()) {
      await finalizeStudyNoteCaptureSession(workspace);
    } else if (!text.startsWith("/")) {
      await appendStudyNoteSegment(workspace.id, ctx.message!.message_id, raw);
      return;
    }
  }

  if (rawOverride === undefined && await handleStudyReplyCapture(ctx, workspace, text)) return;

  const normalized = text
    .replace(/^\/study_menu(?:@\w+)?$/i, "Study menu")
    .replace(/^\/save_note(?:@\w+)?$/i, "Save note")
    .replace(/^\/cancel_note(?:@\w+)?$/i, "Cancel note");
  const intent = parseStudyNaturalLanguage(normalized, workspace.timezone);
  if (!intent) return showStudyCaptureChoice(ctx, workspace, normalized);
  await executeStudyIntent(ctx, workspace, intent);
}

async function handleStudyReplyCapture(
  ctx: Context,
  workspace: StudyWorkspace,
  instruction: string,
): Promise<boolean> {
  const request = parseReplyCaptureInstruction(instruction);
  if (!request) return false;
  const replied = ctx.message?.reply_to_message;
  if (!replied) {
    await replyHtml(ctx, [
      bold("Reply capture"),
      `Reply to the message you want to save, then send ${code(`save this to ${request.moduleReference}`)}.`,
    ].join("\n"));
    return true;
  }

  const module = await findStudyModule(workspace.id, request.moduleReference);
  const sourceText = (
    ("text" in replied && typeof replied.text === "string" ? replied.text : undefined)
    ?? ("caption" in replied && typeof replied.caption === "string" ? replied.caption : undefined)
    ?? ("document" in replied && replied.document?.file_name ? replied.document.file_name : undefined)
    ?? "Study capture"
  ).trim();

  if (request.action === "task") {
    const dueAt = parseDueDate(sourceText, workspace.timezone);
    const item = await createStudyItem(workspace, {
      moduleId: module.id,
      type: inferStudyItemType(sourceText),
      title: cleanCaptureTitle(sourceText),
      notes: sourceText,
      dueAt,
      priority: inferStudyPriority(dueAt),
    });
    await replyQuietAcknowledgementHtml(ctx, `${bold("Saved")} · ${code(item.publicId)} · ${bold(module.code)}`, 3_500, {
      reply_markup: studyModeKeyboard(),
    });
    return true;
  }

  const photo = "photo" in replied ? replied.photo?.at(-1) : undefined;
  const document = "document" in replied ? replied.document : undefined;
  if (photo || document) {
    const defaultKind = photo || document?.mime_type?.startsWith("image/")
      ? StudyResourceKind.IMAGE
      : StudyResourceKind.FILE;
    const requestedKind = request.action === "note" ? StudyResourceKind.NOTE
      : request.action === "question" ? StudyResourceKind.QUESTION
        : request.action === "resource" || request.action === "link" ? StudyResourceKind.LINK
          : defaultKind;
    await saveStudyMedia(ctx, workspace, module, {
      telegramFileId: photo?.file_id ?? document!.file_id,
      telegramUniqueId: photo?.file_unique_id ?? document?.file_unique_id,
      mediaKind: photo ? "photo" : "document",
      mimeType: photo ? "image/jpeg" : document?.mime_type,
      fileName: document?.file_name,
      fileSize: photo?.file_size ?? document?.file_size,
      caption: sourceText === "Study capture" ? undefined : sourceText,
      sourceMessageId: replied.message_id,
    }, requestedKind);
    return true;
  }

  const url = sourceText.match(/https?:\/\/[^\s<>()]+/i)?.[0]?.replace(/[.,;!?]+$/, "");
  const kind = request.action === "question" ? StudyResourceKind.QUESTION
    : request.action === "resource" || request.action === "link" || (!request.action && url) ? StudyResourceKind.LINK
      : StudyResourceKind.NOTE;
  const result = await createStudyResource(workspace, {
    moduleId: module.id,
    kind,
    title: sourceText,
    body: sourceText,
    url,
    sourceMessageId: replied.message_id,
  });
  await replyQuietAcknowledgementHtml(ctx, `${bold("Saved")} · ${code(result.resource.publicId)} · ${bold(module.code)}`, 3_500, {
    reply_markup: studyModeKeyboard(),
  });
  return true;
}

export function parseReplyCaptureInstruction(text: string): {
  moduleReference: string;
  action?: "task" | "note" | "question" | "resource" | "link";
} | undefined {
  if (!/^(?:save|keep|capture)\b/i.test(text) || !/\b(?:this|that|the replied message)\b/i.test(text)) return undefined;
  const moduleMatch = text.match(/\b(?:to|in|under|for)\s+(?:module\s+)?([a-z]{2,6}\s*\d{3,5}[a-z]?)\b/i);
  if (!moduleMatch?.[1]) return undefined;
  const actionMatch = text.match(/\bas\s+(?:a\s+)?(task|note|question|resource|link)\b/i);
  return {
    moduleReference: moduleMatch[1].toUpperCase().replace(/\s+/g, ""),
    action: actionMatch?.[1]?.toLowerCase() as "task" | "note" | "question" | "resource" | "link" | undefined,
  };
}

export async function handleStudyPhoto(ctx: Context, workspace: StudyWorkspace): Promise<void> {
  const photo = ctx.message?.photo?.at(-1);
  if (!photo) return;
  await handleStudyMedia(ctx, workspace, {
    telegramFileId: photo.file_id,
    telegramUniqueId: photo.file_unique_id,
    mediaKind: "photo",
    mimeType: "image/jpeg",
    fileSize: photo.file_size,
    caption: ctx.message?.caption,
    sourceMessageId: ctx.message?.message_id,
  });
}

export async function handleStudyDocument(ctx: Context, workspace: StudyWorkspace): Promise<void> {
  const document = ctx.message?.document;
  if (!document) return;
  await handleStudyMedia(ctx, workspace, {
    telegramFileId: document.file_id,
    telegramUniqueId: document.file_unique_id,
    mediaKind: "document",
    mimeType: document.mime_type,
    fileName: document.file_name,
    fileSize: document.file_size,
    caption: ctx.message?.caption,
    sourceMessageId: ctx.message?.message_id,
  });
}

export async function handleStudyLocation(ctx: Context, workspace: StudyWorkspace): Promise<void> {
  const location = ctx.message?.location;
  if (!location) return;
  const origin = await addStudyOriginFromLocation(workspace, "Current location", {
    latitude: location.latitude,
    longitude: location.longitude,
  }, { activateHours: 4 });
  await replyQuietAcknowledgementHtml(ctx, `${bold("Current origin set")} · ${h(origin.name)} · 4 hours`, 3_500, {
    reply_markup: studyModeKeyboard(),
  });
}

export async function showStudyOnboarding(ctx: Context, workspace: StudyWorkspace, edit = false): Promise<void> {
  const [canvas, activeModuleValue, origins] = await Promise.all([
    studyCanvasStatus(workspace.id),
    activeStudyModule(workspace),
    listStudyOrigins(workspace.id),
  ]);
  const configured = studyCanvasConfigured();
  const text = [
    bold("Study Mode setup"),
    `${workspace.semesterStartDate ? "✓" : "○"} Semester · ${h(workspace.semesterName)}`,
    `${configured ? "✓" : "○"} Canvas · ${configured ? canvas?.lastSuccessfulAt ? `synced ${h(relativeTime(canvas.lastSuccessfulAt))}` : "ready to sync" : "add the Render secret"}`,
    `${activeModuleValue ? "✓" : "○"} Active module · ${activeModuleValue ? bold(activeModuleValue.code) : "choose one"}`,
    `${origins.length ? "✓" : "○"} Travel origins · ${origins.length}`,
    "",
    "Canvas imports are read-only. Local completion never submits coursework.",
  ].join("\n");
  const keyboard = new InlineKeyboard()
    .text("Semester", "study:setup:start")
    .text(configured ? "Sync Canvas" : "Canvas setup", configured ? "study:canvas:sync" : "study:canvas:status").row()
    .text("Modules", "study:modules")
    .text("Travel origins", "study:origins").row()
    .text("Done", "study:dashboard");
  if (edit) {
    await editOrReplyHtml(ctx, text, { reply_markup: keyboard });
  } else {
    await replyHtml(ctx, text, { reply_markup: keyboard });
    await replyQuietAcknowledgementHtml(ctx, "Study controls ready.", 2_500, {
      reply_markup: studyModeKeyboard(),
    });
  }
}

export async function handleExtendedStudyCallback(
  ctx: Context,
  workspace: StudyWorkspace,
  data: string,
): Promise<boolean> {
  if (!isExtendedStudyCallback(data)) return false;
  const parts = data.split(":");
  if (data === "study:onboarding") {
    await showStudyOnboarding(ctx, workspace, true);
    return true;
  }
  if (data === "study:setup:start") {
    await beginStudyConversation(workspace.id, "setup", "semester", {});
    await editOrReplyHtml(ctx, `${bold("Semester name")}\nReply to this message with the semester name.`, { reply_markup: cancelKeyboard() });
    return true;
  }
  if (data === "study:canvas:status") {
    await showCanvasStatus(ctx, workspace);
    return true;
  }
  if (data === "study:canvas:sync") {
    const progress = await editOrReplyHtml(ctx, `${bold("Syncing Canvas")}\nChecking courses, submissions, deadlines, and changes…`);
    try {
      const summary = await syncStudyCanvas(workspace, { force: true });
      await finishCanvasProgress(ctx, progress, formatCanvasSummary(summary), new InlineKeyboard()
        .text("Attention", "study:attention")
        .text("Setup", "study:onboarding"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Canvas sync failed.";
      await finishCanvasProgress(ctx, progress, `${bold("Canvas sync failed")}\n${h(message)}`, new InlineKeyboard()
        .text("Try again", "study:canvas:sync")
        .text("Canvas status", "study:canvas:status"));
    }
    return true;
  }
  if (parts[1] === "canvas" && parts[2] === "missing" && parts[3] && parts[4]) {
    const action = parts[3];
    const assignment = await prisma.studyCanvasAssignment.findFirst({
      where: {
        workspaceId: workspace.id,
        needsReview: true,
        item: { publicId: parts[4] },
      },
      include: { item: true },
    });
    if (!assignment) throw new StudyModeError("That Canvas review was already resolved.", "not_found");
    if (action === "keep") {
      await prisma.studyCanvasAssignment.update({
        where: { id: assignment.id },
        data: { status: StudyCanvasAssignmentStatus.MISSING, needsReview: false },
      });
    } else if (action === "archive") {
      await prisma.$transaction([
        prisma.studyCanvasAssignment.update({
          where: { id: assignment.id },
          data: { status: StudyCanvasAssignmentStatus.MISSING, needsReview: false, userArchivedAt: new Date() },
        }),
        prisma.studyItem.update({
          where: { id: assignment.itemId },
          data: { status: StudyItemStatus.SKIPPED, completedAt: new Date() },
        }),
      ]);
    } else {
      return false;
    }
    await prisma.auditLog.create({
      data: {
        userId: workspace.ownerUserId,
        action: `study.canvas.missing.${action}`,
        metadata: { workspaceId: workspace.id, assignmentId: assignment.id, itemId: assignment.itemId },
      },
    });
    await editOrReplyQuietAcknowledgementHtml(ctx, action === "keep" ? "Kept as local Study work." : "Archived.");
    return true;
  }
  if (data === "study:attention") {
    await showAttention(ctx, workspace, true);
    return true;
  }
  if (data === "study:preview") {
    await showWeeklyPreview(ctx, workspace, true);
    return true;
  }
  if (parts[1] === "module" && parts[2] === "open" && parts[3]) {
    const module = await setActiveStudyModule(workspace, parts[3]);
    await showModuleHub(ctx, workspace, module, true);
    return true;
  }
  if (parts[1] === "note" && parts[2] === "start") {
    const module = parts[3] ? await findStudyModule(workspace.id, parts[3]) : await requireActiveStudyModule(workspace);
    await beginStudyNoteSession(ctx, workspace, module);
    return true;
  }
  if (data === "study:note:save") {
    await finishStudyNoteSession(ctx, workspace, true);
    return true;
  }
  if (data === "study:note:cancel") {
    await cancelStudyNoteSession(ctx, workspace, true);
    return true;
  }
  if (parts[1] === "resources") {
    const kind = resourceKindFromCode(parts[2]);
    const page = Number(parts[3] ?? 1);
    const searchToken = parts[4];
    const query = searchToken
      ? (await findStudyPendingCapture(workspace.id, searchToken)).sourceText ?? undefined
      : undefined;
    await showResources(ctx, workspace, kind, page, true, query, searchToken);
    return true;
  }
  if (parts[1] === "res" && parts[2] && parts[3]) {
    const resourceId = parts[2];
    const action = parts[3];
    if (action === "view") return showResource(ctx, workspace, resourceId, Number(parts[4] ?? 0), true).then(() => true);
    if (action === "pin") {
      const resource = await findStudyResource(workspace.id, resourceId);
      await pinStudyResource(workspace, resource.id, !resource.pinnedAt);
      await showResource(ctx, workspace, resource.id, 0, true);
      return true;
    }
    if (action === "archive") {
      await archiveStudyResource(workspace, resourceId);
      await editOrReplyQuietAcknowledgementHtml(ctx, "Archived.");
      return true;
    }
  }
  if (parts[1] === "cap" && parts[2] && parts[3]) {
    const action = parts[2];
    const token = parts[3];
    if (action === "ignore") {
      await consumeStudyPendingCapture(workspace.id, token);
      await editOrReplyQuietAcknowledgementHtml(ctx, "Ignored.");
      return true;
    }
    const pending = await findStudyPendingCapture(workspace.id, token);
    if (!pending.moduleId) {
      await chooseCaptureModule(ctx, workspace, token, action);
      return true;
    }
    await resolveCapture(ctx, workspace, token, action, pending.moduleId);
    return true;
  }
  if (parts[1] === "capm" && parts[2] && parts[3] && parts[4]) {
    const token = parts[2];
    const action = parts[3];
    const module = await findStudyModule(workspace.id, parts[4]);
    await setStudyPendingCaptureModule(workspace.id, token, module.id);
    await resolveCapture(ctx, workspace, token, action, module.id);
    return true;
  }
  if (parts[1] === "capmods" && parts[2] && parts[3] && parts[4]) {
    await chooseCaptureModule(ctx, workspace, parts[2], parts[3], true, Number(parts[4]));
    return true;
  }
  if (data === "study:origins") {
    await showOrigins(ctx, workspace, true);
    return true;
  }
  if (data === "study:travel") {
    await showTravelHub(ctx, workspace, true);
    return true;
  }
  if (data === "study:travel:blocks") {
    await showTravelBlocks(ctx, workspace);
    return true;
  }
  if (data === "study:travel:mute") {
    await muteStudyTravelForToday(workspace);
    await showTravelHub(ctx, workspace, true);
    return true;
  }
  if (data === "study:travel:resume") {
    await resumeStudyTravelReminders(workspace);
    await showTravelHub(ctx, workspace, true);
    return true;
  }
  if (parts[1] === "travel" && parts[2] === "route" && parts[3]) {
    await showTravelRoute(ctx, workspace, parts[3], true, true);
    return true;
  }
  if (parts[1] === "travel" && parts[2] === "change" && parts[3]) {
    await beginStudyConversation(workspace.id, "study_travel_origin", "choose", { blockId: parts[3] });
    const origins = await listStudyOrigins(workspace.id);
    const keyboard = new InlineKeyboard();
    for (const origin of origins.slice(0, 8)) keyboard.text(origin.name, `study:travel:use:${origin.id}`).row();
    keyboard.text("Add origin", "study:origin:add").text("Back", `study:travel:route:${parts[3]}`);
    await editOrReplyHtml(ctx, `${bold("Change origin")}\nChoose where this journey starts.`, { reply_markup: keyboard });
    return true;
  }
  if (parts[1] === "travel" && parts[2] === "use" && parts[3]) {
    const conversation = await getStudyConversation(workspace.id);
    const payload = conversation ? studyConversationPayload(conversation.payload) : {};
    const blockId = typeof payload.blockId === "string" ? payload.blockId : undefined;
    if (!blockId || conversation?.kind !== "study_travel_origin") throw new StudyModeError("That origin picker expired. Open Travel and try again.", "invalid");
    await updateStudyScheduleBlock(workspace, blockId, { defaultOriginId: parts[3] });
    await activateStudyOrigin(workspace, parts[3], 4);
    await clearStudyConversation(workspace.id);
    await showTravelRoute(ctx, workspace, blockId, true, true);
    return true;
  }
  if (parts[1] === "travel" && parts[2] === "arrived" && parts[3]) {
    await prisma.auditLog.create({ data: { userId: workspace.ownerUserId, action: "study.travel.arrived", metadata: { workspaceId: workspace.id, blockId: parts[3] } } });
    await editOrReplyHtml(ctx, `${bold("You’re here")}\nTravel reminder closed.`, { reply_markup: new InlineKeyboard().text("Travel", "study:travel") });
    return true;
  }
  if (parts[1] === "travel" && parts[2] === "set" && parts[3]) {
    await beginStudyConversation(workspace.id, "study_travel_block", "details", { blockId: parts[3] });
    await editOrReplyHtml(ctx, [
      bold("Class travel"),
      `Reply with ${code("Destination | Origin | Buffer")}.`,
      `Example: ${code("COM3 | Home | 15")}`,
      `Use ${code("COM3")} to keep the current origin and buffer, or ${code("off")} to remove travel reminders.`,
    ].join("\n"), { reply_markup: new InlineKeyboard().text("Cancel", "study:cancel") });
    return true;
  }
  if (parts[1] === "travel" && parts[2] === "remove" && parts[3]) {
    await clearStudyScheduleTravel(workspace, parts[3]);
    await showTravelBlocks(ctx, workspace);
    return true;
  }
  if (data === "study:origin:add") {
    await beginStudyConversation(workspace.id, "study_origin_add", "details", {});
    await editOrReplyHtml(ctx, [bold("Add travel origin"), `Reply with ${code("Name | nearby campus venue or bus stop")}.`, `Example: ${code("Home | Kent Ridge MRT")}`].join("\n"), {
      reply_markup: new InlineKeyboard().text("Cancel", "study:cancel"),
    });
    return true;
  }
  if (parts[1] === "origin" && parts[2] === "pick" && parts[3]) {
    const conversation = await getStudyConversation(workspace.id);
    const payload = conversation ? studyConversationPayload(conversation.payload) : {};
    const candidates = Array.isArray(payload.candidates) ? payload.candidates as StudyOriginPlaceCandidate[] : [];
    const candidate = candidates[Number(parts[3])];
    const name = typeof payload.name === "string" ? payload.name : undefined;
    if (conversation?.kind !== "study_origin_add" || !candidate || !name) {
      throw new StudyModeError("That place picker expired. Add the origin again.", "invalid");
    }
    const origin = await addStudyOriginFromCandidate(workspace, name, candidate, {
      makeDefault: payload.makeDefault === true,
    });
    await clearStudyConversation(workspace.id);
    await editOrReplyQuietAcknowledgementHtml(ctx, `${bold("Origin saved")} · ${h(origin.name)}`);
    return true;
  }
  if (parts[1] === "origin" && parts[2] === "rename" && parts[3]) {
    await beginStudyConversation(workspace.id, "study_origin_rename", "name", { originId: parts[3] });
    await editOrReplyHtml(ctx, `${bold("Rename origin")}\nReply with the new short name.`, {
      reply_markup: new InlineKeyboard().text("Cancel", "study:cancel"),
    });
    return true;
  }
  if (parts[1] === "origin" && parts[2] && parts[3]) {
    const action = parts[2];
    const id = parts[3];
    if (action === "use") await activateStudyOrigin(workspace, id, 4);
    else if (action === "default") await setDefaultStudyOrigin(workspace, id);
    else if (action === "delete") await deleteStudyOrigin(workspace, id);
    else return false;
    await showOrigins(ctx, workspace, true);
    return true;
  }
  return false;
}

async function executeStudyIntent(ctx: Context, workspace: StudyWorkspace, intent: StudyNaturalIntent): Promise<void> {
  switch (intent.kind) {
    case "menu":
      await replyHtml(ctx, `${bold("Study Mode")}\nCapture, plan, or recall.`, { reply_markup: studyCaptureHomeKeyboard(workspace.id), ...(ctx.message ? { reply_parameters: { message_id: ctx.message.message_id } } : {}) });
      return;
    case "study_dashboard":
      await replyHtml(ctx, `${bold("Study dashboard")}\nOpen your private Study workspace.`, {
        reply_markup: new InlineKeyboard().url("Open Study dashboard", groupDashboardUrl(workspace.id, "study-overview")),
        ...(ctx.message ? { reply_parameters: { message_id: ctx.message.message_id } } : {}),
      });
      return;
    case "timetable":
      await replyHtml(ctx, `${bold("Study timetable")}\nClasses, study blocks, and due work in one live view.`, {
        reply_markup: new InlineKeyboard().url("Open timetable", groupDashboardUrl(workspace.id, "study-timetable")),
        ...(ctx.message ? { reply_parameters: { message_id: ctx.message.message_id } } : {}),
      });
      return;
    case "onboarding":
      return showStudyOnboarding(ctx, workspace);
    case "help":
      await replyHtml(ctx, formatNaturalHelp(), { reply_markup: studyCaptureHomeKeyboard(workspace.id) });
      return;
    case "canvas_sync": {
      const progress = await ctx.reply("Syncing Canvas…");
      try {
        const summary = await syncStudyCanvas(workspace, { force: true });
        await ctx.api.editMessageText(ctx.chat!.id, progress.message_id, stripHtml(formatCanvasSummary(summary)));
      } catch (error) {
        await ctx.api.editMessageText(ctx.chat!.id, progress.message_id, error instanceof Error ? error.message : "Canvas sync failed.");
      }
      return;
    }
    case "canvas_status":
      return showCanvasStatus(ctx, workspace, false);
    case "attention":
      return showAttention(ctx, workspace);
    case "weekly_preview":
      return showWeeklyPreview(ctx, workspace);
    case "weekly_plan":
      await beginStudyConversation(workspace.id, "plan", "priorities", {});
      await replyHtml(ctx, `${bold("Plan this week")}\nReply to this message with up to three outcomes, one per line.`, { reply_markup: cancelKeyboard() });
      return;
    case "weekly_review": {
      const modules = await listStudyModules(workspace.id);
      if (!modules.length) throw new StudyModeError("Add at least one module first.", "invalid");
      await beginStudyConversation(workspace.id, "review", "processed", { moduleIndex: 0, moduleStatuses: [], current: {} });
      await replyHtml(ctx, `${bold(`1. ${modules[0]!.code}`)}\nIs the current material processed? Reply yes, no, or partly.`, { reply_markup: cancelKeyboard() });
      return;
    }
    case "record_mistake": {
      const modules = await listStudyModules(workspace.id);
      await beginStudyConversation(workspace.id, "mistake", "module", {});
      const keyboard = new InlineKeyboard();
      for (const module of modules) keyboard.text(module.code, `study:mistake:module:${module.id}`).row();
      keyboard.text("Cancel", "study:cancel");
      await replyHtml(ctx, `${bold("Record mistake")}\nChoose the module.`, { reply_markup: keyboard });
      return;
    }
    case "upcoming":
      await replyHtml(ctx, "Opening upcoming Study work.", { reply_markup: new InlineKeyboard().text("Upcoming", "study:upcoming:0") });
      return;
    case "modules":
      await replyHtml(ctx, "Choose a module.", { reply_markup: await moduleOpenKeyboard(workspace) });
      return;
    case "switch_module": {
      const module = await setActiveStudyModule(workspace, intent.reference);
      return showModuleHub(ctx, workspace, module);
    }
    case "create_task": {
      const module = await resolveExplicitCaptureModule(ctx, workspace, intent.moduleReference);
      if (!module) return deferCaptureForModule(ctx, workspace, intent.sourceText, "task");
      const item = await createStudyItem(workspace, {
        moduleId: module.id,
        type: inferStudyItemType(intent.sourceText),
        title: intent.title,
        notes: intent.sourceText,
        dueAt: intent.dueAt,
        priority: inferStudyPriority(intent.dueAt),
      });
      await replyQuietAcknowledgementHtml(ctx, [
        `${bold("Saved")} · ${code(item.publicId)} · ${bold(module.code)}`,
        h(item.title),
        intent.dueAt ? `Due ${h(formatDate(intent.dueAt, workspace.timezone))}` : "No due date",
      ].join("\n"), 3_500, { reply_markup: studyModeKeyboard() });
      return;
    }
    case "complete_item": {
      const item = await completeStudyItem(workspace, intent.reference);
      await replyQuietAcknowledgementHtml(ctx, `${bold("Completed")} · ${code(item.publicId)} · ${bold(item.module.code)}`);
      return;
    }
    case "reschedule_item": {
      const item = await rescheduleStudyItem(workspace, intent.reference, intent.dueAt);
      await replyQuietAcknowledgementHtml(ctx, `${bold(item.publicId)} · due ${h(formatDate(intent.dueAt, workspace.timezone))}`);
      return;
    }
    case "set_mastery": {
      const result = await updateStudyMastery(workspace, intent.reference, intent.mastery, intent.reason);
      const label = result.kind === "module" ? result.value.code : result.value.publicId;
      await replyQuietAcknowledgementHtml(ctx, `${bold(label)} · ${intent.mastery.toLowerCase()}${intent.reason ? `\n${h(intent.reason)}` : ""}`);
      return;
    }
    case "start_session": {
      const module = await resolveIntentModule(workspace, intent.moduleReference) ?? await requireActiveStudyModule(workspace);
      const session = await startStudySession(workspace, module.id, "Focused study");
      await replyHtml(ctx, `${bold(`${module.code} session started`)}\nFocused study`, { reply_markup: new InlineKeyboard().text("Stop", "study:session:stop") });
      void session;
      return;
    }
    case "stop_session":
      await beginStudyConversation(workspace.id, "stop", "result", {});
      await replyHtml(ctx, `${bold("Finish session")}\nReply to this message with a short result, or send skip.`, { reply_markup: cancelKeyboard() });
      return;
    case "note_session_start": {
      const module = await resolveIntentModule(workspace, intent.moduleReference) ?? await requireActiveStudyModule(workspace);
      return beginStudyNoteSession(ctx, workspace, module);
    }
    case "note_session_save":
      return finishStudyNoteSession(ctx, workspace);
    case "note_session_cancel":
      return cancelStudyNoteSession(ctx, workspace);
    case "create_resource": {
      const module = await resolveExplicitCaptureModule(ctx, workspace, intent.moduleReference);
      if (!module) return deferCaptureForModule(ctx, workspace, intent.body, captureAction(intent.resourceKind));
      const result = await createStudyResource(workspace, {
        moduleId: module.id,
        kind: intent.resourceKind,
        title: intent.title,
        body: intent.body,
        url: intent.url,
        sourceMessageId: ctx.message?.message_id,
      });
      await replyQuietAcknowledgementHtml(ctx, `${bold("Saved")} · ${code(result.resource.publicId)} · ${bold(module.code)}`, 3_500, { reply_markup: studyModeKeyboard() });
      return;
    }
    case "list_resources": {
      if (intent.moduleReference) await setActiveStudyModule(workspace, intent.moduleReference);
      return showResources(ctx, workspace, intent.resourceKind, 1, false, intent.query);
    }
    case "search":
      return showResources(ctx, workspace, undefined, 1, false, intent.query);
    case "origins":
      return showOrigins(ctx, workspace);
    case "origin_help":
      await beginStudyConversation(workspace.id, "study_origin_add", "details", {});
      await replyHtml(ctx, [
        bold("Add travel origin"),
        `Reply to this message with ${code("Name | nearby venue or NUS bus stop")}.`,
        `Example: ${code("Home | PGPR")}`,
        "Threadwise will show matching places before saving.",
      ].join("\n"), { reply_markup: cancelKeyboard() });
      return;
    case "origin_add":
      return showStudyOriginMatches(ctx, workspace, intent.name, intent.venue, intent.makeDefault);
    case "origin_activate": {
      const active = await activateStudyOrigin(workspace, intent.reference, intent.hours ?? 4);
      await replyQuietAcknowledgementHtml(ctx, `${bold("Current origin")} · ${h(active.origin.name)} · until ${h(formatDate(active.until, workspace.timezone))}`);
      return;
    }
    case "origin_here": {
      const origin = await addStudyOriginFromVenue(workspace, "Current location", intent.venue, { activateHours: intent.hours ?? 4 });
      await replyQuietAcknowledgementHtml(ctx, `${bold("Current origin")} · ${h(origin.name)} · ${intent.hours ?? 4} hours`);
      return;
    }
    case "origin_rename": {
      const origin = await renameStudyOrigin(workspace, intent.reference, intent.name);
      await replyQuietAcknowledgementHtml(ctx, `${bold("Origin renamed")} · ${h(origin.name)}`);
      return;
    }
    case "origin_delete":
      await deleteStudyOrigin(workspace, intent.reference);
      await replyQuietAcknowledgementHtml(ctx, "Origin removed.");
      return;
    case "route": {
      const journey = await estimateStudyJourney(workspace, intent.destination, intent.origin);
      await replyHtml(ctx, formatJourney(journey), { reply_markup: new InlineKeyboard().text("Travel origins", "study:origins") });
      return;
    }
    case "ambiguous":
      return showStudyCaptureChoice(ctx, workspace, intent.sourceText, intent.moduleReference);
  }
}

export async function showStudyOriginMatches(
  ctx: Context,
  workspace: StudyWorkspace,
  name: string,
  query: string,
  makeDefault = false,
): Promise<void> {
  const candidates = await searchStudyOriginPlaces(query, 8);
  const conversation = await getStudyConversation(workspace.id);
  const keepOriginFlow = async (step: string, payload: { name: string; query: string; makeDefault: boolean; candidates?: StudyOriginPlaceCandidate[] }) => {
    if (conversation?.kind === "study_origin_add") await advanceStudyConversation(workspace.id, step, payload);
    else await beginStudyConversation(workspace.id, "study_origin_add", step, payload);
  };
  if (candidates.length === 0) {
    await keepOriginFlow("details", { name, query, makeDefault });
    await replyHtml(ctx, [
      bold("No matching place yet"),
      `I couldn't match ${h(query)} to a campus venue or NUS bus stop.`,
      `Reply again with ${code("Name | venue or stop")}, or send your Telegram location.`,
    ].join("\n"), { reply_markup: cancelKeyboard() });
    return;
  }
  await keepOriginFlow("choose_place", { name, query, makeDefault, candidates });
  const keyboard = new InlineKeyboard();
  candidates.forEach((candidate, index) => {
    const suffix = candidate.kind === "stop" ? " · stop" : "";
    keyboard.text(`${candidate.title}${suffix}`.slice(0, 58), `study:origin:pick:${index}`).row();
  });
  keyboard.text("Search again", "study:origin:add").text("Cancel", "study:cancel");
  await replyHtml(ctx, [
    bold(`Choose a match for ${name}`),
    `Search: ${h(query)}`,
    "Select the venue or bus stop you meant.",
  ].join("\n"), { reply_markup: keyboard });
}

async function handleStudyMedia(ctx: Context, workspace: StudyWorkspace, media: StudyMedia): Promise<void> {
  const parsed = media.caption ? parseStudyNaturalLanguage(media.caption, workspace.timezone) : undefined;
  const moduleRef = parsed && "moduleReference" in parsed ? parsed.moduleReference : undefined;
  const module = await resolveExplicitCaptureModule(ctx, workspace, moduleRef);
  const resourceKind = media.mimeType?.startsWith("image/") || media.mediaKind === "photo" ? StudyResourceKind.IMAGE : StudyResourceKind.FILE;
  if (!module) {
    const pending = await createStudyPendingCapture(workspace, {
      telegramFileId: media.telegramFileId,
      telegramUniqueId: media.telegramUniqueId,
      mediaKind: media.mediaKind,
      mimeType: media.mimeType,
      fileName: media.fileName,
      fileSize: media.fileSize,
      sourceText: media.caption,
      sourceMessageId: media.sourceMessageId,
    });
    await chooseCaptureModule(ctx, workspace, pending.token, resourceKind === StudyResourceKind.IMAGE ? "image" : "file", false);
    return;
  }
  await saveStudyMedia(ctx, workspace, module, media, resourceKind);
}

async function saveStudyMedia(ctx: Context, workspace: StudyWorkspace, module: StudyModule, media: StudyMedia, kind: StudyResourceKind): Promise<void> {
  const result = await createStudyResource(workspace, {
    moduleId: module.id,
    kind,
    title: media.caption || media.fileName,
    caption: media.caption,
    telegramFileId: media.telegramFileId,
    telegramUniqueId: media.telegramUniqueId,
    mediaKind: media.mediaKind,
    mimeType: media.mimeType,
    fileName: media.fileName,
    fileSize: media.fileSize,
    sourceMessageId: media.sourceMessageId,
  });
  const imageLike = media.mediaKind === "photo" || media.mimeType?.startsWith("image/");
  await replyQuietAcknowledgementHtml(ctx, `${bold(result.duplicate ? "Already saved" : "Saved")} · ${code(result.resource.publicId)} · ${bold(module.code)}${imageLike ? "\nIndexing visible text…" : ""}`, 3_500, { reply_markup: studyModeKeyboard() });
  if (imageLike && !result.duplicate && (!media.fileSize || media.fileSize <= MAX_IMAGE_BYTES)) {
    void indexStudyImage(ctx, workspace, result.resource.id, media).catch((error) => {
      logger.warn("Study image OCR indexing failed.", { resourceId: result.resource.id, error: String(error) });
    });
  }
}

async function indexStudyImage(ctx: Context, workspace: StudyWorkspace, resourceId: string, media: StudyMedia): Promise<void> {
  const file = await ctx.api.getFile(media.telegramFileId);
  if (!file.file_path) return;
  const response = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`);
  if (!response.ok) throw new Error(`Telegram download failed (${response.status}).`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_IMAGE_BYTES) return;
  const settings = await prisma.userSettings.findUnique({ where: { userId: workspace.ownerUserId } });
  const languages = ocrLanguagesForCaption(media.caption ?? "", settings?.ocrLanguages ?? "eng");
  const extracted = await extractTextFromImage(buffer, languages);
  await updateStudyResourceOcr(workspace.id, resourceId, extracted.text, extracted.confidence);
}

async function showStudyCaptureChoice(ctx: Context, workspace: StudyWorkspace, sourceText: string, moduleReference?: string): Promise<void> {
  const module = await resolveExplicitCaptureModule(ctx, workspace, moduleReference).catch(() => undefined);
  const pending = await createStudyPendingCapture(workspace, {
    moduleId: module?.id,
    sourceText,
    sourceMessageId: ctx.message?.message_id,
  });
  await replyHtml(ctx, [
    bold("What should I keep this as?"),
    module ? `${bold(module.code)} · ${h(truncate(sourceText, 180))}` : h(truncate(sourceText, 180)),
  ].join("\n"), { reply_markup: captureChoiceKeyboard(pending.token) });
}

async function deferCaptureForModule(ctx: Context, workspace: StudyWorkspace, sourceText: string, action: string): Promise<void> {
  const pending = await createStudyPendingCapture(workspace, { sourceText, sourceMessageId: ctx.message?.message_id });
  await chooseCaptureModule(ctx, workspace, pending.token, action, false);
}

async function chooseCaptureModule(ctx: Context, workspace: StudyWorkspace, token: string, action: string, edit = true, requestedPage = 0): Promise<void> {
  const modules = await listStudyModules(workspace.id);
  const pageSize = 6;
  const pageCount = Math.max(1, Math.ceil(modules.length / pageSize));
  const page = Math.max(0, Math.min(pageCount - 1, Math.trunc(requestedPage)));
  const visible = modules.slice(page * pageSize, page * pageSize + pageSize);
  const keyboard = new InlineKeyboard();
  visible.forEach((module, index) => {
    // Keep callback_data below Telegram's 64-byte limit; module codes are
    // workspace-unique and are revalidated as active before any write.
    keyboard.text(module.code, `study:capm:${token}:${action}:${module.code}`);
    if (index % 2 === 1) keyboard.row();
  });
  if (visible.length % 2 === 1) keyboard.row();
  if (pageCount > 1) {
    if (page > 0) keyboard.text("Prev", `study:capmods:${token}:${action}:${page - 1}`);
    keyboard.text(`${page + 1}/${pageCount}`, `study:capmods:${token}:${action}:${page}`);
    if (page + 1 < pageCount) keyboard.text("Next", `study:capmods:${token}:${action}:${page + 1}`);
    keyboard.row();
  }
  keyboard.text("Cancel", `study:cap:ignore:${token}`);
  const text = `${bold("Where should I save this?")}\nChoose one of your current modules.`;
  if (edit) await editOrReplyHtml(ctx, text, { reply_markup: keyboard });
  else await replyHtml(ctx, text, { reply_markup: keyboard });
}

async function resolveCapture(ctx: Context, workspace: StudyWorkspace, token: string, action: string, moduleId: string): Promise<void> {
  const module = await findStudyModule(workspace.id, moduleId);
  if (!module.active) throw new StudyModeError("That module is inactive. Choose a current module instead.", "invalid");
  // Claim before writing so duplicate or stale callback taps cannot create two records.
  const pending = await consumeStudyPendingCapture(workspace.id, token);
  if (action === "task") {
    const text = pending.sourceText?.trim() || pending.fileName || "Study task";
    const item = await createStudyItem(workspace, {
      moduleId: module.id,
      type: inferStudyItemType(text),
      title: cleanCaptureTitle(text),
      notes: text,
      priority: StudyPriority.NORMAL,
    });
    await editOrReplyQuietAcknowledgementHtml(ctx, `${bold("Saved")} · ${code(item.publicId)} · ${bold(module.code)}`);
    return;
  }
  const kind = action === "note" ? StudyResourceKind.NOTE
    : action === "question" ? StudyResourceKind.QUESTION
      : action === "image" ? StudyResourceKind.IMAGE
        : action === "file" ? StudyResourceKind.FILE
          : StudyResourceKind.LINK;
  const result = await createStudyResource(workspace, {
    moduleId: module.id,
    kind,
    title: pending.sourceText ?? pending.fileName ?? undefined,
    body: pending.sourceText ?? undefined,
    url: pending.sourceText?.match(/https?:\/\/\S+/)?.[0],
    telegramFileId: pending.telegramFileId ?? undefined,
    telegramUniqueId: pending.telegramUniqueId ?? undefined,
    mediaKind: pending.mediaKind ?? undefined,
    mimeType: pending.mimeType ?? undefined,
    fileName: pending.fileName ?? undefined,
    fileSize: pending.fileSize ?? undefined,
    caption: pending.sourceText ?? undefined,
    sourceMessageId: pending.sourceMessageId ?? undefined,
  });
  await editOrReplyQuietAcknowledgementHtml(ctx, `${bold("Saved")} · ${code(result.resource.publicId)} · ${bold(module.code)}`);
  if (kind === StudyResourceKind.IMAGE && pending.telegramFileId) {
    void indexStudyImage(ctx, workspace, result.resource.id, {
      telegramFileId: pending.telegramFileId,
      telegramUniqueId: pending.telegramUniqueId ?? undefined,
      mediaKind: pending.mediaKind === "document" ? "document" : "photo",
      mimeType: pending.mimeType ?? undefined,
      fileName: pending.fileName ?? undefined,
      fileSize: pending.fileSize ?? undefined,
      caption: pending.sourceText ?? undefined,
      sourceMessageId: pending.sourceMessageId ?? undefined,
    }).catch(() => undefined);
  }
}

async function showAttention(ctx: Context, workspace: StudyWorkspace, edit = false): Promise<void> {
  const snapshot = await buildStudyAttentionSnapshot(workspace);
  const text = [
    bold("Needs attention"),
    `${snapshot.overdue} overdue · ${snapshot.dueToday} today · ${snapshot.dueThisWeek} next 7 days`,
    snapshot.redModules.length ? `Red modules: ${snapshot.redModules.map(bold).join(", ")}` : undefined,
    "",
    ...(snapshot.items.length ? snapshot.items.slice(0, 6).map((item, index) => [
      `${index + 1}. ${code(item.publicId)} · ${bold(item.moduleCode)} · score ${item.score}`,
      h(truncate(item.title, 180)),
      `${h(item.reasons.join(" · "))}\n${h(item.recommendedAction)}`,
    ].join("\n")) : ["Nothing needs attention right now."]),
  ].filter(Boolean).join("\n\n");
  const keyboard = new InlineKeyboard().text("Weekly preview", "study:preview").text("Upcoming", "study:upcoming:0").row().text("Home", "study:dashboard");
  if (edit) await editOrReplyHtml(ctx, text, { reply_markup: keyboard });
  else await replyHtml(ctx, text, { reply_markup: keyboard });
}

async function showWeeklyPreview(ctx: Context, workspace: StudyWorkspace, edit = false): Promise<void> {
  const preview = await buildStudyWeeklyPreview(workspace);
  const text = [
    bold(`Week ${preview.weekNumber || "ahead"}`),
    `${h(formatDay(preview.rangeStart, workspace.timezone))} – ${h(formatDay(preview.rangeEnd, workspace.timezone))}`,
    `${preview.due.length} dated item${preview.due.length === 1 ? "" : "s"} · ${preview.plannedMinutes} planned min · ${preview.overdue} overdue`,
    "",
    ...(preview.due.length ? preview.due.slice(0, 8).map((item) => `${code(item.publicId)} · ${bold(item.moduleCode)}\n${h(truncate(item.title, 150))}\n${h(item.dueAt ? formatDate(item.dueAt, workspace.timezone) : "")}`) : ["No dated work this week."]),
    preview.items.length ? `\n${bold("Start here")}\n${code(preview.items[0]!.publicId)} · ${h(preview.items[0]!.recommendedAction)}` : undefined,
  ].filter(Boolean).join("\n\n");
  const keyboard = new InlineKeyboard().text("Attention", "study:attention").text("Plan week", "study:plan").row().text("Home", "study:dashboard");
  if (edit) await editOrReplyHtml(ctx, text, { reply_markup: keyboard });
  else await replyHtml(ctx, text, { reply_markup: keyboard });
}

async function showCanvasStatus(ctx: Context, workspace: StudyWorkspace, edit = true): Promise<void> {
  const [status, missing] = await Promise.all([
    studyCanvasStatus(workspace.id),
    prisma.studyCanvasAssignment.count({ where: { workspaceId: workspace.id, needsReview: true } }),
  ]);
  const text = !studyCanvasConfigured()
    ? [bold("Canvas is not connected"), `Add ${code("CANVAS_ACCESS_TOKEN")} as a Render secret, then redeploy.`, "Do not paste the token into Telegram."].join("\n")
    : [
      bold("Canvas sync"),
      `Status · ${h(status?.status.toLowerCase() ?? "ready")}`,
      status?.canvasUserName ? `Account · ${h(status.canvasUserName)}` : undefined,
      status?.lastSuccessfulAt ? `Last sync · ${h(formatDate(status.lastSuccessfulAt, workspace.timezone))}` : "Not synced yet",
      status?.lastError ? `Last issue · ${h(status.lastError)}` : undefined,
      missing ? `${missing} missing assignment${missing === 1 ? "" : "s"} need review.` : undefined,
      `Automatic sync runs every ${env.STUDY_CANVAS_SYNC_INTERVAL_MINUTES} minutes.`,
    ].filter(Boolean).join("\n");
  const keyboard = new InlineKeyboard();
  if (studyCanvasConfigured()) keyboard.text("Sync now", "study:canvas:sync").row();
  keyboard.text("Setup", "study:onboarding").text("Home", "study:dashboard");
  if (edit) await editOrReplyHtml(ctx, text, { reply_markup: keyboard });
  else await replyHtml(ctx, text, { reply_markup: keyboard });
}

async function showModuleHub(ctx: Context, workspace: StudyWorkspace, module: StudyModule, edit = false): Promise<void> {
  const [open, resources] = await Promise.all([
    prisma.studyItem.count({ where: { workspaceId: workspace.id, moduleId: module.id, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    prisma.studyResource.groupBy({ by: ["kind"], where: { workspaceId: workspace.id, moduleId: module.id, archivedAt: null }, _count: true }),
  ]);
  const count = (kind: StudyResourceKind) => resources.find((row) => row.kind === kind)?._count ?? 0;
  const text = [
    `${bold(module.code)} · ${h(module.name)}`,
    `${open} open · ${count(StudyResourceKind.NOTE)} notes · ${count(StudyResourceKind.IMAGE)} images · ${count(StudyResourceKind.QUESTION)} questions`,
    "Opening a module changes this view only. Captures need an explicit module.",
  ].join("\n");
  const keyboard = new InlineKeyboard()
    .text("Add work", "study:add:start").text("Note session", `study:note:start:${module.id}`).row()
    .text("Notes", "study:resources:n:1").text("Questions", "study:resources:q:1").row()
    .text("Images", "study:resources:i:1").text("All resources", "study:resources:a:1").row()
    .text("Switch module", "study:modules").text("Home", "study:dashboard");
  if (edit) await editOrReplyHtml(ctx, text, { reply_markup: keyboard });
  else await replyHtml(ctx, text, { reply_markup: keyboard });
}

async function showResources(
  ctx: Context,
  workspace: StudyWorkspace,
  kind?: StudyResourceKind,
  page = 1,
  edit = false,
  query?: string,
  existingSearchToken?: string,
): Promise<void> {
  const module = query ? undefined : await activeStudyModule(workspace);
  const result = await listStudyResources(workspace.id, { moduleId: module?.id, kind, query, page });
  const searchToken = query && result.totalPages > 1 && !existingSearchToken
    ? (await createStudyPendingCapture(workspace, { sourceText: query })).token
    : existingSearchToken;
  const heading = query ? `Search · ${query}` : `${module?.code ?? "Study"} · ${kind ? humanKind(kind) : "resources"}`;
  const text = [
    bold(`${heading}${result.totalPages > 1 ? ` · ${result.page}/${result.totalPages}` : ""}`),
    "",
    ...(result.resources.length ? result.resources.map((resource, index) => `${(result.page - 1) * 6 + index + 1}. ${resource.pinnedAt ? "⌁ " : ""}${code(resource.publicId)} · ${bold(resource.module.code)}\n${h(truncate(resource.title, 150))}`) : [query ? "Nothing matched." : "Nothing saved here yet."]),
  ].join("\n\n");
  const keyboard = new InlineKeyboard();
  for (const resource of result.resources) keyboard.text(resource.publicId, `study:res:${resource.id}:view:0`).row();
  if (result.totalPages > 1) {
    const suffix = searchToken ? `:${searchToken}` : "";
    if (result.page > 1) keyboard.text("←", `study:resources:${resourceKindCode(kind)}:${result.page - 1}${suffix}`);
    keyboard.text(`${result.page}/${result.totalPages}`, `study:resources:${resourceKindCode(kind)}:${result.page}${suffix}`);
    if (result.page < result.totalPages) keyboard.text("→", `study:resources:${resourceKindCode(kind)}:${result.page + 1}${suffix}`);
    keyboard.row();
  }
  keyboard.text("Module", module ? `study:module:open:${module.id}` : "study:modules").text("Home", "study:dashboard");
  if (edit) await editOrReplyHtml(ctx, text, { reply_markup: keyboard });
  else await replyHtml(ctx, text, { reply_markup: keyboard });
}

async function showResource(ctx: Context, workspace: StudyWorkspace, reference: string, requestedPage = 0, edit = false): Promise<void> {
  const resource = await findStudyResource(workspace.id, reference);
  const body = resource.body || resource.caption || resource.ocrText || resource.url || resource.fileName || "No text.";
  const pages = paginateStudyText(body);
  const page = Math.min(Math.max(0, requestedPage), pages.length - 1);
  const text = [
    `${resource.pinnedAt ? "⌁ " : ""}${bold(resource.title)}`,
    `${code(resource.publicId)} · ${bold(resource.module.code)} · ${humanKind(resource.kind)}`,
    "",
    h(pages[page]),
    resource.url && !pages[page]?.includes(resource.url) ? `\n${h(resource.url)}` : undefined,
  ].filter(Boolean).join("\n");
  const keyboard = new InlineKeyboard();
  if (pages.length > 1) {
    if (page > 0) keyboard.text("←", `study:res:${resource.id}:view:${page - 1}`);
    keyboard.text(`${page + 1}/${pages.length}`, `study:res:${resource.id}:view:${page}`);
    if (page < pages.length - 1) keyboard.text("→", `study:res:${resource.id}:view:${page + 1}`);
    keyboard.row();
  }
  keyboard.text(resource.pinnedAt ? "Unpin" : "Pin", `study:res:${resource.id}:pin`).text("Archive", `study:res:${resource.id}:archive`).row()
    .text("Back", `study:resources:${resourceKindCode(resource.kind)}:1`);
  const mediaCaption = truncate([
    resource.title,
    `${resource.publicId} · ${resource.module.code}`,
    resource.caption && resource.caption !== resource.title ? resource.caption : undefined,
    resource.ocrText ? `Indexed text: ${resource.ocrText}` : undefined,
  ].filter(Boolean).join("\n\n"), 980);
  const imageLike = resource.mediaKind === "photo" || resource.mimeType?.startsWith("image/");
  if (imageLike && resource.telegramFileId) {
    const callbackMessage = ctx.callbackQuery?.message;
    if (edit && callbackMessage && "photo" in callbackMessage) {
      try {
        await ctx.editMessageCaption({ caption: mediaCaption, reply_markup: keyboard });
        return;
      } catch {
        // A stale or non-editable media card falls back to a fresh card below.
      }
    }
    await ctx.replyWithPhoto(resource.telegramFileId, {
      caption: mediaCaption,
      reply_markup: keyboard,
    });
    return;
  }
  if (!imageLike && resource.telegramFileId) {
    const callbackMessage = ctx.callbackQuery?.message;
    if (edit && callbackMessage && "document" in callbackMessage) {
      try {
        await ctx.editMessageCaption({ caption: mediaCaption, reply_markup: keyboard });
        return;
      } catch {
        // A stale or non-editable media card falls back to a fresh card below.
      }
    }
    await ctx.replyWithDocument(resource.telegramFileId, {
      caption: mediaCaption,
      reply_markup: keyboard,
    });
    return;
  }
  if (edit) await editOrReplyHtml(ctx, text, { reply_markup: keyboard });
  else await replyHtml(ctx, text, { reply_markup: keyboard });
}

async function showOrigins(ctx: Context, workspace: StudyWorkspace, edit = false): Promise<void> {
  const origins = await listStudyOrigins(workspace.id);
  const fresh = await prisma.studyWorkspace.findUnique({ where: { id: workspace.id } });
  const text = [
    bold("Travel origins"),
    ...(origins.length ? origins.map((origin) => `${origin.id === fresh?.activeOriginId && fresh.activeOriginUntil && fresh.activeOriginUntil > new Date() ? "→" : origin.isDefault ? "⌂" : "·"} ${bold(origin.name)}${origin.isDefault ? " · default" : ""}`) : ["No origins saved."]),
    "",
    `Say ${code("add origin Home at Kent Ridge MRT")}, send a location, or say ${code("I'm at COM3")}.`,
  ].join("\n");
  const keyboard = new InlineKeyboard();
  for (const origin of origins.slice(0, 5)) {
    keyboard.text(`Use ${origin.name}`, `study:origin:use:${origin.id}`).text("Default", `study:origin:default:${origin.id}`).row()
      .text("Rename", `study:origin:rename:${origin.id}`).text("Remove", `study:origin:delete:${origin.id}`).row();
  }
  keyboard.text("Add origin", "study:origin:add").row()
    .text("Setup", "study:onboarding").text("Home", "study:dashboard");
  if (edit) await editOrReplyHtml(ctx, text, { reply_markup: keyboard });
  else await replyHtml(ctx, text, { reply_markup: keyboard });
}

async function beginStudyNoteSession(ctx: Context, workspace: StudyWorkspace, module: StudyModule): Promise<void> {
  const result = await startStudyNoteCaptureSession(workspace, module.id);
  await replyQuietAcknowledgementHtml(ctx, result.resumed
    ? `${bold(`${module.code} note resumed`)}\nKeep sending paragraphs, then tap Save note.`
    : `${bold(`${module.code} note started`)}\nEach message becomes one paragraph.`, 3_500, { reply_markup: studyNoteModeKeyboard() });
}

async function finishStudyNoteSession(ctx: Context, workspace: StudyWorkspace, edit = false): Promise<void> {
  const result = await finalizeStudyNoteCaptureSession(workspace);
  const text = result?.resource
    ? `${bold("Saved")} · ${code(result.resource.publicId)} · ${bold(result.module.code)}\n${h(result.resource.title)}\n${result.paragraphCount} paragraph${result.paragraphCount === 1 ? "" : "s"}`
    : "No Study note session is active.";
  if (edit) await editOrReplyQuietAcknowledgementHtml(ctx, text);
  else await replyQuietAcknowledgementHtml(ctx, text, 3_500, { reply_markup: studyModeKeyboard() });
}

async function cancelStudyNoteSession(ctx: Context, workspace: StudyWorkspace, edit = false): Promise<void> {
  const count = await cancelStudyNoteCaptureSession(workspace.id);
  const text = count ? `Canceled · ${count} unsaved paragraph${count === 1 ? "" : "s"} removed.` : "No Study note session is active.";
  if (edit) await editOrReplyQuietAcknowledgementHtml(ctx, text);
  else await replyQuietAcknowledgementHtml(ctx, text, 3_500, { reply_markup: studyModeKeyboard() });
}

async function resolveIntentModule(workspace: StudyWorkspace, reference?: string): Promise<StudyModule | undefined> {
  return reference ? findStudyModule(workspace.id, reference) : undefined;
}

async function resolveExplicitCaptureModule(ctx: Context, workspace: StudyWorkspace, reference?: string): Promise<StudyModule | undefined> {
  if (reference) return findStudyModule(workspace.id, reference);
  const replied = ctx.message?.reply_to_message;
  if (!replied?.from || replied.from.id !== ctx.me.id) return undefined;
  const replyText = "text" in replied ? replied.text : "caption" in replied ? replied.caption : undefined;
  if (!replyText) return undefined;
  const modules = await listStudyModules(workspace.id);
  const matches = modules.filter((module) => new RegExp(`(^|[^A-Z0-9])${escapeRegExp(module.code)}([^A-Z0-9]|$)`, "i").test(replyText));
  return matches.length === 1 ? matches[0] : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function moduleOpenKeyboard(workspace: StudyWorkspace): Promise<InlineKeyboard> {
  const modules = await listStudyModules(workspace.id);
  const keyboard = new InlineKeyboard();
  modules.forEach((module, index) => {
    keyboard.text(module.code, `study:module:open:${module.id}`);
    if (index % 2 === 1) keyboard.row();
  });
  return keyboard.row().text("Home", "study:dashboard");
}

function studyCaptureHomeKeyboard(workspaceId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Attention", "study:attention").text("Upcoming", "study:upcoming:0").row()
    .text("Modules", "study:modules").text("Canvas", "study:canvas:status").row()
    .text("Plan week", "study:plan").text("Weekly review", "study:review:start").row()
    .text("Travel", "study:travel").text("Weekly preview", "study:preview").row()
    .text("Setup", "study:onboarding").row()
    .url("Timetable", groupDashboardUrl(workspaceId, "study-timetable")).url("Study dashboard", groupDashboardUrl(workspaceId, "study-overview"));
}

async function showTravelHub(ctx: Context, workspace: StudyWorkspace, edit = false): Promise<void> {
  const [fresh, origin, upcoming] = await Promise.all([
    prisma.studyWorkspace.findUniqueOrThrow({ where: { id: workspace.id } }),
    currentStudyOrigin(workspace),
    listUpcomingStudyTravelBlocks(workspace),
  ]);
  const muted = isStudyTravelMuted(fresh);
  const text = [
    bold("Travel"),
    origin ? `From · ${h(origin.name)}` : "No origin saved.",
    muted ? "Departure reminders are muted for today." : "Live routes refresh before configured classes.",
    "",
    bold("Upcoming destinations"),
    ...(upcoming.length
      ? upcoming.slice(0, 5).map(({ block, startsAt }) => `${h(DateTime.fromJSDate(startsAt).setZone(workspace.timezone).toFormat("ccc h:mm a"))} · ${h(block.venueName ?? block.label)}`)
      : ["No class destinations configured."]),
  ].join("\n");
  const keyboard = new InlineKeyboard();
  for (const { block } of upcoming.slice(0, 3)) keyboard.text(`Refresh ${truncate(block.venueName ?? block.label, 22)}`, `study:travel:route:${block.id}`).row();
  keyboard.text("Saved origins", "study:origins").text("Class destinations", "study:travel:blocks").row();
  if (muted) keyboard.text("Resume reminders", "study:travel:resume").row();
  else keyboard.text("Mute today", "study:travel:mute").row();
  keyboard.text("Home", "study:dashboard");
  if (edit) await editOrReplyHtml(ctx, text, { reply_markup: keyboard });
  else await replyHtml(ctx, text, { reply_markup: keyboard });
}

async function showTravelBlocks(ctx: Context, workspace: StudyWorkspace): Promise<void> {
  const blocks = await prisma.studyScheduleBlock.findMany({
    where: { workspaceId: workspace.id, active: true, OR: [{ moduleId: null }, { module: { active: true } }] },
    include: { module: true, defaultOrigin: true },
    orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
    take: 12,
  });
  const text = [
    bold("Class destinations"),
    blocks.length ? "Choose a timetable block." : "Add timetable blocks from Study dashboard settings first.",
    ...blocks.map((block) => `${block.destinationStopId ? "✓" : "○"} ${h(block.module?.code ?? block.label)} · ${h(block.startTime)}${block.venueName ? ` · ${h(block.venueName)}` : ""}`),
  ].join("\n");
  const keyboard = new InlineKeyboard();
  for (const block of blocks.slice(0, 8)) {
    keyboard.text(`${block.destinationStopId ? "Edit" : "Set"} ${truncate(block.module?.code ?? block.label, 18)}`, `study:travel:set:${block.id}`);
    if (block.destinationStopId) keyboard.text("Remove", `study:travel:remove:${block.id}`);
    keyboard.row();
  }
  keyboard.text("Back", "study:travel");
  await editOrReplyHtml(ctx, text, { reply_markup: keyboard });
}

async function showTravelRoute(ctx: Context, workspace: StudyWorkspace, blockId: string, edit = false, force = false): Promise<void> {
  const plan = await buildStudyDeparturePlan(workspace, blockId, { force });
  const starts = DateTime.fromJSDate(plan.startsAt).setZone(workspace.timezone);
  const leaves = DateTime.fromJSDate(plan.leaveAt).setZone(workspace.timezone);
  const text = [
    bold(`Leave by ${leaves.toFormat("h:mm a")}`),
    `${h(plan.journey.services.length ? plan.journey.services.join(" → ") : "Usual route")} from ${h(plan.journey.boardingStop.title)}`,
    plan.live && plan.journey.waitMinutes !== undefined ? `Live arrival · ${plan.journey.waitMinutes} min` : "Live buses unavailable · normal estimate",
    plan.journey.walkMinutes !== undefined ? `Walk · ~${plan.journey.walkMinutes} min` : undefined,
    `Journey · ~${Math.max(1, plan.journey.totalMinutes ?? 30)} min + ${plan.block.travelBufferMinutes} min buffer`,
    `${h(plan.block.venueName ?? plan.journey.destinationStop.title)} · ${starts.toFormat("ccc h:mm a")}`,
  ].filter(Boolean).join("\n");
  const keyboard = new InlineKeyboard()
    .text("Refresh", `study:travel:route:${plan.block.id}`).text("Change origin", `study:travel:change:${plan.block.id}`).row()
    .text("I’m here", `study:travel:arrived:${plan.block.id}`).text("Mute today", "study:travel:mute").row()
    .text("Travel", "study:travel");
  if (edit) await editOrReplyHtml(ctx, text, { reply_markup: keyboard });
  else await replyHtml(ctx, text, { reply_markup: keyboard });
}

function captureChoiceKeyboard(token: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Task", `study:cap:task:${token}`).text("Note", `study:cap:note:${token}`).row()
    .text("Question", `study:cap:question:${token}`).text("Resource", `study:cap:resource:${token}`).row()
    .text("Ignore", `study:cap:ignore:${token}`);
}

function cancelKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("Cancel", "study:cancel");
}

function resourceKindFromCode(value: string | undefined): StudyResourceKind | undefined {
  return value === "n" ? StudyResourceKind.NOTE
    : value === "q" ? StudyResourceKind.QUESTION
      : value === "i" ? StudyResourceKind.IMAGE
        : value === "f" ? StudyResourceKind.FILE
          : value === "l" ? StudyResourceKind.LINK
            : undefined;
}

function resourceKindCode(value: StudyResourceKind | undefined): string {
  return value === StudyResourceKind.NOTE ? "n"
    : value === StudyResourceKind.QUESTION ? "q"
      : value === StudyResourceKind.IMAGE ? "i"
        : value === StudyResourceKind.FILE ? "f"
          : value === StudyResourceKind.LINK ? "l"
            : "a";
}

function captureAction(kind: StudyResourceKind): string {
  return kind === StudyResourceKind.NOTE ? "note"
    : kind === StudyResourceKind.QUESTION ? "question"
      : kind === StudyResourceKind.IMAGE ? "image"
        : kind === StudyResourceKind.FILE ? "file"
          : "resource";
}

function inferStudyItemType(text: string): StudyItemType {
  if (/\b(?:tutorial|tut)\b/i.test(text)) return StudyItemType.TUTORIAL;
  if (/\blab(?:oratory)?\b/i.test(text)) return StudyItemType.LAB;
  if (/\b(?:lecture|lec)\b/i.test(text)) return StudyItemType.LECTURE;
  if (/\b(?:project|milestone)\b/i.test(text)) return StudyItemType.PROJECT;
  if (/\b(?:read|reading|chapter|pre-read)\b/i.test(text)) return StudyItemType.READING;
  if (/\b(?:revise|revision|review|practice|worksheet)\b/i.test(text)) return StudyItemType.REVISION;
  return StudyItemType.ASSIGNMENT;
}

function inferStudyPriority(dueAt?: Date): StudyPriority {
  if (!dueAt) return StudyPriority.NORMAL;
  const hours = (dueAt.getTime() - Date.now()) / 3_600_000;
  return hours <= 24 ? StudyPriority.CRITICAL : hours <= 7 * 24 ? StudyPriority.HIGH : StudyPriority.NORMAL;
}

function cleanCaptureTitle(text: string): string {
  const cleaned = text
    .replace(/^(?:todo|task|note|question|resource)\s*[:\-]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return truncate(cleaned || "Study capture", 120);
}

function formatCanvasSummary(summary: Awaited<ReturnType<typeof syncStudyCanvas>>): string {
  return [
    bold("Canvas synced"),
    `${summary.courses} courses · ${summary.assignmentsSeen} assignments checked`,
    `${summary.imported} new · ${summary.updated} updated · ${summary.completed} submitted`,
    summary.missing ? `${summary.missing} missing item${summary.missing === 1 ? "" : "s"} flagged for review` : "No missing items",
  ].join("\n");
}

async function finishCanvasProgress(
  ctx: Context,
  progress: unknown,
  text: string,
  keyboard: InlineKeyboard,
): Promise<void> {
  const ephemeral = ephemeralDeletionTarget(ctx, progress);
  if (ephemeral) {
    try {
      await editEphemeralMessageText(
        ephemeral.chatId,
        ephemeral.receiverUserId,
        ephemeral.ephemeralMessageId,
        text,
        { parse_mode: "HTML", reply_markup: keyboard },
      );
      return;
    } catch (error) {
      logger.warn("Study Canvas progress could not update its ephemeral message.", {
        chatId: String(ephemeral.chatId),
        error: String(error),
      });
    }
  }

  const message = telegramMessageTarget(progress);
  if (message) {
    try {
      await ctx.api.editMessageText(message.chatId, message.messageId, text, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
      return;
    } catch (error) {
      logger.warn("Study Canvas progress could not update its Telegram message.", {
        chatId: String(message.chatId),
        messageId: message.messageId,
        error: String(error),
      });
    }
  }

  // The Study group is sealed to the configured owner and bot, so this final
  // fallback is safe and ensures a long-running sync never leaves stale status.
  await replyHtml(ctx, text, { reply_markup: keyboard });
}

function telegramMessageTarget(value: unknown): { chatId: number | string; messageId: number } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const message = value as { message_id?: unknown; chat?: { id?: unknown } };
  if (typeof message.message_id !== "number") return undefined;
  const chatId = message.chat?.id;
  if (typeof chatId !== "number" && typeof chatId !== "string") return undefined;
  return { chatId, messageId: message.message_id };
}

function formatJourney(journey: Awaited<ReturnType<typeof estimateStudyJourney>>): string {
  return [
    bold(`${journey.origin.name} → ${journey.destinationStop.title}`),
    journey.services.length ? `Bus · ${journey.services.join(" → ")}` : undefined,
    journey.walkMinutes !== undefined ? `Walk · ~${journey.walkMinutes} min` : undefined,
    journey.waitMinutes !== undefined ? `Live wait · ~${journey.waitMinutes} min` : undefined,
    journey.rideMinutes !== undefined ? `Ride · ~${journey.rideMinutes} min` : undefined,
    journey.totalMinutes !== undefined ? `${bold("Allow")} · ~${journey.totalMinutes + journey.leaveBufferMinutes} min including buffer` : undefined,
    h(journey.message),
  ].filter(Boolean).join("\n");
}

function formatNaturalHelp(): string {
  return [
    bold("Study Mode understands natural language"),
    `${code("todo: finish tutorial for CS2100 Friday 6pm")}`,
    `${code("note: cache misses stall the pipeline for CS2100")}`,
    `${code("question: why is sign extension needed? for CS2100")}`,
    `${code("open CS2102")} · ${code("start note session")}`,
    `${code("what needs attention?")} · ${code("sync Canvas")}`,
    `${code("add origin Home at Kent Ridge MRT")}`,
    `${code("when should I leave for COM3 from Home?")}`,
    `${code("show my timetable")}`,
    "If a message is unclear, Threadwise asks Task, Note, Question, or Resource immediately.",
  ].join("\n");
}

function humanKind(kind: StudyResourceKind): string {
  return kind.toLowerCase();
}

function formatDate(value: Date, timezone: string): string {
  return DateTime.fromJSDate(value).setZone(timezone).toFormat("ccc, d LLL · h:mm a");
}

function formatDay(value: Date, timezone: string): string {
  return DateTime.fromJSDate(value).setZone(timezone).toFormat("d LLL");
}

function relativeTime(value: Date): string {
  return DateTime.fromJSDate(value).toRelative() ?? "recently";
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
