"use client";

import { Plus } from "lucide-react";
import { useSearchParams } from "next/navigation";
import ViewToggle from "./ViewToggle";

// Toolbar row above a document listing: the filter builder (passed in as
// children, see components/DocumentFilters.tsx) on the left, view toggle
// and upload on the right.
export default function FilterBar({
  canUpload,
  showViewToggle = false,
  basePath = "/dashboard",
  children,
}: {
  canUpload: boolean;
  showViewToggle?: boolean;
  basePath?: string;
  children?: React.ReactNode;
}) {
  const params = useSearchParams();
  const activeCategory = params.get("category");
  const uploadHref = activeCategory ? `/dashboard/upload?category=${activeCategory}` : "/dashboard/upload";

  return (
    <div className="mb-4 flex flex-wrap items-start gap-3">
      {children ?? <div className="flex-1" />}

      {showViewToggle && <ViewToggle basePath={basePath} />}

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
