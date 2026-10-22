"use client";

import { Plus } from "lucide-react";
import { useSearchParams } from "next/navigation";
import ViewToggle from "./ViewToggle";

// Toolbar row above a document listing: the filter builder (passed in as
// children, see components/DocumentFilters.tsx) on the left, view toggle
// and upload on the right. Upload only shows where the viewer may upload to
// the place being looked at; uploadHref pre-fills that place (Everyone, or a
// team and folder) on the upload form, uploadLabel says where it goes.
export default function FilterBar({
  canUpload,
  showViewToggle = false,
  basePath = "/dashboard",
  uploadHref: uploadHrefProp,
  uploadLabel = "Upload Document",
  children,
}: {
  canUpload: boolean;
  showViewToggle?: boolean;
  basePath?: string;
  uploadHref?: string;
  uploadLabel?: string;
  children?: React.ReactNode;
}) {
  const params = useSearchParams();
  const activeCategory = params.get("category");
  const uploadHref =
    uploadHrefProp ?? (activeCategory ? `/dashboard/upload?category=${activeCategory}` : "/dashboard/upload");

  return (
    <div className="mb-4 flex flex-wrap items-start gap-3">
      {children ?? <div className="flex-1" />}

      {showViewToggle && <ViewToggle basePath={basePath} />}

      {canUpload && (
        <a
          href={uploadHref}
          className="flex h-9 items-center gap-1 rounded-full bg-ff-accent-gradient px-4 text-sm font-medium text-white shadow-ff transition-all hover:shadow-ff-md hover:brightness-105"
        >
          <Plus className="h-4 w-4" aria-hidden />
          {uploadLabel}
        </a>
      )}
    </div>
  );
}
