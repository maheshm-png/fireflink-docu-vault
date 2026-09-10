"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import PdfPageViewer from "@/components/PdfPageViewer";

type VersionMeta = { versionNumber: number; hasPreviewPdf: boolean };

/**
 * Side-by-side "as uploaded" version compare — both versions render through
 * the SAME accurate LibreOffice-converted-PDF preview the single-document
 * view uses (app/api/documents/[id]/preview), via components/
 * PdfPageViewer.tsx's own canvas rendering rather than the browser's native
 * PDF viewer. That switch (from an <iframe>) was deliberate: the native
 * viewer's toolbar bundles zoom together with download/print/more-options
 * with no way to keep one and drop the rest, and its own internal
 * scrollbar reads as a second, nested scroll area inside the already-
 * scrollable page — PdfPageViewer has neither problem, since there's no
 * native chrome and (outside fullscreen) no forced height/scroll region at
 * all, just zoom in/out/reset.
 *
 * Deliberately no automatic diff-highlighting: freeform PDF/Word/Excel/PPT
 * layout doesn't reduce to a reliable line-level or shape-level diff the
 * way plain text does, so this just lets the reviewer look at both
 * side by side, exactly as they'd open each file individually.
 *
 * Fullscreen applies to the WHOLE section (both panels + their v-labels),
 * not to an individual panel — the Fullscreen API only keeps the element
 * you called requestFullscreen() on (and its own descendants) visible, so
 * fullscreening a single panel would hide its sibling panel and label
 * entirely instead of giving a bigger side-by-side view.
 */
export default function VersionCompareFrame({
  documentId,
  docType,
  versions,
}: {
  documentId: string;
  docType: string;
  versions: VersionMeta[];
}) {
  const [fromV, setFromV] = useState(versions[versions.length - 1].versionNumber);
  const [toV, setToV] = useState(versions[0].versionNumber);
  const [fullscreen, setFullscreen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onChange() {
      setFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  function toggleFullscreen() {
    if (!stageRef.current) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else stageRef.current.requestFullscreen().catch(() => {});
  }

  const canPreview = (v: VersionMeta) => docType === "pdf" || v.hasPreviewPdf;
  const fromMeta = versions.find((v) => v.versionNumber === fromV)!;
  const toMeta = versions.find((v) => v.versionNumber === toV)!;

  const noPreviewMsg = (
    <div className="flex h-full flex-col items-center justify-center gap-1 rounded-ff border border-ff-border bg-ff-lavender/20 p-6 text-center text-sm text-ff-textMuted">
      <p>No preview available for this version.</p>
      <p className="text-xs">Download it to compare.</p>
    </div>
  );

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-bold text-ff-text">Compare Versions</h2>
        <button
          type="button"
          onClick={toggleFullscreen}
          title={fullscreen ? "Exit full screen" : "Full screen"}
          aria-label={fullscreen ? "Exit full screen" : "Full screen"}
          className="rounded p-1.5 text-ff-textMuted transition-colors hover:bg-ff-lavender hover:text-ff-text"
        >
          {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      </div>

      <div
        ref={stageRef}
        className={fullscreen ? "flex h-screen flex-col bg-[#1e1e1e] p-3" : ""}
      >
        <div className={`mb-3 flex items-center gap-3 text-sm ${fullscreen ? "shrink-0" : ""}`}>
          <label className={`flex items-center gap-1 ${fullscreen ? "text-white" : ""}`}>
            From
            <select
              value={fromV}
              onChange={(e) => setFromV(parseInt(e.target.value, 10))}
              className="rounded-ff border border-ff-border px-2 py-1 text-ff-text"
            >
              {versions.map((v) => (
                <option key={v.versionNumber} value={v.versionNumber}>v{v.versionNumber}</option>
              ))}
            </select>
          </label>
          <label className={`flex items-center gap-1 ${fullscreen ? "text-white" : ""}`}>
            To
            <select
              value={toV}
              onChange={(e) => setToV(parseInt(e.target.value, 10))}
              className="rounded-ff border border-ff-border px-2 py-1 text-ff-text"
            >
              {versions.map((v) => (
                <option key={v.versionNumber} value={v.versionNumber}>v{v.versionNumber}</option>
              ))}
            </select>
          </label>
        </div>

        <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${fullscreen ? "min-h-0 flex-1" : ""}`}>
          <div className={fullscreen ? "flex h-full min-h-0 flex-col" : ""}>
            <div className={`mb-1 text-xs font-medium ${fullscreen ? "shrink-0 text-white" : "text-ff-textMuted"}`}>
              v{fromV}
            </div>
            {canPreview(fromMeta) ? (
              <PdfPageViewer documentId={documentId} version={fromV} fillHeight={fullscreen} />
            ) : (
              noPreviewMsg
            )}
          </div>
          <div className={fullscreen ? "flex h-full min-h-0 flex-col" : ""}>
            <div className={`mb-1 text-xs font-medium ${fullscreen ? "shrink-0 text-white" : "text-ff-textMuted"}`}>
              v{toV}
            </div>
            {canPreview(toMeta) ? (
              <PdfPageViewer documentId={documentId} version={toV} fillHeight={fullscreen} />
            ) : (
              noPreviewMsg
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
