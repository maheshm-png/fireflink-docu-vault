"use client";

import { useEffect, useRef, useState } from "react";
import { Download, ChevronDown } from "lucide-react";

const EXT_LABEL: Record<string, string> = {
  ppt: ".ppt/.pptx",
  doc: ".doc/.docx",
  excel: ".xls/.xlsx",
};

const CTA_CLASSES =
  "rounded-ff bg-ff-accent-gradient px-4 py-2 text-sm font-medium text-white shadow-ff transition-all hover:shadow-ff-md hover:brightness-105";
const ICON_CLASSES = "rounded p-1.5 text-ff-textMuted transition-colors hover:bg-ff-lavender hover:text-ff-accent";
const LINK_CLASSES = "text-ff-accent hover:underline";

/**
 * Quick-download control. When a LibreOffice PDF conversion exists for this
 * version (hasPreviewPdf), offers a choice — PDF or the original format —
 * instead of silently picking one, since which is more useful (universally
 * viewable vs. the real editable file) depends on what the downloader
 * actually wants it for. With no PDF alternative, it's just a single
 * download action, same as before.
 *
 * `variant`: "icon" (default, compact — dashboard list/grid rows) or "cta"
 * (the document detail page's full-width "Download Current Version" button).
 * `asButton` renders as a <button> that opens a new tab via window.open
 * instead of <a href> — required wherever this sits inside an already-
 * clickable <Link> card (DocumentGrid), since a nested <a> inside an <a> is
 * invalid HTML.
 */
export default function DownloadMenu({
  documentId,
  version,
  hasPreviewPdf,
  docType,
  asButton = false,
  variant = "icon",
}: {
  documentId: string;
  version?: number;
  hasPreviewPdf?: boolean;
  docType: string;
  asButton?: boolean;
  variant?: "icon" | "cta" | "link";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const versionQuery = version ? `version=${version}` : "";
  const buildUrl = (format: "pdf" | "original") => {
    const params = [versionQuery, `format=${format}`].filter(Boolean).join("&");
    return `/api/documents/${documentId}/download?${params}`;
  };
  const plainUrl = version ? `/api/documents/${documentId}/download?version=${version}` : `/api/documents/${documentId}/download`;

  function go(url: string) {
    setOpen(false);
    if (asButton) window.open(url, "_blank");
    else window.location.href = url;
  }

  const triggerClasses =
    variant === "cta" ? CTA_CLASSES : variant === "link" ? LINK_CLASSES : ICON_CLASSES;
  const triggerLabel =
    variant === "cta" ? "Download Current Version" : variant === "link" ? "Download" : undefined;

  if (!hasPreviewPdf) {
    return asButton ? (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          window.open(plainUrl, "_blank");
        }}
        title={triggerLabel ?? "Download"}
        aria-label={triggerLabel ?? "Download"}
        className={triggerClasses}
      >
        {triggerLabel ?? <Download className="h-4 w-4" aria-hidden />}
      </button>
    ) : (
      <a href={plainUrl} title={triggerLabel ?? "Download"} aria-label={triggerLabel ?? "Download"} className={triggerClasses}>
        {triggerLabel ?? <Download className="h-4 w-4" aria-hidden />}
      </a>
    );
  }

  const originalLabel = `Download Original${EXT_LABEL[docType] ? ` (${EXT_LABEL[docType]})` : ""}`;

  return (
    <div className={variant === "link" ? "relative inline-block" : "relative"} ref={ref}>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        title="Download options"
        aria-label="Download options"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex items-center gap-0.5 ${triggerClasses}`}
      >
        {triggerLabel ?? <Download className="h-4 w-4" aria-hidden />}
        <ChevronDown className={variant === "icon" ? "h-3 w-3" : "h-3.5 w-3.5"} aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-ff border border-ff-border bg-white py-1 shadow-ff-md"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => go(buildUrl("pdf"))}
            className="block w-full px-3 py-2 text-left text-sm text-ff-text hover:bg-ff-lavender"
          >
            Download as PDF
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => go(buildUrl("original"))}
            className="block w-full px-3 py-2 text-left text-sm text-ff-text hover:bg-ff-lavender"
          >
            {originalLabel}
          </button>
        </div>
      )}
    </div>
  );
}
