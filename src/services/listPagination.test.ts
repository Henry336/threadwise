import { describe, expect, it } from "vitest";
import { paginateList } from "./listPagination";

describe("active list pagination", () => {
  it("returns ten rows per page and preserves the global offset", () => {
    const page = paginateList(Array.from({ length: 23 }, (_, index) => index + 1), 2);
    expect(page.items).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(page).toMatchObject({ page: 2, totalPages: 3, offset: 10, totalItems: 23 });
  });

  it("clamps stale page requests after a list gets shorter", () => {
    expect(paginateList([1, 2], 9)).toMatchObject({ page: 1, totalPages: 1, offset: 0 });
  });
});
