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

export function paginateList<T>(items: T[], requestedPage = 1, pageSize = ACTIVE_LIST_PAGE_SIZE): ListPage<T> {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.min(Math.max(1, Math.trunc(requestedPage) || 1), totalPages);
  const offset = (page - 1) * pageSize;
  return { items: items.slice(offset, offset + pageSize), page, totalPages, offset, totalItems };
}
