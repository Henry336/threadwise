export const FILE_COURIER_PAGE_SIZE = 8;
export const FILE_COURIER_RESULT_LIMIT = 100;

export function fileCourierPage<T>(results: readonly T[], requestedPage = 0): {
  items: readonly T[];
  page: number;
  pageCount: number;
  startIndex: number;
} {
  const pageCount = Math.max(1, Math.ceil(results.length / FILE_COURIER_PAGE_SIZE));
  const numericPage = Number.isSafeInteger(requestedPage) ? requestedPage : 0;
  const page = Math.max(0, Math.min(numericPage, pageCount - 1));
  const startIndex = page * FILE_COURIER_PAGE_SIZE;
  return {
    items: results.slice(startIndex, startIndex + FILE_COURIER_PAGE_SIZE),
    page,
    pageCount,
    startIndex
  };
}
