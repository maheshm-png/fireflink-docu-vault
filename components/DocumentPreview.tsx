"use client";

import { useEffect, useState } from "react";
import { X, Eye, Maximize2, Minimize2 } from "lucide-react";
import PptxSlideViewer from "./PptxSlideViewer";
import SpreadsheetViewer from "./SpreadsheetViewer";
import { toEmbeddableUrl } from "@/lib/externalUrl";

export default function DocumentPreview({
  documentId,
  docType,
  version,
  extractedText,
  hasPreviewPdf = false,
  externalUrl,
  label = "Preview",
  variant = "button",
}: {
  documentId: string;
  docType: string;
  version?: number;
  extractedText?: string | null;
  /** True when a LibreOffice-converted PDF exists for this version (see
   * lib/officeConvert.ts) — renders through the accurate PDF viewer instead
   * of the lighter-weight PPT/Excel approximations below. */
  hasPreviewPdf?: boolean;
  /** For docType "link" — an externally-hosted URL to iframe directly
   * instead of resolving anything from our own storage. */
  externalUrl?: string | null;
  label?: string;
  /** "button" for the main pill-style trigger, "link" for an inline text link
   * (e.g. a version-history row), "icon" for a compact row-level quick action. */
  variant?: "button" | "link" | "icon";
}) {
  const [open, setOpen] = useState(false);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Full-screen state shouldn't persist to the next time this doc is opened.
  useEffect(() => {
    if (!open) setMaximized(false);
  }, [open]);

  const previewUrl = `/api/documents/${documentId}/preview${version ? `?version=${version}` : ""}`;

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        title={variant === "icon" ? label : undefined}
        aria-label={variant === "icon" ? label : undefined}
        className={
          variant === "button"
            ? "flex items-center gap-1.5 rounded-ff border border-ff-border bg-white px-4 py-2 text-sm text-ff-text transition-colors hover:bg-ff-lavender"
            : variant === "icon"
            ? "rounded p-1.5 text-ff-textMuted transition-colors hover:bg-ff-lavender hover:text-ff-accent"
            : "text-ff-accent hover:underline"
        }
      >
        {variant === "button" && <Eye className="h-4 w-4" aria-hidden />}
        {variant === "icon" ? <Eye className="h-4 w-4" aria-hidden /> : label}
      </button>

      {open && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 ${maximized ? "p-0" : "p-4"}`}
          onClick={() => setOpen(false)}
        >
          <div
            className={`flex w-full flex-col bg-white shadow-ff transition-all ${
              maximized ? "h-screen max-w-none rounded-none" : "max-h-[90vh] max-w-4xl rounded-ff"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-ff-border px-4 py-3">
              <h2 className="text-base font-bold text-ff-text">Preview</h2>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setMaximized((m) => !m)}
                  aria-label={maximized ? "Exit full screen" : "Full screen"}
                  title={maximized ? "Exit full screen" : "Full screen"}
                  className="rounded p-1 text-ff-textMuted transition-colors hover:bg-ff-lavender hover:text-ff-text"
                >
                  {maximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close preview"
                  className="rounded p-1 text-ff-textMuted transition-colors hover:bg-ff-lavender hover:text-ff-text"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto">
              {externalUrl ? (
                <iframe
                  src={toEmbeddableUrl(externalUrl)}
                  className={maximized ? "h-full w-full" : "h-[75vh] w-full"}
                  title="Document preview"
                />
              ) : docType === "pdf" || hasPreviewPdf ? (
                <iframe src={previewUrl} className={maximized ? "h-full w-full" : "h-[75vh] w-full"} title="Document preview" />
              ) : docType === "video" ? (
                <video controls className={`w-full bg-black ${maximized ? "h-full" : "max-h-[75vh]"}`} src={previewUrl} />
              ) : docType === "ppt" ? (
                <PptxSlideViewer documentId={documentId} version={version} />
              ) : docType === "excel" ? (
                <SpreadsheetViewer documentId={documentId} version={version} />
              ) : extractedText ? (
                <div className="p-4">
                  <p className="mb-3 text-xs text-ff-textMuted">
                    This file type can&apos;t be rendered inline — showing its extracted text content instead.
                  </p>
                  <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap rounded-ff border border-ff-border bg-ff-lavender/40 p-3 text-sm text-ff-text">
                    {extractedText}
                  </pre>
                </div>
              ) : (
                <div className="p-10 text-center text-sm text-ff-textMuted">
                  No preview available for this file type — download it to view the content.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
