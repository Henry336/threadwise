import {
  Prisma,
  StudyItemType,
  StudyMistakeCategory,
  StudyPriority,
  StudyTrafficLight,
  type StudyWorkspace,
} from "@prisma/client";
import { Bot, Context, InlineKeyboard, InputFile } from "grammy";
import { DateTime } from "luxon";
import {
  STUDY_METHODS,
  StudyModeError,
  academicWeekNumber,
  activeStudyWorkspace,
  addStudyModule,
  addStudyScheduleBlock,
  advanceStudyConversation,
  archiveStudyScheduleBlock,
  beginStudyConversation,
  bindStudyWorkspace,
  buildStudyDashboard,
  clearStudyConversation,
  completeStudyItem,
  configureStudyWorkspace,
  createStudyExports,
  createStudyItem,
  ensureStudyWeek,
  findStudyItem,
  findStudyModule,
  getStudyConversation,
  listStudyMistakes,
  listStudyModules,
  listStudyScheduleBlocks,
  recordStudyMistake,
  requireStudyWorkspace,
  rescheduleStudyItem,
  resolveStudyMistake,
  saveWeeklyReview,
  startStudySession,
  stopStudySession,
  studyConversationPayload,
  studyScopeFromContext,
  unbindStudyWorkspace,
  upcomingStudyItems,
  updateStudyMastery,
  updateStudyModule,
  updateWeeklyPlan,
} from "../services/study";
import { prisma } from "../db/prisma";
import { parseDueDate } from "../utils/dates";
import { bold, code, editOrReplyHtml, h, replyHtml } from "../utils/html";
import { truncate } from "../utils/text";
import { userFacingError } from "./errorResponses";
import { groupDashboardUrl } from "./links";
import {
  clearStudyScheduleTravel,
  configureStudyScheduleTravel,
  renameStudyOrigin,
} from "../services/studyTransit";
import { activeStudyModule } from "../services/studyResources";
import {
  handleExtendedStudyCallback,
  handleStudyAmbientText,
  handleStudyDocument,
  handleStudyLocation,
  handleStudyPhoto,
  showStudyOriginMatches,
  showStudyOnboarding,
} from "./studyCapture";

const LIST_PAGE_SIZE = 6;
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const SEALED_GROUP_CHECK_TTL_MS = 60_000;
const sealedGroupChecks = new Map<string, number>();

