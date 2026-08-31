import { IdeaStatus, ReminderMode, StudyItemType, TaskStatus } from "@prisma/client";
import { z } from "zod";
import { OVERVIEW_QUOTE_AUTHOR_LIMIT, OVERVIEW_QUOTE_LIMIT, OVERVIEW_QUOTE_TEXT_LIMIT } from "./overviewQuotes";

const trimmed = (maximum: number) => z.string().trim().min(1).max(maximum);
const optionalNullableText = (maximum: number) => z.string().trim().max(maximum).nullable().optional();
const dateTime = z.string().datetime({ offset: true });
const nullableDateTime = dateTime.nullable();
const dateOnly = z.string()
  .regex(/^20\d{2}-\d{2}-\d{2}$/, "Use a date such as 2026-08-31.")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Choose a valid calendar date.");
const tags = z.array(trimmed(40)).max(20).transform((items) => [...new Set(items)]);
const reminderIntervalMinutes = z.number().int().min(15).max(43_200);
const reminderTimes = z.array(dateTime).max(20).transform((items) => [...new Set(items)]);
const compactQuoteText = (maximum: number) => z.string()
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1).max(maximum));
const overviewQuote = z.object({
  text: compactQuoteText(OVERVIEW_QUOTE_TEXT_LIMIT),
  author: compactQuoteText(OVERVIEW_QUOTE_AUTHOR_LIMIT).optional()
}).strict();
const overviewQuotes = z.array(overviewQuote).max(OVERVIEW_QUOTE_LIMIT).superRefine((items, context) => {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const key = `${item.text.toLocaleLowerCase("en")}\u0000${item.author?.toLocaleLowerCase("en") ?? ""}`;
    if (seen.has(key)) context.addIssue({ code: "custom", path: [index], message: "Remove the duplicate quote." });
    seen.add(key);
  });
});

export const dashboardIdParamsSchema = z.object({ id: trimmed(128) }).strict();
export const dashboardBrowserSessionParamsSchema = z.object({ id: z.string().uuid() }).strict();
export const dashboardBrowserSessionCreateSchema = z.object({
  ttlSeconds: z.number().int().min(300).max(7 * 24 * 60 * 60),
}).strict();

const pageQuery = {
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  q: z.string().trim().max(200).optional()
};

export const taskListQuerySchema = z.object({
  ...pageQuery,
  status: z.nativeEnum(TaskStatus).optional()
}).strict();
export const noteListQuerySchema = z.object(pageQuery).strict();
export const ideaListQuerySchema = z.object({ ...pageQuery, status: z.nativeEnum(IdeaStatus).optional() }).strict();
export const expenseListQuerySchema = z.object(pageQuery).strict();
export const imageListQuerySchema = z.object(pageQuery).strict();

export const taskCreateSchema = z.object({
  title: trimmed(500),
  description: optionalNullableText(5_000),
  dueAt: nullableDateTime.optional(),
  plannedFor: dateOnly.nullable().optional(),
  reminderIntervalMinutes: reminderIntervalMinutes.optional(),
  reminderTimes: reminderTimes.optional()
}).strict();

export const taskUpdateSchema = z.object({
  title: trimmed(500).optional(),
  description: optionalNullableText(5_000),
  dueAt: nullableDateTime.optional(),
  plannedFor: dateOnly.nullable().optional(),
  reminderIntervalMinutes: reminderIntervalMinutes.nullable().optional(),
  reminderTimes: reminderTimes.optional(),
  snoozedUntil: nullableDateTime.optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  pinned: z.boolean().optional(),
  expectedUpdatedAt: dateTime.optional()
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required.");

const collaborationReason = z.string().trim().min(1).max(500).optional();
const collaborationAssigneeId = z.string().uuid().optional();
const collaborationTelegramId = z.string().regex(/^[1-9]\d{0,19}$/);
export const taskCollaborationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set-audience"), audience: z.enum(["UNASSIGNED", "EVERYONE"]) }).strict(),
  z.object({ action: z.literal("assign"), targetTelegramId: collaborationTelegramId }).strict(),
  z.object({ action: z.literal("unassign"), assigneeId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("claim") }).strict(),
  // Retained so old dashboard clients fail gracefully instead of surfacing a schema error.
  z.object({ action: z.literal("accept"), assigneeId: collaborationAssigneeId }).strict(),
  z.object({ action: z.literal("decline"), assigneeId: collaborationAssigneeId, reason: collaborationReason }).strict(),
  z.object({ action: z.literal("block"), assigneeId: collaborationAssigneeId, reason: collaborationReason }).strict(),
  z.object({ action: z.literal("unblock"), assigneeId: collaborationAssigneeId }).strict(),
  z.object({ action: z.literal("handoff"), assigneeId: z.string().uuid(), targetTelegramId: collaborationTelegramId, reason: collaborationReason }).strict(),
]);

