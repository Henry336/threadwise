/**
 * Imports a NUSMods timetable share link into Study schedule blocks. Called from the Study bot
 * (src/bot/study.ts) and the dashboard (src/dashboard/study.ts). It fetches the selected modules from
 * the public NUSMods API, upserts recurring blocks tagged source=NUSMODS, and passes each venue through
 * studyTransit so a recognised venue can drive travel reminders. Manual blocks are never rewritten.
 */
import type { StudyScheduleBlock, StudyWorkspace } from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "../db/prisma";
import { logger } from "../logger";
import { resolveStudyPlace } from "./studyTransit";
import { StudyModeError } from "./study";

const NUSMODS_API = "https://api.nusmods.com/v2";
const NUSMODS_SOURCE = "NUSMODS";
/** Sources whose class-like blocks an import may take over instead of creating a duplicate beside them. */
const NUSMODS_ADOPTABLE_SOURCES = ["MANUAL", "SYSTEM_SEED"];
const CLASS_LIKE_BLOCK_TYPES = new Set([
  "class", "design lecture", "ensemble teaching", "lab", "laboratory", "lecture",
  "lesson", "packaged lecture", "packaged tutorial", "recitation", "sectional teaching",
  "seminar", "timetable", "tutorial", "tutorial type 2", "tutorial type 3", "workshop",
]);
const DAY_NUMBER: Record<string, number> = {
  Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6, Sunday: 7,
};
const LESSON_SHORT_NAMES: Record<string, string> = {
  DLEC: "Design lecture", ENSEMBLE: "Ensemble teaching", LAB: "Laboratory",
  LEC: "Lecture", PLEC: "Packaged lecture", PTUT: "Packaged tutorial",
  REC: "Recitation", SEC: "Sectional teaching", SEM: "Seminar",
  TUT: "Tutorial", TUT2: "Tutorial type 2", TUT3: "Tutorial type 3", WS: "Workshop",
};
const LESSON_TYPE_CODES = new Map([
  ...Object.entries(LESSON_SHORT_NAMES).map(([code, name]) => [name.toLowerCase(), code] as const),
  ["seminar-style module class", "SEM"],
]);

type ShareSelection = { lessonCode: string; classNo: string };
export type NusmodsShare = { semester: number; modules: Array<{ code: string; selections: ShareSelection[] }> };
type NusmodsWeeks = number[] | { start: string; end: string };
type NusmodsLesson = {
  classNo: string;
  startTime: string;
  endTime: string;
  weeks: NusmodsWeeks;
  venue: string;
  day: keyof typeof DAY_NUMBER;
  lessonType: string;
};
type NusmodsModule = {
  moduleCode: string;
  title: string;
  semesterData?: Array<{ semester: number; timetable?: NusmodsLesson[] }>;
};

export type NusmodsImportResult = {
  academicYear: string;
  semester: number;
  modules: number;
  blocks: number;
  unresolvedVenues: string[];
};

/**
 * Parses a nusmods.com/timetable/sem-N/share link into modules and their lesson selections
 * (e.g. CS2040S=LEC:1,TUT:05). Only Semester 1 and 2 links on nusmods.com are accepted, and class
 * numbers lose leading zeros so "05" and "5" match.
 */
export function parseNusmodsShareUrl(raw: string): NusmodsShare {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new StudyModeError("Paste a valid NUSMods timetable share link.", "invalid"); }
  if (!/(^|\.)nusmods\.com$/i.test(url.hostname)) throw new StudyModeError("Use a nusmods.com timetable share link.", "invalid");
  const match = /^\/timetable\/sem-(\d+)\/share\/?$/i.exec(url.pathname);
  const semester = Number(match?.[1]);
  if (!match || ![1, 2].includes(semester)) throw new StudyModeError("Use a Semester 1 or Semester 2 NUSMods timetable share link.", "invalid");
  const modules = [...url.searchParams.entries()].map(([rawCode, rawSelections]) => ({
    code: rawCode.trim().toUpperCase(),
    selections: rawSelections.split(",").map((entry) => entry.trim()).filter(Boolean).map((entry) => {
      const [lessonCode, ...classParts] = entry.split(":");
      if (!lessonCode || !classParts.length) throw new StudyModeError(`NUSMods selection "${entry}" is incomplete.`, "invalid");
      return { lessonCode: lessonCode.toUpperCase(), classNo: normalizeClassNo(classParts.join(":")) };
    }),
  })).filter((entry) => /^[A-Z0-9]+$/.test(entry.code));
  if (!modules.length) throw new StudyModeError("That NUSMods link does not contain any modules.", "invalid");
  return { semester, modules };
}