export function registerStudyMode(bot: Bot): void {
  bot.command("study", async (ctx) => handleStudyCommand(ctx));
  bot.callbackQuery(/^study:.+$/i, async (ctx) => handleStudyCallback(ctx, ctx.callbackQuery.data));
  bot.on("message:photo", async (ctx, next) => {
    try {
      const workspace = await requireStudyWorkspace(ctx);
      await assertSealedStudyGroup(ctx, workspace);
      await handleStudyPhoto(ctx, workspace);
    } catch (error) {
      if (error instanceof StudyModeError && ["disabled", "forbidden", "not_bound"].includes(error.code)) return next();
      await replyStudyError(ctx, error);
    }
  });
  bot.on("message:document", async (ctx, next) => {
    try {
      const workspace = await requireStudyWorkspace(ctx);
      await assertSealedStudyGroup(ctx, workspace);
      await handleStudyDocument(ctx, workspace);
    } catch (error) {
      if (error instanceof StudyModeError && ["disabled", "forbidden", "not_bound"].includes(error.code)) return next();
      await replyStudyError(ctx, error);
    }
  });
  bot.on("message:location", async (ctx, next) => {
    try {
      const workspace = await requireStudyWorkspace(ctx);
      await assertSealedStudyGroup(ctx, workspace);
      await handleStudyLocation(ctx, workspace);
    } catch (error) {
      if (error instanceof StudyModeError && ["disabled", "forbidden", "not_bound"].includes(error.code)) return next();
      await replyStudyError(ctx, error);
    }
  });
  bot.on("message:text", async (ctx, next) => {
    if (/^\/study(?:@\w+)?\b/i.test(ctx.message.text)) {
      await next();
      return;
    }
    const keyboardCommand = /^\/(?:study_menu|save_note|cancel_note)(?:@\w+)?$/i.test(ctx.message.text.trim());
    if (/^\//.test(ctx.message.text) && !keyboardCommand) return next();
    try {
      const workspace = await requireStudyWorkspace(ctx);
      await assertSealedStudyGroup(ctx, workspace);
      const conversation = await getStudyConversation(workspace.id);
      if (!conversation) {
        await handleStudyAmbientText(ctx, workspace);
        return;
      }
      await handleStudyConversationMessage(ctx, workspace, conversation.kind, conversation.step, studyConversationPayload(conversation.payload));
    } catch (error) {
      if (error instanceof StudyModeError && ["disabled", "forbidden", "not_bound"].includes(error.code)) {
        await next();
        return;
      }
      await replyStudyError(ctx, error);
    }
  });
  bot.on("chat_member", async (ctx, next) => {
    const workspace = await activeStudyWorkspace();
    const update = ctx.chatMember;
    if (!workspace?.boundChatId || String(update.chat.id) !== workspace.boundChatId) {
      await next();
      return;
    }
    sealedGroupChecks.delete(String(update.chat.id));
    const joined = ["member", "administrator", "creator", "restricted"].includes(update.new_chat_member.status);
    const addedId = String(update.new_chat_member.user.id);
    if (joined && addedId !== workspace.ownerTelegramId && addedId !== String(ctx.me.id)) {
      await unbindStudyWorkspace(workspace.id);
      await ctx.api.sendMessage(update.chat.id, "Study Mode was locked because this group is no longer private. Remove the additional account, then bind it again.");
    }
    await next();
  });
}

async function handleStudyCommand(ctx: Context): Promise<void> {
  const body = (ctx.message && "text" in ctx.message ? (ctx.message.text ?? "") : "").replace(/^\/study(?:@\w+)?\s*/i, "").trim();
  const [rawSubcommand, ...rest] = body.split(/\s+/);
  const subcommand = rawSubcommand?.toLowerCase() || "dashboard";
  const args = rest.join(" ").trim();
  try {
    if (subcommand === "bind") {
      studyScopeFromContext(ctx);
      await assertSealedStudyGroup(ctx);
      const workspace = await bindStudyWorkspace(ctx);
      await showStudyOnboarding(ctx, workspace);
      return;
    }
    let workspace: StudyWorkspace;
    try {
      workspace = await requireStudyWorkspace(ctx);
    } catch (error) {
      const mayStartOnboarding = error instanceof StudyModeError
        && error.code === "not_bound"
        && (!body || subcommand === "dashboard" || subcommand === "home" || subcommand === "onboarding");
      if (!mayStartOnboarding) throw error;
      studyScopeFromContext(ctx);
      await assertSealedStudyGroup(ctx);
      workspace = await bindStudyWorkspace(ctx);
      await showStudyOnboarding(ctx, workspace);
      return;
    }
    await assertSealedStudyGroup(ctx, workspace);
    switch (subcommand) {
      case "dashboard":
      case "home":
        await showStudyDashboard(ctx, workspace);
        break;
      case "help":
        await replyHtml(ctx, formatStudyHelp(), { reply_markup: studyHomeKeyboard(workspace.id) });
        break;
      case "onboarding":
        await showStudyOnboarding(ctx, workspace);
        break;
      case "canvas":
        await handleStudyAmbientText(ctx, workspace, args && /sync/i.test(args) ? "Sync Canvas" : "Canvas status");
        break;
      case "sync":
        await handleStudyAmbientText(ctx, workspace, "Sync Canvas");
        break;
      case "attention":
        await handleStudyAmbientText(ctx, workspace, "What needs attention?");
        break;
      case "preview":
        await handleStudyAmbientText(ctx, workspace, "Weekly preview");
        break;
      case "resources":
        await handleStudyAmbientText(ctx, workspace, args ? `Search study ${args}` : "Show study resources");
        break;
      case "origins":
        await handleStudyAmbientText(ctx, workspace, "Show travel origins");
        break;
      case "unbind":
        await replyHtml(ctx, [bold("Unbind Study Mode?"), "Your records stay in PostgreSQL, but this group will stop exposing Study Mode."].join("\n"), {
          reply_markup: new InlineKeyboard().text("Confirm unbind", "study:unbind:confirm").text("Keep bound", "study:dashboard"),
        });
        break;
      case "setup":
        await beginStudyConversation(workspace.id, "setup", "semester", {});
        await replyHtml(ctx, [bold("Study setup"), "What should this semester be called?", "Example: AY2026/27 Semester 1"].join("\n"), { reply_markup: cancelKeyboard() });
        break;
      case "modules":
        await showStudyModules(ctx, workspace);
        break;
      case "week":
        await showStudyWeek(ctx, workspace, 0);
        break;
      case "plan":
        await beginStudyConversation(workspace.id, "plan", "priorities", {});
        await replyHtml(ctx, [bold("Plan this week"), "Reply to this message with up to three outcomes, one per line."].join("\n"), { reply_markup: cancelKeyboard() });
        break;
      case "add":
        await beginAddStudyItem(ctx, workspace);
        break;
      case "done":
        if (!args) throw new StudyModeError("Use /study done STUDY-1", "invalid");
        await finishStudyItem(ctx, workspace, args, false);
        break;
      case "processed":
        if (!args) throw new StudyModeError("Use /study processed STUDY-1", "invalid");
        await finishStudyItem(ctx, workspace, args, true);
        break;
      case "mastery":
        await handleMasteryCommand(ctx, workspace, args);
        break;
      case "start":
        await handleStartCommand(ctx, workspace, args);
        break;
      case "stop":
        await handleStopCommand(ctx, workspace, args);
        break;
      case "mistake":
        await beginMistakeFlow(ctx, workspace);
        break;
      case "mistakes":
        await showStudyMistakes(ctx, workspace, 0);
        break;
      case "review":
        await beginWeeklyReview(ctx, workspace);
        break;
      case "upcoming":
        await showUpcoming(ctx, workspace, 0);
        break;
      case "timetable":
        await replyHtml(ctx, `${bold("Study timetable")}\nClasses, study blocks, and due work in one live view.`, {
          reply_markup: new InlineKeyboard().url("Open timetable", groupDashboardUrl(workspace.id, "study-timetable")),
        });
        break;
      case "export":
        await sendStudyExports(ctx, workspace);
        break;
      case "schedule":
        await handleScheduleCommand(ctx, workspace, args);
        break;
      case "cancel":
        await clearStudyConversation(workspace.id);
        await replyHtml(ctx, "Study flow canceled.", { reply_markup: studyHomeKeyboard(workspace.id) });
        break;
      default:
        await replyHtml(ctx, formatStudyHelp(), { reply_markup: studyHomeKeyboard(workspace.id) });
    }
  } catch (error) {
    if (error instanceof StudyModeError && error.code === "forbidden") return;
    await replyStudyError(ctx, error);
  }
}

async function handleStudyCallback(ctx: Context, data: string): Promise<void> {
  try {
    const workspace = await requireStudyWorkspace(ctx);
    await assertSealedStudyGroup(ctx, workspace);
    await ctx.answerCallbackQuery().catch(() => undefined);
    if (await handleExtendedStudyCallback(ctx, workspace, data)) return;
    const parts = data.split(":");
    const action = parts[1];
    if (action === "dashboard") return showStudyDashboard(ctx, workspace, true);
    if (action === "help") return editOrReplyHtml(ctx, formatStudyHelp(), { reply_markup: studyHomeKeyboard(workspace.id) }).then(() => undefined);
    if (action === "cancel") {
      await clearStudyConversation(workspace.id);
      await editOrReplyHtml(ctx, "Study flow canceled.", { reply_markup: studyHomeKeyboard(workspace.id) });
      return;
    }
    if (action === "unbind" && parts[2] === "confirm") {
      await unbindStudyWorkspace(workspace.id);
      await editOrReplyHtml(ctx, [bold("Study Mode unbound"), "Records were retained. Run /study bind here to reconnect later."].join("\n"));
      return;
    }
    if (action === "modules") return showStudyModules(ctx, workspace, true);
    if (action === "origin" && parts[2] === "add") {
      await beginStudyConversation(workspace.id, "study_origin_add", "details", {});
      await editOrReplyHtml(ctx, [
        bold("Add travel origin"),
        `Reply to this message with ${code("Name | nearby campus venue or bus stop")}.`,
      ].join("\n"), { reply_markup: cancelKeyboard() });
      return;
    }
    if (action === "origin" && parts[2] === "rename" && parts[3]) {
      await beginStudyConversation(workspace.id, "study_origin_rename", "name", { originId: parts[3] });
      await editOrReplyHtml(ctx, `${bold("Rename travel origin")}\nReply to this message with its new name.`, {
        reply_markup: cancelKeyboard(),
      });
      return;
    }
    if (action === "module" && parts[2] === "add") {
      await beginStudyConversation(workspace.id, "module", "add", {});
      await editOrReplyHtml(ctx, [bold("Add module"), `Reply to this message with ${code("CODE | Module name")}`].join("\n"), { reply_markup: cancelKeyboard() });
      return;
    }
    if (action === "module" && parts[2] === "edit" && parts[3]) {
      const module = await findStudyModule(workspace.id, parts[3]);
      await beginStudyConversation(workspace.id, "module", "edit", { moduleId: module.id });
      await editOrReplyHtml(ctx, [bold(`Edit ${module.code}`), `Reply to this message with ${code("CODE | Module name")}`].join("\n"), { reply_markup: cancelKeyboard() });
      return;
    }
    if (action === "module" && parts[2] === "archive" && parts[3]) {
      const module = await updateStudyModule(workspace, parts[3], { active: false });
      await editOrReplyHtml(ctx, `${bold(module.code)} archived.`, { reply_markup: new InlineKeyboard().text("Modules", "study:modules") });
      return;
    }
    if (action === "module" && parts[2] === "restore" && parts[3]) {
      const module = await updateStudyModule(workspace, parts[3], { active: true });
      await editOrReplyHtml(ctx, `${bold(module.code)} restored.`, { reply_markup: new InlineKeyboard().text("Modules", "study:modules") });
      return;
    }
    if (action === "add") return handleAddCallback(ctx, workspace, parts);
    if (action === "items") return showStudyWeek(ctx, workspace, Number(parts[2] ?? 0), true);
    if (action === "upcoming") return showUpcoming(ctx, workspace, Number(parts[2] ?? 0), true);
    if (action === "mistakes") return showStudyMistakes(ctx, workspace, Number(parts[2] ?? 0), true);
    if (action === "item" && parts[2] === "done" && parts[3]) return finishStudyItem(ctx, workspace, parts[3], false, true);
    if (action === "item" && parts[2] === "processed" && parts[3]) return finishStudyItem(ctx, workspace, parts[3], true, true);
    if (action === "item" && parts[2] === "reschedule" && parts[3]) {
      const item = await findStudyItem(workspace.id, parts[3]);
      await beginStudyConversation(workspace.id, "reschedule_item", "date", { itemId: item.id });
      await editOrReplyHtml(ctx, [bold(`Reschedule ${item.publicId}`), `Reply naturally, for example ${code("tomorrow 6pm")}.`].join("\n"), {
        reply_markup: cancelKeyboard(),
      });
      return;
    }
    if (action === "mastery" && parts[2] && parts[3] && parts[4]) {
      const mastery = parseMastery(parts[4]);
      if (!mastery) throw new StudyModeError("Choose green, amber, or red.", "invalid");
      const reference = parts[2] === "module" ? (await findStudyModule(workspace.id, parts[3])).code : parts[3];
      const result = await updateStudyMastery(workspace, reference, mastery);
      await editOrReplyHtml(ctx, `${bold(reference.toUpperCase())} mastery: ${traffic(mastery)}`, { reply_markup: studyHomeKeyboard(workspace.id) });
      void result;
      return;
    }
    if (action === "session" && parts[2] === "module" && parts[3]) return showSessionItems(ctx, workspace, parts[3]);
    if (action === "session" && parts[2] === "pick") {
      const modules = await listStudyModules(workspace.id);
      await editOrReplyHtml(ctx, [bold("Start session"), "Choose a module."].join("\n"), {
        reply_markup: moduleSelectionKeyboard(modules, "session"),
      });
      return;
    }
    if (action === "session" && parts[2] === "method" && parts[3] && parts[4]) {
      const module = await findStudyModule(workspace.id, parts[3]);
      const method = (STUDY_METHODS[module.code] ?? ["Focused study"])[Number(parts[4])] ?? "Focused study";
      const conversation = await getStudyConversation(workspace.id);
      const payload = conversation?.kind === "session" ? studyConversationPayload(conversation.payload) : {};
      const itemId = typeof payload.itemId === "string" ? payload.itemId : undefined;
      const session = await startStudySession(workspace, module.id, method, itemId);
      await clearStudyConversation(workspace.id);
      await editOrReplyHtml(ctx, [bold(`${module.code} session started`), h(method), "Use /study stop when finished."].join("\n"), { reply_markup: new InlineKeyboard().text("Stop", "study:session:stop") });
      return;
    }
    if (action === "session" && parts[2] === "item" && parts[3]) {
      const conversation = await requireConversation(workspace.id, "session");
      const payload = studyConversationPayload(conversation.payload);
      const moduleId = String(payload.moduleId ?? "");
      const itemId = parts[3] === "none" ? undefined : parts[3];
      await advanceStudyConversation(workspace.id, "method", { moduleId, ...(itemId ? { itemId } : {}) });
      await showSessionMethods(ctx, workspace, moduleId);
      return;
    }
    if (action === "session" && parts[2] === "stop") {
      await beginStudyConversation(workspace.id, "stop", "result", {});
      await editOrReplyHtml(ctx, [bold("Finish session"), "Reply to this message with a short result, or send skip.", `Timed practice can include ${code("score 7/10; topics: MIPS, cache; without notes")}.`].join("\n"), { reply_markup: cancelKeyboard() });
      return;
    }
    if (action === "mistake" && parts[2] === "resolve" && parts[3]) {
      const resolved = await resolveStudyMistake(workspace, parts[3]);
      await editOrReplyHtml(ctx, `${bold(resolved.publicId)} resolved.`, { reply_markup: new InlineKeyboard().text("Mistakes", "study:mistakes:0") });
      return;
    }
    if (action === "mistake" && parts[2] === "start") {
      const modules = await listStudyModules(workspace.id);
      await beginStudyConversation(workspace.id, "mistake", "module", {});
      await editOrReplyHtml(ctx, [bold("Record mistake"), "Choose the module."].join("\n"), {
        reply_markup: moduleSelectionKeyboard(modules, "mistake"),
      });
      return;
    }
    if (action === "mistake" && parts[2] === "module" && parts[3]) {
      await advanceStudyConversation(workspace.id, "source", { moduleId: parts[3] });
      await editOrReplyHtml(ctx, [bold("Record mistake"), "Reply to this message with the question, source, or short description."].join("\n"), { reply_markup: cancelKeyboard() });
      return;
    }
    if (action === "mistake" && parts[2] === "category" && parts[3]) {
      const conversation = await requireConversation(workspace.id, "mistake");
      await advanceStudyConversation(workspace.id, "cause", { ...studyConversationPayload(conversation.payload), category: parts[3] } as Prisma.InputJsonObject);
      await editOrReplyHtml(ctx, [bold("What caused it?"), "Be specific: missing concept, wrong approach, careless execution, or time pressure."].join("\n"), { reply_markup: cancelKeyboard() });
      return;
    }
    if (action === "review" && parts[2] === "start") return beginWeeklyReview(ctx, workspace, true);
    if (action === "review" && parts[2] === "status" && parts[3]) return handleReviewStatus(ctx, workspace, parts[3]);
    if (action === "review" && parts[2] === "workload" && parts[3]) return handleReviewWorkload(ctx, workspace, parts[3] === "yes");
    if (action === "plan") {
      await beginStudyConversation(workspace.id, "plan", "priorities", {});
      await editOrReplyHtml(ctx, [bold("Plan this week"), "Reply to this message with up to three outcomes, one per line."].join("\n"), { reply_markup: cancelKeyboard() });
      return;
    }
    throw new StudyModeError("That Study Mode control has expired.", "invalid");
  } catch (error) {
    await replyStudyCallbackError(ctx, error);
  }
}

async function handleStudyConversationMessage(
  ctx: Context,
  workspace: StudyWorkspace,
  kind: string,
  step: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const text = ctx.message && "text" in ctx.message ? (ctx.message.text ?? "").trim() : "";
  if (/^(?:cancel|stop|\/cancel)$/i.test(text)) {
    await clearStudyConversation(workspace.id);
    await replyHtml(ctx, "Study flow canceled.", { reply_markup: studyHomeKeyboard(workspace.id) });
    return;
  }
  if (kind === "setup") return handleSetupMessage(ctx, workspace, step, payload, text);
  if (kind === "module") return handleModuleMessage(ctx, workspace, step, payload, text);
  if (kind === "add") return handleAddMessage(ctx, workspace, step, payload, text);
  if (kind === "plan") return handlePlanMessage(ctx, workspace, step, payload, text);
  if (kind === "stop") return finishStoppedSession(ctx, workspace, text);
  if (kind === "mistake") return handleMistakeMessage(ctx, workspace, step, payload, text);
  if (kind === "review") return handleReviewMessage(ctx, workspace, step, payload, text);
  if (kind === "reschedule_item") return handleRescheduleItemMessage(ctx, workspace, payload, text);
  if (kind === "study_origin_add") return handleStudyOriginAddMessage(ctx, workspace, text);
  if (kind === "study_origin_rename") return handleStudyOriginRenameMessage(ctx, workspace, payload, text);
  if (kind === "study_travel_block") return handleStudyTravelBlockMessage(ctx, workspace, payload, text);
}

async function handleStudyTravelBlockMessage(
  ctx: Context,
  workspace: StudyWorkspace,
  payload: Record<string, unknown>,
  text: string,
): Promise<void> {
  const blockId = typeof payload.blockId === "string" ? payload.blockId : undefined;
  if (!blockId) throw new StudyModeError("That class-travel flow expired. Open Travel and try again.", "invalid");
  if (/^off$/i.test(text)) {
    await clearStudyScheduleTravel(workspace, blockId);
    await clearStudyConversation(workspace.id);
    await replyHtml(ctx, "Travel reminder removed.", { reply_markup: new InlineKeyboard().text("Travel", "study:travel") });
    return;
  }
  const [destinationValue, originValue, bufferValue] = text.split("|").map((value) => value.trim());
  if (!destinationValue) throw new StudyModeError(`Reply with ${code("Destination | Origin | Buffer")}.`, "invalid");
  const buffer = bufferValue ? Number(bufferValue) : undefined;
  if (bufferValue && (!Number.isFinite(buffer) || buffer! < 0 || buffer! > 90)) {
    throw new StudyModeError("The travel buffer must be between 0 and 90 minutes.", "invalid");
  }
  const block = await configureStudyScheduleTravel(workspace, blockId, {
    destination: destinationValue,
    originReference: originValue || undefined,
    travelBufferMinutes: buffer,
  });
  await clearStudyConversation(workspace.id);
  await replyHtml(ctx, `${bold("Class travel saved")}\n${h(block.venueName ?? destinationValue)} · ${block.travelBufferMinutes} min buffer`, {
    reply_markup: new InlineKeyboard().text("View route", `study:travel:route:${block.id}`).text("Travel", "study:travel"),
  });
}

async function handleStudyOriginAddMessage(ctx: Context, workspace: StudyWorkspace, text: string): Promise<void> {
  const [nameValue, ...venueParts] = text.split("|");
  const name = nameValue?.trim();
  const venue = venueParts.join("|").trim();
  if (!name || !venue) throw new StudyModeError(`Reply with ${code("Name | nearby campus venue or bus stop")}.`, "invalid");
  await showStudyOriginMatches(ctx, workspace, name, venue);
}

async function handleStudyOriginRenameMessage(
  ctx: Context,
  workspace: StudyWorkspace,
  payload: Record<string, unknown>,
  text: string,
): Promise<void> {
  const originId = typeof payload.originId === "string" ? payload.originId : undefined;
  if (!originId) throw new StudyModeError("That travel-origin flow expired. Start it again.", "invalid");
  await renameStudyOrigin(workspace, originId, text);
  await clearStudyConversation(workspace.id);
  await handleStudyAmbientText(ctx, workspace, "Show travel origins");
}

async function handleSetupMessage(ctx: Context, workspace: StudyWorkspace, step: string, payload: Record<string, unknown>, text: string): Promise<void> {
  if (step === "semester") {
    if (!text) throw new StudyModeError("Give the semester a name.", "invalid");
    await advanceStudyConversation(workspace.id, "start", { semesterName: text.slice(0, 120) });
    await replyHtml(ctx, [bold("Starting Monday"), `Reply to this message with ${code("YYYY-MM-DD")}.`, "This date defines Week 1."].join("\n"), { reply_markup: cancelKeyboard() });
    return;
  }
  if (step === "start") {
    const date = DateTime.fromISO(text, { zone: "Asia/Singapore" });
    if (!date.isValid || date.weekday !== 1) throw new StudyModeError("Use a valid Monday in YYYY-MM-DD format.", "invalid");
    await advanceStudyConversation(workspace.id, "timezone", { ...payload, startDate: date.toISODate() } as Prisma.InputJsonObject);
    await replyHtml(ctx, [bold("Timezone"), `Reply to this message with an IANA timezone, or ${code("skip")} for Asia/Singapore.`].join("\n"), { reply_markup: cancelKeyboard() });
    return;
  }
  const timezone = /^skip$/i.test(text) ? "Asia/Singapore" : text;
  const localStart = DateTime.fromISO(String(payload.startDate), { zone: timezone });
  if (!localStart.isValid) throw new StudyModeError("Use a valid IANA timezone such as Asia/Singapore.", "invalid");
  const configured = await configureStudyWorkspace(workspace.id, {
    semesterName: String(payload.semesterName),
    semesterStartDate: localStart.toUTC().toJSDate(),
    timezone,
  });
  await clearStudyConversation(workspace.id);
  await replyHtml(ctx, [bold("Study setup saved"), `${h(configured.semesterName)} · ${h(timezone)}`, "Modules and the preliminary editable schedule are ready."].join("\n"), { reply_markup: studyHomeKeyboard(workspace.id) });
}

async function handleModuleMessage(ctx: Context, workspace: StudyWorkspace, step: string, payload: Record<string, unknown>, text: string): Promise<void> {
  const [codeValue, ...nameParts] = text.split("|");
  const name = nameParts.join("|").trim();
  if (!codeValue || !name) throw new StudyModeError(`Reply with ${code("CODE | Module name")}.`, "invalid");
  const module = step === "edit" && typeof payload.moduleId === "string"
    ? await updateStudyModule(workspace, payload.moduleId, { code: codeValue, name })
    : await addStudyModule(workspace, codeValue, name);
  await clearStudyConversation(workspace.id);
  await replyHtml(ctx, `${bold(module.code)} · ${h(module.name)}`, { reply_markup: new InlineKeyboard().text("Modules", "study:modules") });
}

async function beginAddStudyItem(ctx: Context, workspace: StudyWorkspace): Promise<void> {
  const activeModuleValue = await activeStudyModule(workspace);
  if (activeModuleValue) {
    await beginStudyConversation(workspace.id, "add", "type", { moduleId: activeModuleValue.id });
    await replyHtml(ctx, [bold(`Add ${activeModuleValue.code} work`), "Choose the type."].join("\n"), {
      reply_markup: studyItemTypeKeyboard(),
    });
    return;
  }
  const modules = await listStudyModules(workspace.id);
  await beginStudyConversation(workspace.id, "add", "module", {});
  await replyHtml(ctx, [bold("Add study item"), "Choose a module."].join("\n"), { reply_markup: moduleSelectionKeyboard(modules, "add") });
}

async function handleAddCallback(ctx: Context, workspace: StudyWorkspace, parts: string[]): Promise<void> {
  const stage = parts[2];
  if (stage === "start") return beginAddStudyItem(ctx, workspace);
  if (stage === "module" && parts[3]) {
    await advanceStudyConversation(workspace.id, "type", { moduleId: parts[3] });
    await editOrReplyHtml(ctx, [bold("Type"), "What kind of work is this?"].join("\n"), { reply_markup: studyItemTypeKeyboard() });
    return;
  }
  if (stage === "type" && parts[3]) {
    const conversation = await requireConversation(workspace.id, "add");
    if (!Object.values(StudyItemType).includes(parts[3] as StudyItemType)) throw new StudyModeError("Choose a valid study-item type.", "invalid");
    await advanceStudyConversation(workspace.id, "title", { ...studyConversationPayload(conversation.payload), type: parts[3] } as Prisma.InputJsonObject);
    await editOrReplyHtml(ctx, [bold("Title"), "Reply to this message with the concrete work to do."].join("\n"), { reply_markup: cancelKeyboard() });
    return;
  }
  if (stage === "priority" && parts[3]) {
    const conversation = await requireConversation(workspace.id, "add");
    const payload = studyConversationPayload(conversation.payload);
    const priority = parts[3] as StudyPriority;
    if (!Object.values(StudyPriority).includes(priority)) throw new StudyModeError("Choose a valid priority.", "invalid");
    const item = await createStudyItem(workspace, {
      moduleId: String(payload.moduleId),
      type: String(payload.type) as StudyItemType,
      title: String(payload.title),
      dueAt: payload.dueAt ? new Date(String(payload.dueAt)) : undefined,
      plannedMinutes: typeof payload.plannedMinutes === "number" ? payload.plannedMinutes : undefined,
      priority,
    });
    await clearStudyConversation(workspace.id);
    await editOrReplyHtml(ctx, [bold("Study item added"), `${code(item.publicId)} · ${bold(item.module.code)}`, h(item.title)].join("\n"), { reply_markup: studyItemKeyboard(item.id) });
  }
}

async function handleAddMessage(ctx: Context, workspace: StudyWorkspace, step: string, payload: Record<string, unknown>, text: string): Promise<void> {
  if (step === "title") {
    if (!text) throw new StudyModeError("Give the work a title.", "invalid");
    await advanceStudyConversation(workspace.id, "due", { ...payload, title: text.slice(0, 500) } as Prisma.InputJsonObject);
    await replyHtml(ctx, [bold("Due date"), `Reply naturally, for example ${code("Friday 6pm")}, or ${code("skip")}.`].join("\n"), { reply_markup: cancelKeyboard() });
    return;
  }
  if (step === "due") {
    const dueAt = /^skip$/i.test(text) ? undefined : parseDueDate(text, workspace.timezone);
    if (!/^skip$/i.test(text) && !dueAt) throw new StudyModeError("I couldn't read that date. Try 14 Aug 6pm, tomorrow 9am, or skip.", "invalid");
    await advanceStudyConversation(workspace.id, "minutes", { ...payload, ...(dueAt ? { dueAt: dueAt.toISOString() } : {}) } as Prisma.InputJsonObject);
    await replyHtml(ctx, [bold("Planned time"), `Reply to this message with minutes, or ${code("skip")}.`].join("\n"), { reply_markup: cancelKeyboard() });
    return;
  }
  if (step === "minutes") {
    const minutes = /^skip$/i.test(text) ? undefined : Number(text);
    if (minutes !== undefined && (!Number.isInteger(minutes) || minutes < 1 || minutes > 1_440)) throw new StudyModeError("Use 1-1440 minutes, or skip.", "invalid");
    await advanceStudyConversation(workspace.id, "priority", { ...payload, ...(minutes ? { plannedMinutes: minutes } : {}) } as Prisma.InputJsonObject);
    await replyHtml(ctx, [bold("Priority"), "Choose how much deadline risk this carries."].join("\n"), { reply_markup: priorityKeyboard() });
  }
}

async function handlePlanMessage(ctx: Context, workspace: StudyWorkspace, step: string, payload: Record<string, unknown>, text: string): Promise<void> {
  if (step === "priorities") {
    const priorities = splitAnswers(text).slice(0, 3);
    if (!priorities.length) throw new StudyModeError("Send at least one concrete outcome.", "invalid");
    await advanceStudyConversation(workspace.id, "overload", { priorities } as Prisma.InputJsonObject);
    await replyHtml(ctx, [bold("Capacity check"), `Anything at risk or overloaded? Reply briefly, or ${code("skip")}.`].join("\n"), { reply_markup: cancelKeyboard() });
    return;
  }
  const updated = await updateWeeklyPlan(workspace, (payload.priorities as string[]) ?? [], /^skip$/i.test(text) ? undefined : text);
  await clearStudyConversation(workspace.id);
  await replyHtml(ctx, [bold(`Week ${updated.number} planned`), ...updated.topPriorities.map((priority, index) => `${index + 1}. ${h(priority)}`)].join("\n"), { reply_markup: studyHomeKeyboard(workspace.id) });
}

async function handleStartCommand(ctx: Context, workspace: StudyWorkspace, args: string): Promise<void> {
  if (!args) {
    const modules = await listStudyModules(workspace.id);
    await replyHtml(ctx, [bold("Start session"), "Choose a module."].join("\n"), { reply_markup: moduleSelectionKeyboard(modules, "session") });
    return;
  }
  const [moduleRef, methodValue] = args.split("|").map((value) => value.trim());
  const module = await findStudyModule(workspace.id, moduleRef ?? "");
  if (!methodValue) return showSessionMethods(ctx, workspace, module.id, false);
  const session = await startStudySession(workspace, module.id, methodValue);
  await replyHtml(ctx, [bold(`${module.code} session started`), h(session.method), "Use /study stop when finished."].join("\n"), { reply_markup: new InlineKeyboard().text("Stop", "study:session:stop") });
}

async function handleStopCommand(ctx: Context, workspace: StudyWorkspace, args: string): Promise<void> {
  if (args) {
    const input = parseSessionResult(args);
    const session = await stopStudySession(workspace, input);
    await replyHtml(ctx, [bold("Session saved"), `${session.module.code} · ${session.durationMinutes} min`, h(session.result || "No result recorded.")].join("\n"), { reply_markup: studyHomeKeyboard(workspace.id) });
    return;
  }
  await beginStudyConversation(workspace.id, "stop", "result", {});
  await replyHtml(ctx, [bold("Finish session"), "Reply to this message with a short result, or send skip.", `Timed practice can include ${code("score 7/10; topics: MIPS, cache; without notes")}.`].join("\n"), { reply_markup: cancelKeyboard() });
}

async function finishStoppedSession(ctx: Context, workspace: StudyWorkspace, text: string): Promise<void> {
  const input = /^skip$/i.test(text) ? {} : parseSessionResult(text);
  const session = await stopStudySession(workspace, input);
  await clearStudyConversation(workspace.id);
  await replyHtml(ctx, [bold("Session saved"), `${session.module.code} · ${session.durationMinutes} min`, h(session.result || "No result recorded.")].join("\n"), { reply_markup: studyHomeKeyboard(workspace.id) });
}

async function beginMistakeFlow(ctx: Context, workspace: StudyWorkspace): Promise<void> {
  const modules = await listStudyModules(workspace.id);
  await beginStudyConversation(workspace.id, "mistake", "module", {});
  await replyHtml(ctx, [bold("Record mistake"), "Choose the module."].join("\n"), { reply_markup: moduleSelectionKeyboard(modules, "mistake") });
}

async function handleMistakeMessage(ctx: Context, workspace: StudyWorkspace, step: string, payload: Record<string, unknown>, text: string): Promise<void> {
  if (step === "source") {
    await advanceStudyConversation(workspace.id, "category", { ...payload, source: text } as Prisma.InputJsonObject);
    await replyHtml(ctx, [bold("Category"), "Choose the main failure mode."].join("\n"), { reply_markup: mistakeCategoryKeyboard() });
    return;
  }
  if (step === "cause") {
    await advanceStudyConversation(workspace.id, "prevention", { ...payload, cause: text } as Prisma.InputJsonObject);
    await replyHtml(ctx, [bold("Prevent it next time"), "What check, correction, or method should you apply?"].join("\n"), { reply_markup: cancelKeyboard() });
    return;
  }
  if (step === "prevention") {
    await advanceStudyConversation(workspace.id, "revisit", { ...payload, prevention: text } as Prisma.InputJsonObject);
    await replyHtml(ctx, [bold("Reattempt"), `When should this return? Reply naturally, or ${code("skip")}.`].join("\n"), { reply_markup: cancelKeyboard() });
    return;
  }
  if (step === "revisit") {
    const revisitAt = /^skip$/i.test(text) ? undefined : parseDueDate(text, workspace.timezone);
    if (!/^skip$/i.test(text) && !revisitAt) throw new StudyModeError("I couldn't read that revisit date.", "invalid");
    const mistake = await recordStudyMistake(workspace, {
      moduleId: String(payload.moduleId),
      source: String(payload.source),
      category: String(payload.category) as StudyMistakeCategory,
      cause: String(payload.cause),
      prevention: String(payload.prevention),
      revisitAt,
    });
    await clearStudyConversation(workspace.id);
    await replyHtml(ctx, [bold("Mistake logged"), `${code(mistake.publicId)} · ${bold(mistake.module.code)}`, h(mistake.source)].join("\n"), { reply_markup: new InlineKeyboard().text("Resolved", `study:mistake:resolve:${mistake.id}`).text("Mistakes", "study:mistakes:0") });
  }
}

async function beginWeeklyReview(ctx: Context, workspace: StudyWorkspace, edit = false): Promise<void> {
  const modules = await listStudyModules(workspace.id);
  if (!modules.length) throw new StudyModeError("Add at least one module first.", "invalid");
  await beginStudyConversation(workspace.id, "review", "processed", { moduleIndex: 0, moduleStatuses: [], current: {} });
  const message = reviewQuestion(modules[0]!, 1);
  if (edit) await editOrReplyHtml(ctx, message, { reply_markup: cancelKeyboard() });
  else await replyHtml(ctx, message, { reply_markup: cancelKeyboard() });
}

async function handleReviewMessage(ctx: Context, workspace: StudyWorkspace, step: string, payload: Record<string, unknown>, text: string): Promise<void> {
  const modules = await listStudyModules(workspace.id);
  const index = Number(payload.moduleIndex ?? 0);
  const module = modules[index];
  if (module && ["processed", "unclear", "unfinished", "practice", "mistakes", "next"].includes(step)) {
    const current = asRecord(payload.current);
    const nextField: Record<string, string> = { processed: "processed", unclear: "unclear", unfinished: "unfinished", practice: "practice", mistakes: "mistakes", next: "nextAction" };
    current[nextField[step]!] = text;
    if (step === "processed") return advanceReviewTextStep(ctx, workspace, payload, current, "unclear", "What remains unclear?");
    if (step === "unclear") return advanceReviewTextStep(ctx, workspace, payload, current, "unfinished", "What required work is unfinished?");
    if (step === "unfinished") return advanceReviewTextStep(ctx, workspace, payload, current, "practice", "What did you practise without notes?");
    if (step === "practice") return advanceReviewTextStep(ctx, workspace, payload, current, "mistakes", "What mistakes occurred?");
    if (step === "mistakes") {
      await advanceStudyConversation(workspace.id, "status", { ...payload, current } as Prisma.InputJsonObject);
      await replyHtml(ctx, [bold(`${module.code} status`), "Choose the honest traffic light."].join("\n"), { reply_markup: reviewStatusKeyboard() });
      return;
    }
    const rows = Array.isArray(payload.moduleStatuses) ? [...payload.moduleStatuses] : [];
    rows.push({ moduleId: module.id, code: module.code, ...current });
    const nextIndex = index + 1;
    if (nextIndex < modules.length) {
      await advanceStudyConversation(workspace.id, "processed", { moduleIndex: nextIndex, moduleStatuses: rows, current: {} } as Prisma.InputJsonObject);
      await replyHtml(ctx, reviewQuestion(modules[nextIndex]!, nextIndex + 1), { reply_markup: cancelKeyboard() });
      return;
    }
    await advanceStudyConversation(workspace.id, "wins", { moduleStatuses: rows } as Prisma.InputJsonObject);
    await replyHtml(ctx, [bold("What went well?"), `Reply to this message with short points, or ${code("skip")}.`].join("\n"), { reply_markup: cancelKeyboard() });
    return;
  }
  if (step === "wins") return advanceGlobalReview(ctx, workspace, payload, "wins", text, "lost", "What caused lost time?");
  if (step === "lost") return advanceGlobalReview(ctx, workspace, payload, "lostTimeCauses", text, "priorities", "Which three outcomes matter most next week?");
  if (step === "priorities") {
    await advanceStudyConversation(workspace.id, "workload", { ...payload, nextWeekPriorities: splitAnswers(text).slice(0, 3) } as Prisma.InputJsonObject);
    await replyHtml(ctx, [bold("Capacity check"), "Is the plan compatible with your available time?"].join("\n"), { reply_markup: new InlineKeyboard().text("Yes", "study:review:workload:yes").text("No", "study:review:workload:no") });
    return;
  }
  if (step === "overflow") {
    const rows = (payload.moduleStatuses as Array<Record<string, unknown>>) ?? [];
    const review = await saveWeeklyReview(workspace, {
      moduleStatuses: rows.map((row) => ({
        moduleId: String(row.moduleId),
        code: String(row.code),
        status: String(row.status) as StudyTrafficLight,
        unclear: optionalAnswer(row.unclear),
        unfinished: optionalAnswer(row.unfinished),
        practice: optionalAnswer(row.practice),
        mistakes: optionalAnswer(row.mistakes),
        nextAction: optionalAnswer(row.nextAction),
      })),
      wins: normalizeReviewAnswers(payload.wins),
      unresolvedTopics: rows.flatMap((row) => normalizeReviewAnswers(row.unclear)),
      nextWeekPriorities: normalizeReviewAnswers(payload.nextWeekPriorities).slice(0, 3),
      lostTimeCauses: normalizeReviewAnswers(payload.lostTimeCauses),
      workloadCompatible: Boolean(payload.workloadCompatible),
      protectedOverflowBlock: /^skip$/i.test(text) ? undefined : text,
      overloadNotes: payload.workloadCompatible === false ? "Planned workload needs adjustment." : undefined,
    });
    await clearStudyConversation(workspace.id);
    await replyHtml(ctx, [bold("Weekly review saved"), h(review.summary || "Structured review recorded."), "Mastery remains explicit; completion did not change it automatically."].join("\n"), { reply_markup: studyHomeKeyboard(workspace.id) });
  }
}

async function handleReviewStatus(ctx: Context, workspace: StudyWorkspace, statusValue: string): Promise<void> {
  const conversation = await requireConversation(workspace.id, "review");
  if (conversation.step !== "status") throw new StudyModeError("That review question has moved on.", "invalid");
  const payload = studyConversationPayload(conversation.payload);
  const mastery = parseMastery(statusValue);
  if (!mastery) throw new StudyModeError("Choose green, amber, or red.", "invalid");
  await advanceStudyConversation(workspace.id, "next", { ...payload, current: { ...asRecord(payload.current), status: mastery } } as Prisma.InputJsonObject);
  await editOrReplyHtml(ctx, [bold("Next concrete action"), "What is the next observable thing to do for this module?"].join("\n"), { reply_markup: cancelKeyboard() });
}

async function handleReviewWorkload(ctx: Context, workspace: StudyWorkspace, compatible: boolean): Promise<void> {
  const conversation = await requireConversation(workspace.id, "review");
  if (conversation.step !== "workload") throw new StudyModeError("That review question has moved on.", "invalid");
  const payload = studyConversationPayload(conversation.payload);
  await advanceStudyConversation(workspace.id, "overflow", { ...payload, workloadCompatible: compatible } as Prisma.InputJsonObject);
  await editOrReplyHtml(ctx, [bold("Protected overflow block"), `Which block stays available for recovery? Reply briefly, or ${code("skip")}.`].join("\n"), { reply_markup: cancelKeyboard() });
}

async function handleMasteryCommand(ctx: Context, workspace: StudyWorkspace, args: string): Promise<void> {
  const match = /^(\S+)\s+(green|amber|red)(?:\s+(.+))?$/i.exec(args);
  if (!match?.[1] || !match[2]) throw new StudyModeError("Use /study mastery CS2100 amber optional reason", "invalid");
  const mastery = parseMastery(match[2])!;
  const result = await updateStudyMastery(workspace, match[1], mastery, match[3]);
  const label = result.kind === "module" ? result.value.code : result.value.publicId;
  await replyHtml(ctx, `${bold(label)} mastery: ${traffic(mastery)}${match[3] ? `\n${h(match[3])}` : ""}`, { reply_markup: studyHomeKeyboard(workspace.id) });
}

async function finishStudyItem(ctx: Context, workspace: StudyWorkspace, reference: string, processed: boolean, edit = false): Promise<void> {
  const item = await completeStudyItem(workspace, reference, processed);
  const text = [bold(processed ? "Marked processed" : "Completed"), `${code(item.publicId)} · ${bold(item.module.code)}`, h(item.title), "Mastery was not changed."].join("\n");
  const options = { reply_markup: studyItemKeyboard(item.id) };
  if (edit) await editOrReplyHtml(ctx, text, options);
  else await replyHtml(ctx, text, options);
}

async function handleRescheduleItemMessage(
  ctx: Context,
  workspace: StudyWorkspace,
  payload: Record<string, unknown>,
  text: string,
): Promise<void> {
  const dueAt = parseDueDate(text, workspace.timezone);
  if (!dueAt) throw new StudyModeError("I couldn't read that date. Try tomorrow 6pm or 14 Aug 9am.", "invalid");
  const item = await rescheduleStudyItem(workspace, String(payload.itemId ?? ""), dueAt);
  await clearStudyConversation(workspace.id);
  await replyHtml(ctx, [
    bold(`${item.publicId} rescheduled`),
    h(DateTime.fromJSDate(dueAt).setZone(workspace.timezone).toFormat("ccc, d LLL · h:mm a")),
  ].join("\n"), { reply_markup: studyItemKeyboard(item.id) });
}

async function showStudyDashboard(ctx: Context, workspace: StudyWorkspace, edit = false): Promise<void> {
  const dashboard = await buildStudyDashboard(workspace);
  const text = formatStudyDashboard(dashboard);
  if (edit) await editOrReplyHtml(ctx, text, { reply_markup: studyDashboardKeyboard(Boolean(dashboard.openSession), workspace.id) });
  else await replyHtml(ctx, text, { reply_markup: studyDashboardKeyboard(Boolean(dashboard.openSession), workspace.id) });
}

async function showStudyModules(ctx: Context, workspace: StudyWorkspace, edit = false): Promise<void> {
  const allModules = await listStudyModules(workspace.id, true);
  const modules = allModules.filter((module) => module.active);
  const inactive = allModules.filter((module) => !module.active);
  const text = [
    bold("Modules"),
    ...modules.map((module) => `${traffic(module.currentMastery)} ${bold(module.code)} · ${h(module.name)}`),
    ...(inactive.length ? ["", bold("Inactive"), ...inactive.map((module) => `${bold(module.code)} · ${h(module.name)}`)] : []),
  ].join("\n");
  const keyboard = new InlineKeyboard();
  for (const module of modules) {
    keyboard.text(`Open ${module.code}`, `study:module:open:${module.id}`).row()
      .text("Edit", `study:module:edit:${module.id}`).text("Archive", `study:module:archive:${module.id}`).row();
  }
  for (const module of inactive) keyboard.text(`Restore ${module.code}`, `study:module:restore:${module.id}`).row();
  keyboard.text("Add module", "study:module:add").text("Home", "study:dashboard");
  if (edit) await editOrReplyHtml(ctx, text, { reply_markup: keyboard });
  else await replyHtml(ctx, text, { reply_markup: keyboard });
}

async function showStudyWeek(ctx: Context, workspace: StudyWorkspace, requestedPage: number, edit = false): Promise<void> {
  const weekNumber = academicWeekNumber(workspace);
  const week = await ensureStudyWeek(workspace, weekNumber);
  const all = await prisma.studyItem.findMany({ where: { workspaceId: workspace.id, weekId: week.id, module: { active: true } }, include: { module: true }, orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }] });
  const pageCount = Math.max(1, Math.ceil(all.length / LIST_PAGE_SIZE));
  const page = clampPage(requestedPage, pageCount);
  const rows = all.slice(page * LIST_PAGE_SIZE, page * LIST_PAGE_SIZE + LIST_PAGE_SIZE);
  const text = [
    bold(`Week ${week.number}${pageCount > 1 ? ` · ${page + 1}/${pageCount}` : ""}`),
    week.reviewCompleted ? "Review complete" : "Review open",
    "",
    ...(rows.length ? rows.map((item) => `${statusMark(item.status)} ${code(item.publicId)} · ${bold(item.module.code)}\n${h(truncate(item.title, 150))}${item.dueAt ? `\nDue ${h(DateTime.fromJSDate(item.dueAt).setZone(workspace.timezone).toFormat("ccc, d LLL · h:mm a"))}` : ""}`) : ["No items planned for this week."]),
  ].join("\n");
  const keyboard = paginationKeyboard("items", page, pageCount);
  keyboard.text("Add item", "study:add:start").text("Plan", "study:plan").row().text("Home", "study:dashboard");
  if (edit) await editOrReplyHtml(ctx, text, { reply_markup: keyboard });
  else await replyHtml(ctx, text, { reply_markup: keyboard });
}

