import { IdeaStatus, ReminderMode, TaskStatus } from "@prisma/client";
import { z } from "zod";

const trimmed = (maximum: number) => z.string().trim().min(1).max(maximum);
const optionalNullableText = (maximum: number) => z.string().trim().max(maximum).nullable().optional();
const dateTime = z.string().datetime({ offset: true });
const nullableDateTime = dateTime.nullable();
const tags = z.array(trimmed(40)).max(20).transform((items) => [...new Set(items)]);
const reminderIntervalMinutes = z.number().int().min(15).max(43_200);

export const dashboardIdParamsSchema = z.object({ id: trimmed(128) }).strict();

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
  reminderIntervalMinutes: reminderIntervalMinutes.optional()
}).strict();

export const taskUpdateSchema = z.object({
  title: trimmed(500).optional(),
  description: optionalNullableText(5_000),
  dueAt: nullableDateTime.optional(),
  reminderIntervalMinutes: reminderIntervalMinutes.nullable().optional(),
  snoozedUntil: nullableDateTime.optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  pinned: z.boolean().optional(),
  expectedUpdatedAt: dateTime.optional()
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export const noteCreateSchema = z.object({
  title: trimmed(500),
  body: trimmed(50_000),
  tags: tags.optional()
}).strict();

export const noteUpdateSchema = z.object({
  title: trimmed(500).optional(),
  body: trimmed(50_000).optional(),
  tags: tags.optional(),
  pinned: z.boolean().optional(),
  expectedUpdatedAt: dateTime.optional()
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required.");

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
  directNudgesEnabled: z.boolean().optional()
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export const searchQuerySchema = z.object({
  q: trimmed(200),
  kinds: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30)
}).strict();

export const integrationParamsSchema = z.object({
  provider: z.enum(["gmail", "calendar", "excel"])
}).strict();

export const deleteAccountSchema = z.object({
  confirmation: z.literal("DELETE MY THREADWISE DATA")
}).strict();

export type TaskCreateInput = z.infer<typeof taskCreateSchema>;
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;
export type CapturePreviewInput = z.infer<typeof capturePreviewSchema>;
export type NoteCreateInput = z.infer<typeof noteCreateSchema>;
export type NoteUpdateInput = z.infer<typeof noteUpdateSchema>;
export type IdeaCreateInput = z.infer<typeof ideaCreateSchema>;
export type IdeaUpdateInput = z.infer<typeof ideaUpdateSchema>;
export type IdeaConvertInput = z.infer<typeof ideaConvertSchema>;
export type ExpenseCreateInput = z.infer<typeof expenseCreateSchema>;
export type ExpenseUpdateInput = z.infer<typeof expenseUpdateSchema>;
export type ImageUpdateInput = z.infer<typeof imageUpdateSchema>;
export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;