/** NUS academic year (e.g. "2026-2027") from the configured semester start; years start in July. */
export function academicYearForStudy(workspace: StudyWorkspace): string {
  const date = semesterStartFor(workspace);
  const startYear = date.month >= 7 ? date.year : date.year - 1;
  return `${startYear}-${startYear + 1}`;
}

/**
 * Runs the full import for the owner's workspace. Each lesson gets a stable sourceRef
 * (semester, module, lesson type, class, day, times), so re-importing updates the same block.
 * If no imported block exists yet, an equivalent manual or seeded class block is adopted rather than
 * duplicated; extra equivalents are deactivated. This fixed an early bug where imports layered
 * duplicates. NUSMods blocks missing from the new link are deactivated. Writes an audit log row.
 */
export async function importStudyNusmodsTimetable(workspace: StudyWorkspace, rawUrl: string): Promise<NusmodsImportResult> {
  const share = parseNusmodsShareUrl(rawUrl);
  const academicYear = academicYearForStudy(workspace);
  const resolved = await Promise.all(share.modules.map(async (selection) => ({
    selection,
    module: await fetchNusmodsModule(academicYear, selection.code),
  })));
  const refs: string[] = [];
  const unresolved = new Set<string>();
  let blockCount = 0;

  for (const [moduleIndex, entry] of resolved.entries()) {
    const module = await prisma.studyModule.upsert({
      where: { workspaceId_code: { workspaceId: workspace.id, code: entry.selection.code } },
      update: { name: entry.module.title, active: true, userArchivedAt: null },
      create: {
        workspaceId: workspace.id,
        code: entry.selection.code,
        name: entry.module.title,
        displayOrder: moduleIndex,
        active: true,
      },
    });
    const timetable = entry.module.semesterData?.find((value) => value.semester === share.semester)?.timetable ?? [];
    for (const selected of entry.selection.selections) {
      const lessons = timetable.filter((candidate) => lessonMatches(candidate, selected));
      if (!lessons.length) throw new StudyModeError(`NUSMods could not find ${entry.selection.code} ${selected.lessonCode}:${selected.classNo} for ${academicYear} Semester ${share.semester}.`, "not_found");
      for (const lesson of lessons) {
        const lessonCode = selected.lessonCode;
        const dayOfWeek = DAY_NUMBER[lesson.day];
        if (!dayOfWeek) throw new StudyModeError(`NUSMods returned an unsupported day for ${entry.selection.code}.`, "invalid");
        const sourceRef = [share.semester, entry.selection.code, lessonCode, selected.classNo, lesson.day, lesson.startTime, lesson.endTime].join(":");
        refs.push(sourceRef);
        const weeks = expandNusmodsWeeks(lesson.weeks, workspace);
        const place = lesson.venue && lesson.venue !== "E-Learn_C" ? await resolveVenue(lesson.venue) : undefined;
        if (lesson.venue && lesson.venue !== "E-Learn_C" && !place) unresolved.add(lesson.venue);
        const startTime = toClock(lesson.startTime);
        const endTime = toClock(lesson.endTime);
        const blockType = LESSON_SHORT_NAMES[lessonCode] ?? lesson.lessonType;
        const importedData = {
          moduleId: module.id,
          label: `${entry.selection.code} ${blockType}`,
          blockType,
          dayOfWeek,
          startTime,
          endTime,
          startWeek: weeks[0] ?? null,
          endWeek: weeks.at(-1) ?? null,
          venueId: place?.providerId ?? null,
          venueName: (place?.displayName ?? lesson.venue) || null,
          destinationStopId: place?.nearbyStops[0]?.id ?? null,
          active: true,
        };
        const existingImported = await prisma.studyScheduleBlock.findUnique({
          where: { workspaceId_source_sourceRef: { workspaceId: workspace.id, source: NUSMODS_SOURCE, sourceRef } },
        });
        const equivalentLocal = (await prisma.studyScheduleBlock.findMany({
          where: {
            workspaceId: workspace.id,
            moduleId: module.id,
            dayOfWeek,
            startTime,
            endTime,
            active: true,
            source: { in: NUSMODS_ADOPTABLE_SOURCES },
          },
          orderBy: { createdAt: "asc" },
        })).filter(isReplaceableNusmodsCandidate);

        let canonicalId: string;
        if (existingImported) {
          await prisma.studyScheduleBlock.update({ where: { id: existingImported.id }, data: importedData });
          canonicalId = existingImported.id;
        } else if (equivalentLocal[0]) {
          const adopted = await prisma.studyScheduleBlock.update({
            where: { id: equivalentLocal[0].id },
            data: { ...importedData, source: NUSMODS_SOURCE, sourceRef },
          });
          canonicalId = adopted.id;
        } else {
          const created = await prisma.studyScheduleBlock.create({
            data: { workspaceId: workspace.id, source: NUSMODS_SOURCE, sourceRef, ...importedData },
          });
          canonicalId = created.id;
        }

        const redundantIds = equivalentLocal.map((candidate) => candidate.id).filter((id) => id !== canonicalId);
        if (redundantIds.length) {
          await prisma.studyScheduleBlock.updateMany({ where: { id: { in: redundantIds } }, data: { active: false } });
        }
        blockCount += 1;
      }
    }
  }
  await prisma.studyScheduleBlock.updateMany({
    where: { workspaceId: workspace.id, source: NUSMODS_SOURCE, ...(refs.length ? { sourceRef: { notIn: refs } } : {}) },
    data: { active: false },
  });
  await prisma.auditLog.create({ data: { userId: workspace.ownerUserId, action: "study.nusmods.imported", metadata: { workspaceId: workspace.id, academicYear, semester: share.semester, modules: share.modules.length, blocks: blockCount } } });
  return { academicYear, semester: share.semester, modules: share.modules.length, blocks: blockCount, unresolvedVenues: [...unresolved] };
}