async function showUpcoming(ctx: Context, workspace: StudyWorkspace, requestedPage: number, edit = false): Promise<void> {
  const all = await upcomingStudyItems(workspace.id);
  const pageCount = Math.max(1, Math.ceil(all.length / LIST_PAGE_SIZE));
  const page = clampPage(requestedPage, pageCount);
  const rows = all.slice(page * LIST_PAGE_SIZE, page * LIST_PAGE_SIZE + LIST_PAGE_SIZE);
  const text = [
    bold(`Upcoming${pageCount > 1 ? ` · ${page + 1}/${pageCount}` : ""}`),
    "",
    ...(rows.length ? rows.map((item) => `${priorityMark(item.priority)} ${code(item.publicId)} · ${bold(item.module.code)}\n${h(truncate(item.title, 150))}${item.dueAt ? `\n${h(DateTime.fromJSDate(item.dueAt).setZone(workspace.timezone).toFormat("ccc, d LLL · h:mm a"))}` : " · no deadline"}`) : ["Nothing upcoming."]),
  ].join("\n");
  const keyboard = paginationKeyboard("upcoming", page, pageCount);
  keyboard.text("Add item", "study:add:start").text("Home", "study:dashboard");
  if (edit) await editOrReplyHtml(ctx, text, { reply_markup: keyboard });
  else await replyHtml(ctx, text, { reply_markup: keyboard });
}

