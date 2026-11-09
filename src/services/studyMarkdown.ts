/**
 * Markdown features for Study notes: [[wiki link]] parsing, the backlink table, bounded revision
 * history, and a plain-text rendering for Telegram. Called by studyResources, studyNoteEditSuggestions,
 * src/bot/studyCapture.ts and the dashboard Study routes after a note is saved. Write helpers accept a
 * transaction client so links and revisions commit together with the note itself.
 */
import { Prisma, StudyResourceKind, type PrismaClient, type StudyResource } from "@prisma/client";
import { prisma } from "../db/prisma";
import { normalizeStudyWikiTarget, STUDY_SCALE_BUDGETS } from "./studyScale";
export { normalizeStudyWikiTarget } from "./studyScale";

const WIKI_LINK = /(?<!\\)\[\[([^\]\n]{1,240})\]\]/gu;
const MAX_NOTE_REVISIONS = STUDY_SCALE_BUDGETS.noteRevisions;
const RETURNED_NOTE_REVISIONS = STUDY_SCALE_BUDGETS.noteRevisions;
type StudyMarkdownDatabase = Pick<PrismaClient, "studyResource" | "studyResourceRevision" | "studyNoteLink"> | Prisma.TransactionClient;

export type StudyWikiLink = {
  target: string;
  label: string;
};

/**
 * Extracts [[target]] and [[target|label]] links, deduplicated by normalized target.
 * Links inside code fences or inline code are ignored, and an escaped \[[ is not a link.
 */
export function parseStudyWikiLinks(markdown: string): StudyWikiLink[] {
  const links = new Map<string, StudyWikiLink>();
  for (const match of wikiLinkSource(markdown).matchAll(WIKI_LINK)) {
    const raw = match[1]?.trim() ?? "";
    if (!raw) continue;
    const separator = raw.indexOf("|");
    const target = (separator >= 0 ? raw.slice(0, separator) : raw).trim();
    const label = (separator >= 0 ? raw.slice(separator + 1) : target).trim() || target;
    const key = normalizeStudyWikiTarget(target);
    if (key && !links.has(key)) links.set(key, { target, label });
  }
  return [...links.values()];
}

