"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { PAGE_SIZES, PAGE_SIZE_COOKIE } from "@/lib/pagination";

// Page controls under a document listing: "Showing 21-40 of 132", numbered
// pages, and a per-page picker (5 minimum). Everything lives in the query
// string (?page=, ?per=), and the per-page choice is also remembered in a
// cookie so it sticks on the next visit (read by the page on the server).
export default function Pagination({ page, perPage, total }: { page: number; perPage: number; total: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const pageCount = Math.max(1, Math.ceil(total / perPage));

  function go(nextPage: number, nextPer = perPage) {
    const query = new URLSearchParams(params.toString());
    if (nextPage > 1) query.set("page", String(nextPage));
    else query.delete("page");
    query.set("per", String(nextPer));
    const qs = query.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function changePerPage(value: number) {
    try {
      document.cookie = `${PAGE_SIZE_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      // Cookies blocked: the choice still applies through the URL.
    }
    go(1, value);
  }

  // Compact page list: first, last, and two either side of the current one.
  const pages: (number | "gap")[] = [];
  for (let p = 1; p <= pageCount; p++) {
    if (p === 1 || p === pageCount || Math.abs(p - page) <= 2) pages.push(p);
    else if (pages[pages.length - 1] !== "gap") pages.push("gap");
  }

  if (total === 0) return null;
  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);
  const btn =
    "flex h-8 min-w-8 items-center justify-center rounded-ff border px-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-ff-textMuted">
      <p>
        Showing <span className="font-medium text-ff-text">{from}-{to}</span> of{" "}
        <span className="font-medium text-ff-text">{total}</span>
      </p>

      {pageCount > 1 && (
        <nav className="flex flex-wrap items-center gap-1" aria-label="Pages">
          <button
            type="button"
            onClick={() => go(page - 1)}
            disabled={page <= 1}
            aria-label="Previous page"
            className={`${btn} border-ff-border bg-white hover:border-ff-accent/40`}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          {pages.map((p, i) =>
            p === "gap" ? (
              <span key={`gap-${i}`} className="px-1">
                ...
              </span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => go(p)}
                aria-current={p === page ? "page" : undefined}
                className={`${btn} ${
                  p === page
                    ? "border-ff-accent bg-ff-accent font-medium text-white"
                    : "border-ff-border bg-white text-ff-text hover:border-ff-accent/40"
                }`}
              >
                {p}
              </button>
            )
          )}
          <button
            type="button"
            onClick={() => go(page + 1)}
            disabled={page >= pageCount}
            aria-label="Next page"
            className={`${btn} border-ff-border bg-white hover:border-ff-accent/40`}
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </nav>
      )}

      <label className="flex items-center gap-2">
        Show
        <select
          value={perPage}
          onChange={(e) => changePerPage(Number(e.target.value))}
          className="rounded-ff border border-ff-border bg-white px-2 py-1 text-sm text-ff-text"
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        per page
      </label>
    </div>
  );
}