async function showStudyMistakes(ctx: Context, workspace: StudyWorkspace, requestedPage: number, edit = false): Promise<void> {
  const all = await listStudyMistakes(workspace.id);
  const pageCount = Math.max(1, Math.ceil(all.length / LIST_PAGE_SIZE));
  const page = clampPage(requestedPage, pageCount);
  const rows = all.slice(page * LIST_PAGE_SIZE, page * LIST_PAGE_SIZE + LIST_PAGE_SIZE);
  const text = [
    bold(`Mistakes${pageCount > 1 ? ` · ${page + 1}/${pageCount}` : ""}`),
    "",
    ...(rows.length ? rows.map((mistake) => `${mistake.status === "REATTEMPT_DUE" ? "↻" : "•"} ${code(mistake.publicId)} · ${bold(mistake.module.code)}\n${h(truncate(mistake.source, 150))}${mistake.revisitAt ? `\nRevisit ${h(DateTime.fromJSDate(mistake.revisitAt).setZone(workspace.timezone).toFormat("ccc, d LLL · h:mm a"))}` : ""}`) : ["No unresolved mistakes."]),
  ].join("\n");
  const keyboard = paginationKeyboard("mistakes", page, pageCount);
  for (const mistake of rows.slice(0, 3)) keyboard.text(`Resolve ${mistake.publicId}`, `study:mistake:resolve:${mistake.id}`).row();
  keyboard.text("Record mistake", "study:mistake:start").text("Home", "study:dashboard");
  if (edit) await editOrReplyHtml(ctx, text, { reply_markup: keyboard });
  else await replyHtml(ctx, text, { reply_markup: keyboard });
}

