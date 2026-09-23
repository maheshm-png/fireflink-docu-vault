"use client";

import { useState } from "react";
import { GitCompareArrows, ChevronDown, ChevronUp, FileCheck2, Clock } from "lucide-react";
import DownloadMenu from "@/components/DownloadMenu";
import VersionDiff from "./VersionDiff";
import VersionCompareFrame from "./VersionCompareFrame";

type VersionInfo = { versionNumber: number; label: string; previewPdfPath: string | null; extractedText: string | null };

/**
 * Replaces the old plain "For reference: Current (vX): Download  New (vY):
 * Download" text line in the Review tab — same information (which version
 * is still the actual published one vs. the new one awaiting this
 * decision), but as labeled cards instead of an inline sentence, plus a
 * "Compare Versions" toggle so a reviewer can look at both side by side
 * without leaving this tab for the separate Versions tab (which has the
 * same compare feature, just further from where a decision actually gets
 * made).
 */
export default function ReviewVersionReference({
  documentId,
  docType,
  publishedVersion,
  pendingVersion,
  pendingDownloadable,
  compareVersions,
}: {
  documentId: string;
  docType: string;
  // Null when this document has never actually been published (e.g. its
  // only round so far was rejected) — see page.tsx's hasEverPublished.
  publishedVersion: VersionInfo | null;
  pendingVersion: VersionInfo;
  // The base "user" role can only ever download the current version — a
  // still-pending one isn't downloadable to them until it's actually
  // published (see app/api/documents/[id]/download/route.ts).
  pendingDownloadable: boolean;
  // Every version worth comparing — omitted (no toggle shown) when there's
  // only one.
  compareVersions: { versionNumber: number; label: string; hasPreviewPdf: boolean; extractedText: string }[];
}) {
  const [comparing, setComparing] = useState(false);

  return (
    <div className="overflow-hidden rounded-ff border border-ff-border bg-white shadow-ff">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ff-border px-4 py-3">
        <div>
          <h3 className="text-sm font-bold text-ff-text">Version Reference</h3>
          <p className="text-xs text-ff-textMuted">The published version, alongside the one awaiting this decision.</p>
        </div>
        {compareVersions.length > 1 && (
          <button
            type="button"
            onClick={() => setComparing((v) => !v)}
            aria-expanded={comparing}
            className={`flex shrink-0 items-center gap-1.5 rounded-ff border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
              comparing
                ? "border-ff-accent bg-ff-accent/10 text-ff-accent"
                : "border-ff-border text-ff-text hover:border-ff-accent/40 hover:text-ff-accent"
            }`}
          >
            <GitCompareArrows className="h-3.5 w-3.5" aria-hidden />
            Compare Versions
            {comparing ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 divide-y divide-ff-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        {publishedVersion && (
          <div className="flex items-start gap-3 p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ff bg-ff-success/10 text-ff-success">
              <FileCheck2 className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ff-success">Published</p>
              <p className="text-sm font-semibold text-ff-text">{publishedVersion.label}</p>
              <div className="mt-1.5">
                <DownloadMenu
                  documentId={documentId}
                  version={publishedVersion.versionNumber}
                  hasPreviewPdf={Boolean(publishedVersion.previewPdfPath)}
                  docType={docType}
                  variant="link"
                />
              </div>
            </div>
          </div>
        )}
        <div className="flex items-start gap-3 p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ff bg-ff-warning/10 text-ff-warning">
            <Clock className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ff-warning">Pending Review</p>
            <p className="text-sm font-semibold text-ff-text">{pendingVersion.label}</p>
            <div className="mt-1.5">
              {pendingDownloadable ? (
                <DownloadMenu
                  documentId={documentId}
                  version={pendingVersion.versionNumber}
                  hasPreviewPdf={Boolean(pendingVersion.previewPdfPath)}
                  docType={docType}
                  variant="link"
                />
              ) : (
                <p className="text-xs text-ff-textMuted">Available for download once approved.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {comparing &&
        (docType === "video" || docType === "link" || docType === "other" ? (
          <div className="border-t border-ff-border p-4">
            <VersionDiff
              documentId={documentId}
              versions={compareVersions.map((v) => ({ versionNumber: v.versionNumber, label: v.label, extractedText: v.extractedText }))}
            />
          </div>
        ) : (
          <div className="border-t border-ff-border p-4">
            <VersionCompareFrame
              documentId={documentId}
              docType={docType}
              versions={compareVersions.map((v) => ({ versionNumber: v.versionNumber, label: v.label, hasPreviewPdf: v.hasPreviewPdf }))}
            />
          </div>
        ))}
    </div>
  );
}
