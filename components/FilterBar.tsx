"use client";

import { Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import ViewToggle from "./ViewToggle";

export default function FilterBar({
  canUpload,
  showViewToggle = false,
}: {
  canUpload: boolean;
  showViewToggle?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`/dashboard?${next.toString()}`);
    router.refresh();
  }

  const activeCategory = params.get("category");
  const uploadHref = activeCategory ? `/dashboard/upload?category=${activeCategory}` : "/dashboard/upload";

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <select
        onChange={(e) => updateParam("docType", e.target.value)}
        defaultValue={params.get("docType") ?? ""}
        className="rounded-ff border border-ff-border bg-white px-3 py-2 text-sm transition-colors focus:border-ff-accent focus:outline-none"
        aria-label="Filter by document type"
      >
        <option value="">All Types</option>
        <option value="ppt">PPT</option>
        <option value="video">Video</option>
        <option value="pdf">PDF</option>
        <option value="doc">Doc</option>
        <option value="excel">Excel / CSV</option>
        <option value="link">Link</option>
      </select>

      <select
        onChange={(e) => updateParam("stale", e.target.value)}
        defaultValue={params.get("stale") ?? ""}
        className="rounded-ff border border-ff-border bg-white px-3 py-2 text-sm transition-colors focus:border-ff-accent focus:outline-none"
        aria-label="Filter by staleness"
      >
        <option value="">All</option>
        <option value="true">Flagged Outdated</option>
      </select>

      <div className="flex-1" />

      {showViewToggle && <ViewToggle basePath="/dashboard" />}

      {canUpload && (
        <a
          href={uploadHref}
          className="flex items-center gap-1 rounded-ff bg-ff-accent-gradient px-4 py-2 text-sm font-medium text-white shadow-ff transition-all hover:shadow-ff-md hover:brightness-105"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Upload Document
        </a>
      )}
    </div>
  );
}