/** Blanks out fenced code blocks and inline code spans so their contents cannot create wiki links. */
function wikiLinkSource(markdown: string): string {
  let fence: "`" | "~" | undefined;
  return markdown.split("\n").map((line) => {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/u)?.[1];
    if (fenceMatch) {
      const marker = fenceMatch[0] as "`" | "~";
      if (!fence) fence = marker;
      else if (fence === marker) fence = undefined;
      return "";
    }
    if (fence) return "";
    return line.replace(/(`+)(.*?)\1/gu, "");
  }).join("\n");
}

/**
 * Turns note Markdown into readable plain text for Telegram, which cannot render GFM or Mermaid.
 * Diagrams become a pointer to the dashboard, links show their URL, checkboxes become symbols,
 * and emphasis markers are dropped. This is the "readable Telegram fallback" for rich notes.
 */
export function markdownForTelegram(markdown: string): string {
  return markdown
    .replace(/```mermaid\s*[\s\S]*?```/giu, "\n[Mermaid diagram — open this note in Threadwise to view it]\n")
    .replace(/```[^\n]*\n([\s\S]*?)```/gu, "$1")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/gu, (_match, alt: string, url: string) => `${alt || "Image"}: ${url}`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/gu, "$1 ($2)")
    .replace(WIKI_LINK, (_match, raw: string) => {
      const separator = raw.indexOf("|");
      return (separator >= 0 ? raw.slice(separator + 1) : raw).trim();
    })
    .replace(/^\s{0,3}#{1,6}\s+/gmu, "")
    .replace(/^\s*[-*+]\s+\[(x|X)\]\s+/gmu, "☑ ")
    .replace(/^\s*[-*+]\s+\[\s\]\s+/gmu, "☐ ")
    .replace(/^\s*>\s?/gmu, "› ")
    .replace(/(\*\*|__)(.*?)\1/gu, "$2")
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/gu, "$1")
    .replace(/(?<!_)_([^_\n]+)_(?!_)/gu, "$1")
    .replace(/~~(.*?)~~/gu, "$1")
    .replace(/`([^`\n]+)`/gu, "$1")
    .replace(/^\s*[-*_]{3,}\s*$/gmu, "────────")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

/**
 * Saves a revision snapshot of a note after it changes, keeping only the newest 20 per note.
 * Skips the write when title, body and tags match the latest revision, so repeated saves do not
 * fill the history. Bodies over the revision size budget throw instead of being cut silently.
 */
export async function recordStudyNoteRevision(
  resource: Pick<StudyResource, "id" | "workspaceId" | "kind" | "title" | "body" | "tags">,
  source: "TELEGRAM" | "DASHBOARD" | "AI_SUGGESTION" | "RESTORE" = "DASHBOARD",
  database: StudyMarkdownDatabase = prisma,
): Promise<void> {
  if (resource.kind !== StudyResourceKind.NOTE || !resource.body) return;
  if (Array.from(resource.body).length > STUDY_SCALE_BUDGETS.noteRevisionBodyChars) {
    throw new Error(`Study note revisions cannot exceed ${STUDY_SCALE_BUDGETS.noteRevisionBodyChars} characters.`);
  }
  const latest = await database.studyResourceRevision.findFirst({
    where: { resourceId: resource.id },
    orderBy: { createdAt: "desc" },
    select: { title: true, body: true, tags: true },
  });
  if (latest && latest.title === resource.title && latest.body === resource.body && sameStrings(latest.tags, resource.tags)) return;
  await database.studyResourceRevision.create({
    data: {
      workspaceId: resource.workspaceId,
      resourceId: resource.id,
      title: resource.title,
      body: resource.body,
      tags: resource.tags,
      source,
    },
  });
  const stale = await database.studyResourceRevision.findMany({
    where: { resourceId: resource.id },
    orderBy: { createdAt: "desc" },
    skip: MAX_NOTE_REVISIONS,
    select: { id: true },
  });
  if (stale.length) await database.studyResourceRevision.deleteMany({ where: { id: { in: stale.map(({ id }) => id) } } });
}

/**
 * Replaces the stored outgoing links of one note with the links currently in its body.
 * Targets resolve by title or public id through the precomputed wikiLookupKeys column, only inside
 * the same workspace and only to active notes. Self-links are dropped. This table powers backlinks.
 */
export async function rebuildStudyNoteLinks(
  workspaceId: string,
  sourceResourceId: string,
  database: StudyMarkdownDatabase = prisma,
): Promise<void> {
  const source = await database.studyResource.findFirst({
    where: { id: sourceResourceId, workspaceId, kind: StudyResourceKind.NOTE, archivedAt: null },
    select: { id: true, body: true },
  });
  if (!source) return;
  const links = parseStudyWikiLinks(source.body ?? "");
  const lookupKeys = [...new Set(links.map(({ target }) => normalizeStudyWikiTarget(target)).filter(Boolean))];
  const candidates = lookupKeys.length ? await database.studyResource.findMany({
    where: { workspaceId, kind: StudyResourceKind.NOTE, archivedAt: null, wikiLookupKeys: { hasSome: lookupKeys } },
    select: { id: true, title: true, publicId: true },
  }) : [];
  const targets = new Map<string, string>();
  for (const candidate of candidates) {
    targets.set(normalizeStudyWikiTarget(candidate.title), candidate.id);
    targets.set(normalizeStudyWikiTarget(candidate.publicId), candidate.id);
  }
  const targetIds = [...new Set(links
    .map(({ target }) => targets.get(normalizeStudyWikiTarget(target)))
    .filter((id): id is string => Boolean(id && id !== source.id)))];
  await database.studyNoteLink.deleteMany({ where: { workspaceId, sourceResourceId: source.id } });
  if (targetIds.length) await database.studyNoteLink.createMany({
    data: targetIds.map((targetResourceId) => ({ workspaceId, sourceResourceId: source.id, targetResourceId })),
    skipDuplicates: true,
  });
}

/**
 * Read-side companion for the dashboard note view: outgoing links (marked resolved or not),
 * backlinks from other notes, and the stored revisions. Returns undefined for non-note resources.
 */
export async function studyNoteMetadata(
  resource: Pick<StudyResource, "id" | "workspaceId" | "kind" | "body">,
) {
  if (resource.kind !== StudyResourceKind.NOTE) return undefined;
  const outgoing = parseStudyWikiLinks(resource.body ?? "");
  const lookupKeys = [...new Set(outgoing.map(({ target }) => normalizeStudyWikiTarget(target)).filter(Boolean))];
  const [candidates, backlinks, revisions] = await Promise.all([
    prisma.studyResource.findMany({
      where: { workspaceId: resource.workspaceId, kind: StudyResourceKind.NOTE, archivedAt: null, wikiLookupKeys: { hasSome: lookupKeys.length ? lookupKeys : ["__no_wiki_target__"] } },
      select: { id: true, publicId: true, title: true, module: { select: { code: true } } },
    }),
    prisma.studyNoteLink.findMany({
      where: { workspaceId: resource.workspaceId, targetResourceId: resource.id },
      include: { source: { select: { id: true, publicId: true, title: true, module: { select: { code: true } } } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.studyResourceRevision.findMany({
      where: { workspaceId: resource.workspaceId, resourceId: resource.id },
      orderBy: { createdAt: "desc" },
      take: RETURNED_NOTE_REVISIONS,
      select: { id: true, title: true, body: true, tags: true, source: true, createdAt: true },
    }),
  ]);
  const targets = new Map<string, (typeof candidates)[number]>();
  for (const candidate of candidates) {
    targets.set(normalizeStudyWikiTarget(candidate.title), candidate);
    targets.set(normalizeStudyWikiTarget(candidate.publicId), candidate);
  }
  const outgoingLinks = outgoing.map((link) => {
    const target = targets.get(normalizeStudyWikiTarget(link.target));
    return {
      ...link,
      resolved: Boolean(target),
      resource: target ? { id: target.id, publicId: target.publicId, title: target.title, moduleCode: target.module.code } : undefined,
    };
  });
  return {
    outgoingLinks,
    backlinks: backlinks.map(({ source }) => ({
      id: source.id,
      publicId: source.publicId,
      title: source.title,
      moduleCode: source.module.code,
    })),
    revisions,
    revisionLimit: MAX_NOTE_REVISIONS,
  };
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