const taskImportAssigneeSchema = z.object({
  telegramId: z.string().regex(/^[1-9]\d{0,19}$/).optional(),
  username: z.string().trim().regex(/^[A-Za-z0-9_]{3,32}$/).optional(),
  displayName: z.string().trim().min(1).max(120).optional(),
}).strict().refine((value) => Boolean(value.telegramId || value.username || value.displayName), "An assignee identity is required.");

export const taskImportItemUpdateSchema = z.object({
  title: trimmed(500).optional(),
  dueAt: nullableDateTime.optional(),
  assignees: z.array(taskImportAssigneeSchema).max(20).optional(),
  teamOwnerLabel: optionalNullableText(120),
  initialStatus: z.union([z.literal(TaskStatus.OPEN), z.literal(TaskStatus.DONE)]).optional(),
  included: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export const noteCreateSchema = z.object({
  title: trimmed(500),
  body: trimmed(100_000),
  tags: tags.optional()
}).strict();

export const noteUpdateSchema = z.object({
  title: trimmed(500).optional(),
  body: trimmed(100_000).optional(),
  tags: tags.optional(),
  pinned: z.boolean().optional(),
  expectedUpdatedAt: dateTime.optional()
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export const personalNoteDraftQuerySchema = z.object({
  noteId: z.string().uuid().optional(),
}).strict();

export const personalNoteDraftSaveSchema = z.object({
  noteId: z.string().uuid().nullable().optional(),
  noteUpdatedAt: dateTime.nullable().optional(),
  title: z.string().max(500).default(""),
  body: z.string().max(100_000).default(""),
  expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict().refine((value) => !value.noteId || Boolean(value.noteUpdatedAt), {
  message: "The saved note version is required for an editing draft.",
  path: ["noteUpdatedAt"],
});

export const ideaCreateSchema = z.object({
  title: trimmed(500),
  concept: trimmed(20_000),
  tags: tags.optional(),
  status: z.nativeEnum(IdeaStatus).optional()
}).strict();

export const ideaUpdateSchema = z.object({
  title: trimmed(500).optional(),
  concept: trimmed(20_000).optional(),
  tags: tags.optional(),
  status: z.nativeEnum(IdeaStatus).optional(),
  pinned: z.boolean().optional(),
  expectedUpdatedAt: dateTime.optional()
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export const capturePreviewSchema = z.object({
  text: trimmed(20_000),
  preferredKind: z.enum(["auto", "task", "note", "idea", "expense"]).default("auto")
}).strict();

export const ideaConvertSchema = z.object({
  dueAt: nullableDateTime.optional(),
  reminderIntervalMinutes: reminderIntervalMinutes.optional()
}).strict();

export const expenseCreateSchema = z.object({
  merchant: optionalNullableText(500),
  description: optionalNullableText(5_000),
  total: z.number().finite().min(0).max(999_999_999.99),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  category: optionalNullableText(100),
  transactionAt: dateTime,
  paymentMethod: optionalNullableText(100),
  notes: optionalNullableText(5_000)
}).strict();

export const expenseUpdateSchema = expenseCreateSchema.partial().strict().refine(
  (value) => Object.keys(value).length > 0,
  "At least one field is required."
);

export const imageUpdateSchema = z.object({
  caption: optionalNullableText(2_000),
  pinned: z.boolean().optional(),
  expectedUpdatedAt: dateTime.optional()
}).strict().refine(
  (value) => Object.prototype.hasOwnProperty.call(value, "caption") || value.pinned !== undefined,
  "A caption or favourite field is required."
);

const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const settingsUpdateSchema = z.object({
  timezone: trimmed(100).optional(),
  reminderIntervalMinutes: reminderIntervalMinutes.optional(),
  quietHoursStart: clock.nullable().optional(),
  quietHoursEnd: clock.nullable().optional(),
  maxRemindersPerDay: z.number().int().min(1).max(2_000).optional(),
  dueNudgeMinutes: z.number().int().min(0).max(10_080).optional(),
  reminderMode: z.nativeEnum(ReminderMode).optional(),
  expenseCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
  ocrLanguages: z.string().trim().regex(/^[a-z]{3}(?:\+[a-z]{3})*$/).max(40).optional(),
  directNudgesEnabled: z.boolean().optional(),
  calendarAutoSync: z.boolean().optional(),
  excelAutoSync: z.boolean().optional(),
  overviewQuotes: overviewQuotes.optional(),
  morningBriefEnabled: z.boolean().optional(),
  morningBriefTime: clock.optional(),
  eveningDebriefEnabled: z.boolean().optional(),
  eveningDebriefTime: clock.optional()
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required.");

const taskCaptureAssigneeSchema = z.object({
  telegramId: z.string().regex(/^[1-9]\d{0,19}$/).optional(),
  username: z.string().trim().regex(/^[A-Za-z0-9_]{3,32}$/).optional(),
  displayName: z.string().trim().min(1).max(120).optional(),
}).strict().refine((value) => Boolean(value.telegramId || value.username || value.displayName), "An assignee identity is required.");

export const todayAgendaQuerySchema = z.object({
  localDate: dateOnly.optional(),
  dueSoonDays: z.coerce.number().int().min(1).max(30).default(3),
}).strict();

export const todayAgendaPlanSchema = z.object({
  plannedFor: dateOnly.nullable(),
}).strict();

export const todayAgendaOrderSchema = z.object({
  localDate: dateOnly,
  orderedEntryIds: z.array(z.string().uuid()).min(1).max(500),
  movedEntryId: z.string().uuid(),
  expectedRevision: z.number().int().min(0),
}).strict();

export const taskCaptureDraftCreateSchema = z.object({
  text: trimmed(20_000),
  moduleId: z.string().uuid().optional(),
  studyItemType: z.nativeEnum(StudyItemType).optional(),
}).strict();

export const taskCaptureDraftAppendSchema = taskCaptureDraftCreateSchema;

export const taskCaptureDraftItemUpdateSchema = z.object({
  title: trimmed(500).optional(),
  plannedFor: dateOnly.nullable().optional(),
  dueAt: nullableDateTime.optional(),
  moduleId: z.string().uuid().nullable().optional(),
  studyItemType: z.nativeEnum(StudyItemType).nullable().optional(),
  assignees: z.array(taskCaptureAssigneeSchema).max(20).optional(),
  teamOwnerLabel: optionalNullableText(120),
  linkedTaskId: z.string().uuid().nullable().optional(),
  linkedStudyItemId: z.string().uuid().nullable().optional(),
  included: z.boolean().optional(),
  resolveWarnings: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export const searchQuerySchema = z.object({
  q: trimmed(200),
  kinds: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30)
}).strict();

export const integrationParamsSchema = z.object({
  provider: z.enum(["calendar", "excel"])
}).strict();

export const integrationConnectSchema = z.object({
  taskId: z.string().trim().min(1).max(100).optional()
}).strict();

export const calendarTaskIntegrationSchema = z.object({
  taskId: z.string().trim().min(1).max(100),
  action: z.enum(["sync", "remove"])
}).strict();

export const availabilityPollCreateSchema = z.object({
  title: trimmed(160),
  startDate: z.string().regex(/^20\d{2}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^20\d{2}-\d{2}-\d{2}$/),
  timezone: trimmed(100),
  durationMinutes: z.number().int().min(15).max(240),
  dayStartMinutes: z.number().int().min(0).max(1_425).optional(),
  dayEndMinutes: z.number().int().min(15).max(1_440).optional(),
  slotMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]).optional(),
}).strict();

export const availabilityResponseSchema = z.object({
  timezone: trimmed(100),
  availableStarts: z.array(dateTime).max(2_000),
  wantsCalendar: z.boolean().optional(),
}).strict();

export const availabilityFinalizeSchema = z.object({
  startAt: dateTime,
  expectedRevision: z.number().int().positive(),
}).strict();

export const availabilityCloseSchema = z.object({
  expectedRevision: z.number().int().positive(),
}).strict();

export const availabilityCalendarSchema = z.object({
  action: z.enum(["sync", "remove"]),
}).strict();

export const deleteAccountSchema = z.object({
  confirmation: z.literal("DELETE MY THREADWISE DATA")
}).strict();

export type TaskCreateInput = z.infer<typeof taskCreateSchema>;
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;
export type TaskCollaborationInput = z.infer<typeof taskCollaborationSchema>;
export type CapturePreviewInput = z.infer<typeof capturePreviewSchema>;
export type NoteCreateInput = z.infer<typeof noteCreateSchema>;
export type NoteUpdateInput = z.infer<typeof noteUpdateSchema>;
export type PersonalNoteDraftQueryInput = z.infer<typeof personalNoteDraftQuerySchema>;
export type PersonalNoteDraftSaveInput = z.infer<typeof personalNoteDraftSaveSchema>;
export type IdeaCreateInput = z.infer<typeof ideaCreateSchema>;
export type IdeaUpdateInput = z.infer<typeof ideaUpdateSchema>;
export type IdeaConvertInput = z.infer<typeof ideaConvertSchema>;
export type ExpenseCreateInput = z.infer<typeof expenseCreateSchema>;
export type ExpenseUpdateInput = z.infer<typeof expenseUpdateSchema>;
export type ImageUpdateInput = z.infer<typeof imageUpdateSchema>;
export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;
