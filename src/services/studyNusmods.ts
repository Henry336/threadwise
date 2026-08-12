import type { StudyScheduleBlock, StudyWorkspace } from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "../db/prisma";
import { logger } from "../logger";
import { resolveStudyPlace } from "./studyTransit";
import { StudyModeError } from "./study";

const NUSMODS_API = "https://api.nusmods.com/v2";
const NUSMODS_SOURCE = "NUSMODS";
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

export function academicYearForStudy(workspace: StudyWorkspace): string {
  const date = semesterStartFor(workspace);
  const startYear = date.month >= 7 ? date.year : date.year - 1;
  return `${startYear}-${startYear + 1}`;
}

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

async function fetchNusmodsModule(academicYear: string, code: string): Promise<NusmodsModule> {
  const response = await fetch(`${NUSMODS_API}/${academicYear}/modules/${encodeURIComponent(code)}.json`, { signal: AbortSignal.timeout(10_000) });
  if (response.status === 404) throw new StudyModeError(`NUSMods has no ${code} data for ${academicYear}.`, "not_found");
  if (!response.ok) throw new StudyModeError("NUSMods could not be reached. Try the import again shortly.", "conflict");
  return response.json() as Promise<NusmodsModule>;
}

function normalizeClassNo(value: string): string { return value.trim().toUpperCase().replace(/^0+(?=\d)/, ""); }
export function isReplaceableNusmodsCandidate(block: Pick<StudyScheduleBlock, "source" | "blockType">): boolean {
  return NUSMODS_ADOPTABLE_SOURCES.includes(block.source)
    && CLASS_LIKE_BLOCK_TYPES.has(block.blockType.trim().toLowerCase());
}
function lessonMatches(lesson: NusmodsLesson, selected: ShareSelection): boolean {
  const lessonCode = LESSON_TYPE_CODES.get(lesson.lessonType.trim().toLowerCase()) ?? lesson.lessonType.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return lessonCode === selected.lessonCode && normalizeClassNo(lesson.classNo) === selected.classNo;
}
function toClock(value: string): string { return `${value.slice(0, 2)}:${value.slice(2, 4)}`; }
function semesterStartFor(workspace: StudyWorkspace): DateTime {
  if (!workspace.semesterStartDate) throw new StudyModeError("Set the semester start date before importing a NUSMods timetable.", "conflict");
  return DateTime.fromJSDate(workspace.semesterStartDate, { zone: workspace.timezone }).startOf("day");
}
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
async function resolveVenue(venue: string) {
  try { return await resolveStudyPlace(venue); }
  catch (error) { logger.warn("NUSMods venue was not resolved for Study routing.", { venue, error: error instanceof Error ? error.message : String(error) }); return undefined; }
}
