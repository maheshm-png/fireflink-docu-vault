// Shared by components/Pagination.tsx (client) and the pages that paginate
// on the server, kept out of the "use client" file so server code can use it.
export const PAGE_SIZES = [5, 10, 20, 50, 100];
export const DEFAULT_PAGE_SIZE = 20;
export const PAGE_SIZE_COOKIE = "docsPerPage";

/** Page size from ?per=, else the remembered cookie, else the default;
 * never below 5 or above the largest option. */
export function resolvePageSize(param: string | undefined, cookie: string | undefined): number {
  const n = Number(param || cookie || DEFAULT_PAGE_SIZE);
  if (!Number.isFinite(n)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(Math.round(n), PAGE_SIZES[0]), PAGE_SIZES[PAGE_SIZES.length - 1]);
}

/** Clamps ?page= into the range that exists for this many rows. */
export function resolvePage(param: string | undefined, total: number, perPage: number): number {
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const n = Math.floor(Number(param) || 1);
  return Math.min(Math.max(n, 1), pageCount);
}