async function showSessionItems(ctx: Context, workspace: StudyWorkspace, moduleId: string): Promise<void> {
  const module = await findStudyModule(workspace.id, moduleId);
  if (!module.active) throw new StudyModeError("That module is inactive. Restore it before starting a session.", "invalid");
  const items = await prisma.studyItem.findMany({
    where: {
      workspaceId: workspace.id,
      moduleId: module.id,
      status: { in: ["OPEN", "IN_PROGRESS"] },
    },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: LIST_PAGE_SIZE,
  });
  await beginStudyConversation(workspace.id, "session", "item", { moduleId: module.id });
  const keyboard = new InlineKeyboard().text("No specific item", "study:session:item:none").row();
  for (const item of items) keyboard.text(item.publicId, `study:session:item:${item.id}`).row();
  keyboard.text("Cancel", "study:cancel");
  await editOrReplyHtml(ctx, [
    bold(`${module.code} session`),
    items.length ? "Link this session to an item, or continue without one." : "No open items. Continue without one.",
  ].join("\n"), { reply_markup: keyboard });
}

async function showSessionMethods(ctx: Context, workspace: StudyWorkspace, moduleId: string, edit = true): Promise<void> {
  const module = await findStudyModule(workspace.id, moduleId);
  const methods = STUDY_METHODS[module.code] ?? ["Focused study"];
  const keyboard = new InlineKeyboard();
  methods.forEach((method, index) => keyboard.text(method, `study:session:method:${module.id}:${index}`).row());
  keyboard.text("Cancel", "study:cancel");
  const text = [bold(`${module.code} session`), "Choose a method."].join("\n");
  if (edit) await editOrReplyHtml(ctx, text, { reply_markup: keyboard });
  else await replyHtml(ctx, text, { reply_markup: keyboard });
}

