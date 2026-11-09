/**
 * Shared page slicing for the Telegram list views (tasks, notes, ideas).
 * Used by src/bot/activeLists.ts, src/bot/formatters.ts and the notes/ideas
 * services so every list pages the same way.
 */
export const ACTIVE_LIST_PAGE_SIZE = 10;

export type ListPageInfo = {
  page: number;
  totalPages: number;
  offset: number;
};

export type ListPage<T> = ListPageInfo & {
  items: T[];
  totalItems: number;
};

/**
 * Returns one page of an in-memory list plus page metadata.
 * Out-of-range or non-numeric page numbers are clamped to a valid page, so a
 * stale "Next" button from an older message never shows an empty page.
 */
export function paginateList<T>(items: T[], requestedPage = 1, pageSize = ACTIVE_LIST_PAGE_SIZE): ListPage<T> {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.min(Math.max(1, Math.trunc(requestedPage) || 1), totalPages);
  const offset = (page - 1) * pageSize;
  return { items: items.slice(offset, offset + pageSize), page, totalPages, offset, totalItems };
}
