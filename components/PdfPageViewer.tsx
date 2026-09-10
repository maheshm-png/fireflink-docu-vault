"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import BrandedLoader from "./BrandedLoader";

/**
 * Read-only PDF page rendering (canvas only, via pdf.js — no text layer,
 * no selection, no highlighting, no controls of any kind) for
 * app/dashboard/documents/[id]/VersionCompareFrame.tsx, which used to
 * embed the browser's native PDF viewer (an <iframe> to app/api/documents/
 * [id]/preview) — that viewer's own toolbar bundles zoom together with
 * download/print/more-options with no way to keep one and drop the rest,
 * and its own internal scrollbar reads as a second, nested scroll area
 * inside the already-scrollable page. Rendering pages ourselves sidesteps
 * both: there's no native chrome at all, and (outside fillHeight) no
 * height cap either — the document renders at its natural fit-to-width
 * size and scrolls with the page like any other content.
 *
 * Deliberately not merged into components/PdfHighlightViewer.tsx — that
 * component's text layer, highlighting, and comment UI are irrelevant
 * weight here, and this component's total lack of controls would be the
 * wrong default for that component's other (interactive) usages.
 */
export default function PdfPageViewer({
  documentId,
  version,
  fillHeight = false,
}: {
  documentId: string;
  version?: number;
  // Fills and internally scrolls within the parent's available height —
  // only meaningful when an ancestor actually constrains that height (the
  // fullscreen mode of app/dashboard/documents/[id]/VersionCompareFrame.tsx,
  // which exits normal page flow entirely). Outside that, the default
  // (false) lets the document render at its natural height and scroll with
  // the page itself, rather than being boxed into its own scroll region.
  fillHeight?: boolean;
}) {
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [pageCount, setPageCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<HTMLDivElement[]>([]);
  const renderGenRef = useRef(0);

  async function waitForContainer(index: number, myGen: number): Promise<HTMLDivElement | null> {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (renderGenRef.current !== myGen) return null;
      const el = pageRefs.current[index];
      if (el) return el;
      await new Promise((r) => requestAnimationFrame(r));
    }
    return pageRefs.current[index] ?? null;
  }

  async function renderPages(pdfDoc: PDFDocumentProxy, myGen: number) {
    setReady(false);

    // Fit to the container's own width, same 0-is-not-usable guard as
    // components/PdfHighlightViewer.tsx (a clientWidth read before layout
    // settles is legitimately 0, not just null/undefined).
    const measuredWidth = containerRef.current?.clientWidth || 0;
    const targetWidth = measuredWidth > 100 ? Math.min(measuredWidth, 1000) : 760;

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      if (renderGenRef.current !== myGen) return;
      const container = await waitForContainer(pageNum - 1, myGen);
      if (!container || renderGenRef.current !== myGen) continue;

      const page: PDFPageProxy = await pdfDoc.getPage(pageNum);
      const unscaledViewport = page.getViewport({ scale: 1 });
      const scale = targetWidth / unscaledViewport.width;
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      await page.render({ canvasContext: ctx, viewport }).promise;
      if (renderGenRef.current !== myGen) return;

      container.style.width = `${viewport.width}px`;
      container.style.height = `${viewport.height}px`;
      container.innerHTML = "";
      container.appendChild(canvas);
    }

    if (renderGenRef.current !== myGen) return;
    setReady(true);
  }

  useEffect(() => {
    let localCancelled = false;
    const fetchUrl = `/api/documents/${documentId}/preview${version ? `?version=${version}` : ""}${
      version ? "&" : "?"
    }raw=1`;

    async function load() {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.js";

        const pdfDoc = await pdfjsLib.getDocument({ url: fetchUrl }).promise;
        if (localCancelled) return;

        setPageCount(pdfDoc.numPages);

        const myGen = ++renderGenRef.current;
        await renderPages(pdfDoc, myGen);
      } catch (err) {
        console.error("PdfPageViewer failed to render:", err);
        if (!localCancelled) setLoadError("Could not load this document for preview.");
      }
    }

    load();
    return () => {
      localCancelled = true;
      renderGenRef.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, version]);

  if (loadError) {
    return <p className="p-6 text-center text-sm text-ff-textMuted">{loadError}</p>;
  }

  return (
    <div
      ref={containerRef}
      className={`rounded-ff border border-ff-border bg-ff-lavender/20 p-3 ${
        fillHeight ? "min-h-0 flex-1 overflow-auto" : ""
      }`}
    >
      {!ready && (
        <div className="flex h-64 items-center justify-center">
          <BrandedLoader size={28} label="Loading document..." />
        </div>
      )}
      <div className={ready ? "flex flex-col items-center gap-3" : "hidden"}>
        {Array.from({ length: pageCount }).map((_, i) => (
          <div
            key={i}
            ref={(el) => {
              if (el) pageRefs.current[i] = el;
            }}
            className="bg-white shadow-ff"
          />
        ))}
      </div>
    </div>
  );
}