async function handleScheduleCommand(ctx: Context, workspace: StudyWorkspace, args: string): Promise<void> {
  if (/^add\s+/i.test(args)) {
    const body = args.replace(/^add\s+/i, "");
    const [dayText, timeText, labelText, moduleText] = body.split("|").map((value) => value.trim());
    const day = DAY_NAMES.findIndex((name) => name.toLowerCase().startsWith((dayText ?? "").toLowerCase())) + 1;
    const match = /^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/.exec(timeText ?? "");
    if (!day || !match?.[1] || !match[2] || !labelText) throw new StudyModeError("Use /study schedule add Monday | 14:00-16:00 | Label | CS2100", "invalid");
    const module = moduleText ? await findStudyModule(workspace.id, moduleText) : undefined;
    const block = await addStudyScheduleBlock(workspace, { dayOfWeek: day, startTime: match[1], endTime: match[2], label: labelText, moduleId: module?.id });
    await replyHtml(ctx, `${bold("Schedule block added")}\n${DAY_NAMES[block.dayOfWeek - 1]} · ${block.startTime}-${block.endTime}\n${h(block.label)}`, { reply_markup: studyHomeKeyboard(workspace.id) });
    return;
  }
  if (/^(?:archive|remove)\s+/i.test(args)) {
    const blockId = args.replace(/^(?:archive|remove)\s+/i, "").trim();
    await archiveStudyScheduleBlock(workspace, blockId);
    await replyHtml(ctx, "Schedule block archived.", { reply_markup: studyHomeKeyboard(workspace.id) });
    return;
  }
  const blocks = await listStudyScheduleBlocks(workspace.id);
  await replyHtml(ctx, [bold("Editable schedule"), ...blocks.map((block) => `${DAY_NAMES[block.dayOfWeek - 1]} ${block.startTime}-${block.endTime} · ${block.module?.code ? `${block.module.code} · ` : ""}${h(block.label)}\n${code(block.id)}`), "", `Add: ${code("/study schedule add Monday | 14:00-16:00 | Label | CS2100")}`, `Remove: ${code("/study schedule remove BLOCK_ID")}`].join("\n"), { reply_markup: studyHomeKeyboard(workspace.id) });
}

