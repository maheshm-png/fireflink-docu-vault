"use client";

import { List, LayoutGrid } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

// List/Grid switch shared by every document-listing page (Published
// Documents already had its own copy inside FilterBar.tsx — this is that
// same control, reusable anywhere a page renders DocumentTable/DocumentGrid
// off the same rows, so tile view isn't only available on one page.
export default function ViewToggle({ basePath }: { basePath: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const view = params.get("view") ?? "list";

  function setView(next: string) {
    const query = new URLSearchParams(params.toString());
    if (next === "list") query.delete("view");
    else query.set("view", next);
    const qs = query.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath);
  }

  return (
    <div className="flex shrink-0 items-center overflow-hidden rounded-ff border border-ff-border bg-white">
      <button
        type="button"
        onClick={() => setView("list")}
        aria-label="List view"
        aria-pressed={view === "list"}
        className={`p-2 transition-colors ${view === "list" ? "bg-ff-lavender text-ff-accent" : "text-ff-textMuted hover:text-ff-text"}`}
      >
        <List className="h-4 w-4" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => setView("grid")}
        aria-label="Grid view"
        aria-pressed={view === "grid"}
        className={`p-2 transition-colors ${view === "grid" ? "bg-ff-lavender text-ff-accent" : "text-ff-textMuted hover:text-ff-text"}`}
      >
        <LayoutGrid className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