/** Fetches one module's public NUSMods data with a 10 second timeout, mapping failures to user-facing errors. */
async function fetchNusmodsModule(academicYear: string, code: string): Promise<NusmodsModule> {
  const response = await fetch(`${NUSMODS_API}/${academicYear}/modules/${encodeURIComponent(code)}.json`, { signal: AbortSignal.timeout(10_000) });
  if (response.status === 404) throw new StudyModeError(`NUSMods has no ${code} data for ${academicYear}.`, "not_found");
  if (!response.ok) throw new StudyModeError("NUSMods could not be reached. Try the import again shortly.", "conflict");
  return response.json() as Promise<NusmodsModule>;
}

function normalizeClassNo(value: string): string { return value.trim().toUpperCase().replace(/^0+(?=\d)/, ""); }
/**
 * True when an existing block may be taken over by the import: it came from a manual or seeded
 * source and its type looks like a class. Study and protected blocks are left alone.
 */
export function isReplaceableNusmodsCandidate(block: Pick<StudyScheduleBlock, "source" | "blockType">): boolean {
  return NUSMODS_ADOPTABLE_SOURCES.includes(block.source)
    && CLASS_LIKE_BLOCK_TYPES.has(block.blockType.trim().toLowerCase());
}
/** Matches an API lesson to a share selection by short lesson code (LEC, TUT, ...) and class number. */
function lessonMatches(lesson: NusmodsLesson, selected: ShareSelection): boolean {
  const lessonCode = LESSON_TYPE_CODES.get(lesson.lessonType.trim().toLowerCase()) ?? lesson.lessonType.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return lessonCode === selected.lessonCode && normalizeClassNo(lesson.classNo) === selected.classNo;
}
function toClock(value: string): string { return `${value.slice(0, 2)}:${value.slice(2, 4)}`; }
function semesterStartFor(workspace: StudyWorkspace): DateTime {
  if (!workspace.semesterStartDate) throw new StudyModeError("Set the semester start date before importing a NUSMods timetable.", "conflict");
  return DateTime.fromJSDate(workspace.semesterStartDate, { zone: workspace.timezone }).startOf("day");
}
/**
 * Converts NUSMods "weeks" into semester week numbers. The API gives either an explicit list or a
 * start/end date range; a range is converted using the workspace semester start and timezone.
 * The import stores only the first and last week of the result.
 */
export function expandNusmodsWeeks(values: NusmodsWeeks, workspace: StudyWorkspace): number[] {
  const semesterStart = semesterStartFor(workspace);
  if (Array.isArray(values)) return [...new Set(values.filter((value) => Number.isInteger(value) && value > 0))].sort((a, b) => a - b);
  const start = DateTime.fromISO(values.start, { zone: workspace.timezone }).startOf("day");
  const end = DateTime.fromISO(values.end, { zone: workspace.timezone }).startOf("day");
  if (!start.isValid || !end.isValid || end < start) return [];
  const firstWeek = Math.max(1, Math.floor(start.diff(semesterStart, "days").days / 7) + 1);
  const count = Math.max(1, Math.floor(end.diff(start, "days").days / 7) + 1);
  return Array.from({ length: count }, (_, index) => firstWeek + index);
}
/** Best-effort venue lookup: a failure is logged and treated as unresolved so the import still finishes. */
async function resolveVenue(venue: string) {
  try { return await resolveStudyPlace(venue); }
  catch (error) { logger.warn("NUSMods venue was not resolved for Study routing.", { venue, error: error instanceof Error ? error.message : String(error) }); return undefined; }
}