async function sendStudyExports(ctx: Context, workspace: StudyWorkspace): Promise<void> {
  const files = await createStudyExports(workspace);
  await replyHtml(ctx, [bold("Study export"), "PostgreSQL remains the source of truth. Sending six master-sheet-ready CSV files."].join("\n"));
  for (const file of files) {
    await ctx.replyWithDocument(new InputFile(Buffer.from(file.content, "utf8"), file.fileName));
  }
}

function formatStudyDashboard(dashboard: Awaited<ReturnType<typeof buildStudyDashboard>>): string {
  const weekLabel = dashboard.weekNumber > 0 ? `Week ${dashboard.weekNumber}` : "Before Week 1";
  const warnings = [
    dashboard.amberWarning ? "More than two modules are amber. Reduce or sequence the load." : undefined,
    dashboard.redWarning ? "A red or repeated-red module needs one concrete recovery action." : undefined,
  ].filter(Boolean);
  return [
    bold(`${dashboard.workspace.semesterName} · ${weekLabel}`),
    `${traffic(dashboard.overallStatus)} Overall · ${dashboard.week?.reviewCompleted ? "review complete" : "review open"}`,
    dashboard.openSession ? `▶ ${bold(dashboard.openSession.moduleCode)} · ${h(dashboard.openSession.method)}` : undefined,
    "",
    ...dashboard.modules.map((module) => [
      `${traffic(module.status)} ${bold(module.code)} · ${module.open} open · ${module.overdue} overdue`,
      `   ${module.unprocessed} unprocessed · ${module.actualMinutes}/${module.plannedMinutes || 0} min · ${module.mistakesDue} reattempt${module.mistakesDue === 1 ? "" : "s"}`,
      module.nearestDeadline ? `   Next ${h(DateTime.fromJSDate(module.nearestDeadline).setZone(dashboard.workspace.timezone).toFormat("d LLL · h:mm a"))}` : undefined,
      module.timedPracticeMissing ? "   Timed cumulative practice not logged" : undefined,
    ].filter(Boolean).join("\n")),
    dashboard.topPriorities.length ? `\n${bold("Top priorities")}\n${dashboard.topPriorities.map((value, index) => `${index + 1}. ${h(value)}`).join("\n")}` : undefined,
    dashboard.nextBlock ? `\n${bold("Next block")}\n${h(dashboard.nextBlock.label)} · ${h(DateTime.fromJSDate(dashboard.nextBlock.startsAt).setZone(dashboard.workspace.timezone).toFormat("ccc, d LLL · h:mm a"))}` : undefined,
    warnings.length ? `\n${bold("Attention")}\n${warnings.map(h).join("\n")}` : undefined,
  ].filter(Boolean).join("\n");
}

function formatStudyHelp(): string {
  return [
    bold("Study Mode"),
    "Use the buttons, or write naturally:",
    code("todo: finish CS2100 tutorial Friday 6pm"),
    code("note: cache misses stall the pipeline for CS2100"),
    code("what needs attention?"),
    code("open CS2102"),
    code("start note session"),
    code("sync Canvas"),
    code("save this to CS2100"),
    "",
    `Slash commands remain available as fallbacks: ${code("/study help")}.`,
    "Core behavior is deterministic and works without an AI key.",
  ].join("\n");
}

function studyHomeKeyboard(workspaceId: string): InlineKeyboard {
  return new InlineKeyboard().text("Attention", "study:attention").text("This week", "study:items:0").row()
    .text("Modules", "study:modules").text("Upcoming", "study:upcoming:0").row()
    .text("Start session", "study:session:pick").text("Canvas", "study:canvas:status").row()
    .text("Travel", "study:travel").text("Plan week", "study:plan").row()
    .text("Weekly review", "study:review:start").row()
    .text("Setup", "study:onboarding").text("Help", "study:help").row()
    .url("Timetable", groupDashboardUrl(workspaceId, "study-timetable")).url("Study dashboard", groupDashboardUrl(workspaceId, "study-overview"));
}

