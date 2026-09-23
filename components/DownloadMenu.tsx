"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
 *
 * The dropdown menu itself is rendered into a portal (document.body),
 * positioned by the trigger's own on-screen coordinates rather than CSS
 * `position: absolute` relative to a normal ancestor — this control is used
 * inside the Version History table, whose wrapper needs `overflow-hidden`
 * for its rounded corners, which would otherwise silently clip the menu
 * (cutting off or fully hiding "Download as PDF"/"Download Original")
 * whenever it opened near that container's edge.
 */
export default function DownloadMenu({
  documentId,
  version,
  hasPreviewPdf,
  docType,
  asButton = false,
  variant = "icon",
  versions,
  currentVersionNumber,
}: {
  documentId: string;
  version?: number;
  hasPreviewPdf?: boolean;
  docType: string;
  asButton?: boolean;
  variant?: "icon" | "cta" | "link";
  // When there's more than one version and the viewer is allowed to reach
  // any of them (see app/dashboard/documents/[id]/page.tsx — omitted
  // entirely for the base "user" role, who's restricted to the current
  // version only, same restriction the download route itself enforces),
  // the menu groups its format choices under each version instead of just
  // offering PDF/Original for whichever single `version` was passed.
  versions?: { versionNumber: number; label: string; hasPreviewPdf: boolean }[];
  currentVersionNumber?: number;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const MENU_WIDTH = versions && versions.length > 1 ? 224 : 192; // w-56 : w-48

  function openMenu() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Right-align to the trigger by default (matches the old CSS
    // `right-0`), flipping to left-align if that would run off the left
    // edge of the viewport (a narrow icon-variant trigger near screen
    // edge, say).
    let left = rect.right - MENU_WIDTH;
    if (left < 8) left = rect.left;
    setMenuPos({ top: rect.bottom + 4, left });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    // Closes on scroll/resize rather than trying to keep the portaled
    // menu's position in sync with whatever ancestor just scrolled —
    // simplest correct behavior, same tradeoff made elsewhere in this app
    // for similar viewport-anchored popovers.
    function onScrollOrResize() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  const buildUrl = (format: "pdf" | "original", forVersion?: number) => {
    const v = forVersion ?? version;
    const params = [v ? `version=${v}` : "", `format=${format}`].filter(Boolean).join("&");
    return `/api/documents/${documentId}/download?${params}`;
  };
  const plainUrl = version ? `/api/documents/${documentId}/download?version=${version}` : `/api/documents/${documentId}/download`;
  const hasMultiVersion = Boolean(versions && versions.length > 1);

  function go(url: string) {
    setOpen(false);
    if (asButton) window.open(url, "_blank");
    else window.location.href = url;
  }

  const triggerClasses =
    variant === "cta" ? CTA_CLASSES : variant === "link" ? LINK_CLASSES : ICON_CLASSES;
  const triggerLabel =
    variant === "cta" ? "Download Current Version" : variant === "link" ? "Download" : undefined;

  if (!hasPreviewPdf && !hasMultiVersion) {
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
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (open) setOpen(false);
          else openMenu();
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
      {open &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            onClick={(e) => e.stopPropagation()}
            className={`fixed z-50 overflow-hidden rounded-ff border border-ff-border bg-white py-1 shadow-ff-md ${
              hasMultiVersion ? "w-56 max-h-80 overflow-y-auto" : "w-48"
            }`}
            style={{ top: menuPos.top, left: menuPos.left }}
          >
            {hasMultiVersion ? (
              [...versions!]
                .sort((a, b) => b.versionNumber - a.versionNumber)
                .map((v, i) => (
                  <div key={v.versionNumber} className={i > 0 ? "mt-1 border-t border-ff-border pt-1" : ""}>
                    <p className="px-3 py-1 text-xs font-semibold text-ff-textMuted">
                      {v.label}
                      {v.versionNumber === currentVersionNumber && (
                        <span className="ml-1 font-normal text-ff-success">(current)</span>
                      )}
                    </p>
                    {v.hasPreviewPdf && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => go(buildUrl("pdf", v.versionNumber))}
                        className="block w-full px-3 py-1.5 text-left text-sm text-ff-text hover:bg-ff-lavender"
                      >
                        Download as PDF
                      </button>
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => go(buildUrl("original", v.versionNumber))}
                      className="block w-full px-3 py-1.5 text-left text-sm text-ff-text hover:bg-ff-lavender"
                    >
                      {v.hasPreviewPdf ? originalLabel : "Download"}
                    </button>
                  </div>
                ))
            ) : (
              <>
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
              </>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