function studyDashboardKeyboard(running: boolean, workspaceId: string): InlineKeyboard {
  const keyboard = new InlineKeyboard().text("Attention", "study:attention").text("This week", "study:items:0").row()
    .text("Modules", "study:modules").text("Resources", "study:resources:a:1").row()
    .text("Add work", "study:add:start").text(running ? "Stop session" : "Start session", running ? "study:session:stop" : "study:session:pick").row()
    .text("Travel", "study:travel").text("Weekly preview", "study:preview").row()
    .text("Review", "study:review:start").row()
    .text("Canvas", "study:canvas:status").text("Setup", "study:onboarding").row()
    .url("Timetable", groupDashboardUrl(workspaceId, "study-timetable")).url("Study dashboard", groupDashboardUrl(workspaceId, "study-overview"));
  return keyboard;
}

function moduleSelectionKeyboard(modules: Array<{ id: string; code: string }>, purpose: "add" | "session" | "mistake"): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const module of modules) {
    const data = purpose === "add" ? `study:add:module:${module.id}` : purpose === "session" ? `study:session:module:${module.id}` : `study:mistake:module:${module.id}`;
    keyboard.text(module.code, data).row();
  }
  keyboard.text("Cancel", "study:cancel");
  return keyboard;
}

function studyItemTypeKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const labels: Array<[StudyItemType, string]> = [
    [StudyItemType.LECTURE, "Lecture"], [StudyItemType.TUTORIAL, "Tutorial"], [StudyItemType.LAB, "Lab"],
    [StudyItemType.ASSIGNMENT, "Assignment"], [StudyItemType.PROJECT, "Project"], [StudyItemType.REVISION, "Revision"],
    [StudyItemType.TIMED_PRACTICE, "Timed practice"], [StudyItemType.READING, "Reading"], [StudyItemType.ADMINISTRATIVE, "Administrative"],
  ];
  labels.forEach(([value, label], index) => {
    keyboard.text(label, `study:add:type:${value}`);
    if (index % 2 === 1) keyboard.row();
  });
  return keyboard.row().text("Cancel", "study:cancel");
}

function priorityKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("Low", "study:add:priority:LOW").text("Normal", "study:add:priority:NORMAL").row()
    .text("High", "study:add:priority:HIGH").text("Critical", "study:add:priority:CRITICAL").row()
    .text("Cancel", "study:cancel");
}

function mistakeCategoryKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Concept", `study:mistake:category:${StudyMistakeCategory.CONCEPTUAL_MISUNDERSTANDING}`).row()
    .text("Wrong approach", `study:mistake:category:${StudyMistakeCategory.WRONG_APPROACH}`).row()
    .text("Careless execution", `study:mistake:category:${StudyMistakeCategory.EXECUTION_CARELESS}`).row()
    .text("Time management", `study:mistake:category:${StudyMistakeCategory.TIME_MANAGEMENT}`).row()
    .text("Cancel", "study:cancel");
}

function reviewStatusKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("Green", "study:review:status:GREEN").text("Amber", "study:review:status:AMBER").text("Red", "study:review:status:RED").row().text("Cancel", "study:cancel");
}

function cancelKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("Cancel", "study:cancel");
}

function studyItemKeyboard(itemId: string): InlineKeyboard {
  return new InlineKeyboard().text("Complete", `study:item:done:${itemId}`).text("Processed", `study:item:processed:${itemId}`).row()
    .text("Green", `study:mastery:item:${itemId}:GREEN`).text("Amber", `study:mastery:item:${itemId}:AMBER`).text("Red", `study:mastery:item:${itemId}:RED`).row()
    .text("Reschedule", `study:item:reschedule:${itemId}`).row()
    .text("Home", "study:dashboard");
}

function paginationKeyboard(kind: "items" | "upcoming" | "mistakes", page: number, count: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (count > 1) {
    if (page > 0) keyboard.text("←", `study:${kind}:${page - 1}`);
    keyboard.text(`${page + 1}/${count}`, `study:${kind}:${page}`);
    if (page < count - 1) keyboard.text("→", `study:${kind}:${page + 1}`);
    keyboard.row();
  }
  return keyboard;
}

async function advanceReviewTextStep(ctx: Context, workspace: StudyWorkspace, payload: Record<string, unknown>, current: Record<string, unknown>, step: string, question: string): Promise<void> {
  await advanceStudyConversation(workspace.id, step, { ...payload, current } as Prisma.InputJsonObject);
  await replyHtml(ctx, question, { reply_markup: cancelKeyboard() });
}

async function advanceGlobalReview(ctx: Context, workspace: StudyWorkspace, payload: Record<string, unknown>, field: string, text: string, step: string, question: string): Promise<void> {
  const answers = /^skip$/i.test(text) ? [] : splitAnswers(text);
  await advanceStudyConversation(workspace.id, step, { ...payload, [field]: answers } as Prisma.InputJsonObject);
  await replyHtml(ctx, question, { reply_markup: cancelKeyboard() });
}

function reviewQuestion(module: { code: string }, position: number): string {
  return [bold(`${position}. ${module.code}`), "Is the current material processed? Reply yes, no, or partly."].join("\n");
}

async function requireConversation(workspaceId: string, kind: string) {
  const conversation = await getStudyConversation(workspaceId);
  if (!conversation || conversation.kind !== kind) throw new StudyModeError("That guided flow has expired. Start it again.", "invalid");
  return conversation;
}

async function assertSealedStudyGroup(ctx: Context, workspace?: StudyWorkspace): Promise<void> {
  const chatId = String(ctx.chat?.id ?? "");
  const verifiedAt = sealedGroupChecks.get(chatId);
  if (verifiedAt && Date.now() - verifiedAt < SEALED_GROUP_CHECK_TTL_MS) return;
  let count: number;
  try {
    count = await ctx.api.getChatMemberCount(ctx.chat!.id);
  } catch {
    throw new StudyModeError("Study Mode could not verify that this group is private. Try again shortly.", "forbidden");
  }
  if (count <= 2) {
    sealedGroupChecks.set(chatId, Date.now());
    return;
  }
  sealedGroupChecks.delete(chatId);
  if (workspace?.active) await unbindStudyWorkspace(workspace.id);
  throw new StudyModeError("Study Mode locked because this group contains another account. Remove it, then run /study bind again.", "forbidden");
}

async function replyStudyError(ctx: Context, error: unknown): Promise<void> {
  const message = error instanceof StudyModeError ? error.message : userFacingError(error, "Study Mode couldn't complete that just now.");
  await ctx.reply(message);
}

async function replyStudyCallbackError(ctx: Context, error: unknown): Promise<void> {
  const message = error instanceof StudyModeError ? error.message : userFacingError(error, "Study Mode couldn't complete that just now.");
  try {
    await ctx.answerCallbackQuery({ text: message.slice(0, 180), show_alert: true });
  } catch {
    await ctx.reply(message);
  }
}

function parseMastery(value: string): StudyTrafficLight | undefined {
  const normalized = value.trim().toUpperCase();
  return normalized === StudyTrafficLight.GREEN
    || normalized === StudyTrafficLight.AMBER
    || normalized === StudyTrafficLight.RED
    ? normalized as StudyTrafficLight
    : undefined;
}

function traffic(status: StudyTrafficLight): string {
  return status === StudyTrafficLight.GREEN ? "🟢" : status === StudyTrafficLight.AMBER ? "🟠" : status === StudyTrafficLight.RED ? "🔴" : "⚪";
}

function priorityMark(priority: StudyPriority): string {
  return priority === StudyPriority.CRITICAL ? "‼" : priority === StudyPriority.HIGH ? "!" : "•";
}

function statusMark(status: string): string {
  return status === "DONE" ? "✓" : status === "PROCESSED" ? "◉" : status === "IN_PROGRESS" ? "▶" : "○";
}

function clampPage(value: number, pageCount: number): number {
  return Math.min(Math.max(0, Number.isFinite(value) ? Math.trunc(value) : 0), pageCount - 1);
}

function splitAnswers(value: string): string[] {
  return value.split(/\r?\n|\s*;\s*/).map((answer) => answer.replace(/^[-*•\d.)\s]+/, "").trim()).filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function optionalAnswer(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return !text || /^skip$/i.test(text) ? undefined : text;
}

function normalizeReviewAnswers(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((entry) => entry.trim()).filter(Boolean);
  return typeof value === "string" ? splitAnswers(value) : [];
}

function parseSessionResult(text: string): { result: string; topicsMixed?: string[]; attemptedScore?: number; maximumScore?: number; usedNotes?: boolean } {
  const score = /\bscore\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/i.exec(text);
  const topics = /\btopics?\s*:\s*([^;]+)/i.exec(text);
  const usedNotes = /\bwithout\s+notes\b/i.test(text) ? false : /\bwith\s+notes\b/i.test(text) ? true : undefined;
  return {
    result: text.slice(0, 2_000),
    topicsMixed: topics?.[1]?.split(",").map((value) => value.trim()).filter(Boolean),
    attemptedScore: score?.[1] ? Number(score[1]) : undefined,
    maximumScore: score?.[2] ? Number(score[2]) : undefined,
    usedNotes,
  };
}
