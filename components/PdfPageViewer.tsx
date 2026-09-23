"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, ZoomIn, ZoomOut } from "lucide-react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import BrandedLoader from "./BrandedLoader";

/**
 * Read-only PDF viewing (canvas only, via pdf.js — no text layer, no
 * selection, no highlighting, no controls beyond page navigation + zoom)
 * for app/dashboard/documents/[id]/VersionCompareFrame.tsx, which used to
 * embed the browser's native PDF viewer (an <iframe> to app/api/documents/
 * [id]/preview) — that viewer's own toolbar bundles zoom together with
 * download/print/more-options with no way to keep one and drop the rest,
 * and its own internal scrollbar reads as a second, nested scroll area
 * inside the already-scrollable page.
 *
 * Also used by app/share/[token]/page.tsx for view-only shares (allowFullscreen
 * + fetchUrl + watermark + disableInteraction) — a canvas render never has a
 * real, selectable text layer to begin with (unlike components/
 * PdfHighlightViewer.tsx's text layer, added there specifically to support
 * highlighting), so it's also the one existing renderer that already doesn't
 * hand a viewer copyable text. disableInteraction adds the remaining
 * deterrents (no right-click, no drag/selection) on top of that.
 *
 * Shows exactly one page at a time (Prev/Next + "Page X of Y") in a fixed
 * frame rather than rendering every page stacked and scrolling through
 * them — the same fixed-frame, one-at-a-time interaction
 * components/PptxSlideViewer.tsx already uses for slides, applied here too
 * so comparing two versions side by side isn't also a long vertical scroll.
 *
 * Sizing is computed in JS (recomputeRenderSize), not left to pure CSS —
 * an earlier version tried width:100%+max-height, then max-width/max-height
 * with width/height:auto, then the CSS `zoom` property for the zoom
 * control; all three broke down in some combination of tall portrait pages,
 * fullscreen, and multiple flex layers (see recomputeRenderSize's own
 * comment for specifics of the last failure). Computing an explicit pixel
 * width/height from the wrapper's actual measured box plus the page's own
 * point size sidesteps all of that: the math is the same "fit, then
 * multiply by zoom" a native PDF viewer does, just done once in JS instead
 * of hoping several layers of CSS constraints resolve it correctly.
 *
 * Deliberately not merged into components/PdfHighlightViewer.tsx — that
 * component's text layer, highlighting, and comment UI are irrelevant
 * weight here, and this component's total lack of those would be the wrong
 * default for that component's other (interactive) usages. That viewer
 * keeps its own continuous-scroll layout — highlighting needs every page's
 * text layer available at once to locate a match anywhere in the document,
 * which one-page-at-a-time would work against.
 */
export default function PdfPageViewer({
  documentId,
  version,
  fillHeight = false,
  // Overrides the default authenticated fetch URL below — used by the
  // public share page to point at /api/share/[token]/view?format=pdf
  // instead, the same override pattern components/PptxSlideViewer.tsx
  // already uses for the same reason.
  fetchUrl,
  // Adds this component's own fullscreen toggle (self-contained, like
  // PptxSlideViewer) rather than relying on an external wrapper managing
  // fillHeight — only used by the share page, where nothing else wraps
  // this component in a fullscreen frame.
  allowFullscreen = false,
  // Rendered inside this component's own fullscreen-ref'd wrapper — see
  // components/FullscreenPreviewFrame.tsx's own watermark prop for why it
  // has to live there specifically.
  watermark,
  // Blocks the remaining copy/save paths a canvas render doesn't already
  // close on its own: right-click ("Save image as..."), drag-to-save, and
  // text selection on the surrounding chrome (page counter, etc.). Not
  // real DRM — a determined viewer can still reach the bytes via devtools
  // or screen-capture the page, same limit as any client-side protection
  // (see components/ViewOnlyWatermark.tsx's own comment on this).
  disableInteraction = false,
  // Reports this page's own sampled background color up to the caller —
  // app/dashboard/documents/[id]/VersionCompareFrame.tsx uses it so the
  // shared frame AROUND both side-by-side panels (the gap between them,
  // the "From"/"To" labels' row) can match too, instead of staying a fixed
  // dark neutral no matter what color the actual documents render on.
  onBackgroundColorChange,
}: {
  documentId: string;
  version?: number;
  fillHeight?: boolean;
  fetchUrl?: string;
  allowFullscreen?: boolean;
  watermark?: React.ReactNode;
  disableInteraction?: boolean;
  onBackgroundColorChange?: (color: string) => void;
}) {
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [pageCount, setPageCount] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  // The page's own background — sampled from its rendered corner rather
  // than assumed, since most pages are white but not all (a dark-themed
  // slide export, a colored letterhead). Only actually applied in
  // fullscreen (see the render below) — the normal, inline view keeps the
  // app's own lavender card tint around it, matching every other panel.
  const [bgColor, setBgColor] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  // 1 = fit-to-frame (the default). >1 zooms in — see recomputeRenderSize.
  const [zoom, setZoom] = useState(1);
  const ZOOM_MIN = 1;
  const ZOOM_MAX = 3;
  const ZOOM_STEP = 0.25;
  // The actual on-screen canvas size in CSS px, computed by
  // recomputeRenderSize — the canvas's style.width/height is set directly
  // from this rather than from any CSS percentage/max-* expression.
  const [renderSize, setRenderSize] = useState<{ width: number; height: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // The bounded, scrollable box the canvas sits in — its measured
  // clientWidth/clientHeight are the "frame" recomputeRenderSize fits (and
  // then zooms) the page into. Kept separate from containerRef (which just
  // holds this box plus the page-nav/zoom bar below it) specifically so
  // its size reflects only the space actually available to the page image.
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const renderGenRef = useRef(0);
  // The current page's own size in PDF points (pdf.js's getViewport({scale:1})),
  // i.e. independent of the fixed scale:2 the bitmap itself is rendered at
  // below — this is the "how big is the page, really" figure
  // recomputeRenderSize fits against.
  const pageNaturalSizeRef = useRef<{ width: number; height: number } | null>(null);
  // Mirrors `zoom` for the ResizeObserver callback below, which needs the
  // latest value without resubscribing the observer on every zoom change.
  const zoomRef = useRef(1);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // Tracks fullscreen via the browser's own change event (not just our
  // toggle button) so Esc still updates the button's icon correctly — only
  // wired up when this component owns its own toggle at all.
  useEffect(() => {
    if (!allowFullscreen) return;
    function onFullscreenChange() {
      setFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, [allowFullscreen]);

  function toggleFullscreen() {
    if (!stageRef.current) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else stageRef.current.requestFullscreen().catch(() => {});
  }

  // Self-managed fullscreen fills the available space the same way an
  // externally-driven fillHeight does — both mean "no natural-width card,
  // fit the box you're given."
  const activeFillHeight = fillHeight || (allowFullscreen && fullscreen);

  // Fits pageNaturalSizeRef into canvasWrapperRef's CURRENT measured box,
  // then multiplies by z — the same "fit, then zoom" math a native PDF
  // viewer's zoom control does. Called from three places: whenever the
  // wrapper's own box actually resizes (the ResizeObserver effect below —
  // covers fullscreen toggling, window resize, and this element's own
  // "hidden" -> visible transition once the page has loaded), whenever a
  // new page's natural size becomes known (after renderPage), and whenever
  // the user changes zoom directly. Deliberately NOT done via CSS
  // (width:100%+max-height, then max-width/max-height+auto, then the CSS
  // `zoom` property were all tried first) — each broke in a different way
  // once enough flex-layer/percentage-height/non-standard-property
  // interactions stacked up; `zoom` specifically let the canvas's layout
  // box grow past its own max-height once zoom > 1, which grew the whole
  // flex column around it and pushed the page-nav/zoom controls below it
  // off-screen with nothing to scroll to reach them. Plain pixel math has
  // none of those interactions to go wrong.
  function recomputeRenderSize(z: number) {
    const wrapper = canvasWrapperRef.current;
    const natural = pageNaturalSizeRef.current;
    if (!wrapper || !natural) return;
    const availW = wrapper.clientWidth;
    const availH = wrapper.clientHeight;
    if (availW < 2 || availH < 2) return;
    const fitScale = Math.min(availW / natural.width, availH / natural.height);
    setRenderSize({ width: natural.width * fitScale * z, height: natural.height * fitScale * z });
  }

  // Fires for every actual size change of the wrapper box: this element's
  // own "hidden" (display:none, 0x0) -> visible transition once the first
  // page has rendered, entering/exiting fullscreen, the browser window
  // resizing, or (for VersionCompareFrame's side-by-side usage) its grid
  // layout changing width. Using zoomRef rather than `zoom` directly keeps
  // this subscribed once for the component's lifetime instead of tearing
  // down and recreating the observer on every zoom click.
  useEffect(() => {
    const wrapper = canvasWrapperRef.current;
    if (!wrapper) return;
    const ro = new ResizeObserver(() => recomputeRenderSize(zoomRef.current));
    ro.observe(wrapper);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The user's own zoom in/out/reset clicks — the wrapper's box doesn't
  // change size here, so the ResizeObserver above won't fire on its own.
  useEffect(() => {
    if (!ready) return;
    recomputeRenderSize(zoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, ready]);

  async function renderPage(pdfDoc: PDFDocumentProxy, index: number, myGen: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const page: PDFPageProxy = await pdfDoc.getPage(index + 1);
    if (renderGenRef.current !== myGen) return;
    // Rendered at a fixed, generous internal resolution regardless of
    // display size — display size (computed above) can go up to
    // ZOOM_MAX x the fit size, so this needs enough headroom to still look
    // sharp at max zoom rather than just at the fit size.
    const viewport = page.getViewport({ scale: 2 });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    await page.render({ canvasContext: ctx, viewport }).promise;
    if (renderGenRef.current !== myGen) return;
    // The page's real (1x) size in points — what recomputeRenderSize fits
    // against, independent of the scale:2 bitmap resolution above.
    const naturalViewport = page.getViewport({ scale: 1 });
    pageNaturalSizeRef.current = { width: naturalViewport.width, height: naturalViewport.height };
    // Sample the page's own top-left corner — its margin is almost always
    // a uniform color, so one pixel is enough to read "the page's
    // background" without scanning the whole render.
    try {
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      const sampled = `rgb(${r}, ${g}, ${b})`;
      setBgColor(sampled);
      onBackgroundColorChange?.(sampled);
    } catch {
      // Rare (a canvas the browser considers tainted) — falls back to the
      // fixed neutral already used below when bgColor stays null.
    }
  }

  // Loads the document once per documentId/version, independent of which
  // page is currently showing.
  useEffect(() => {
    let localCancelled = false;
    setPageIndex(0);
    setZoom(1);
    setReady(false);
    setRenderSize(null);
    setLoadError(null);
    const url =
      fetchUrl ?? `/api/documents/${documentId}/preview${version ? `?version=${version}` : ""}${
        version ? "&" : "?"
      }raw=1`;

    async function load() {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.js";
        const pdfDoc = await pdfjsLib.getDocument({ url }).promise;
        if (localCancelled) return;
        pdfDocRef.current = pdfDoc;
        setPageCount(pdfDoc.numPages);
        const myGen = ++renderGenRef.current;
        await renderPage(pdfDoc, 0, myGen);
        if (localCancelled) return;
        // The wrapper is still "hidden" (0x0) at this exact instant — its
        // upcoming hidden -> visible transition (once `ready` below commits)
        // is itself a resize the ResizeObserver above will catch and fit
        // correctly, so there's no matching recomputeRenderSize call needed
        // right here.
        setReady(true);
      } catch (err) {
        console.error("PdfPageViewer failed to render:", err);
        if (!localCancelled) setLoadError("Could not load this document for preview.");
      }
    }

    load();
    return () => {
      localCancelled = true;
      renderGenRef.current++;
      pdfDocRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, version, fetchUrl]);

  // Re-renders just the current page whenever it changes, reusing the
  // already-loaded document rather than reloading it. The wrapper's own box
  // doesn't change size on a page turn, so (unlike the initial load above)
  // this does need its own recompute — a new page can have different point
  // dimensions than the last one, and the ResizeObserver has nothing to
  // fire on here since nothing actually resized. Zoom is deliberately left
  // alone here (was reset to 1 on every page turn before) — it should hold
  // at whatever level the reader set it to until they change it themselves,
  // not silently snap back to fit every time they turn a page. The SCROLL
  // position within that zoom does reset, though — landing mid-way down a
  // brand new page (wherever the last page happened to be scrolled to) is
  // disorienting in a way holding the zoom level itself isn't.
  useEffect(() => {
    const pdfDoc = pdfDocRef.current;
    if (!pdfDoc || !ready) return;
    const myGen = ++renderGenRef.current;
    renderPage(pdfDoc, pageIndex, myGen).then(() => {
      if (renderGenRef.current !== myGen) return;
      recomputeRenderSize(zoomRef.current);
      const wrapper = canvasWrapperRef.current;
      if (wrapper) {
        wrapper.scrollTop = 0;
        wrapper.scrollLeft = 0;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIndex]);

  // Fullscreen toggling is the one case that DOES reset zoom — most
  // visibly on Esc (exiting fullscreen): the zoom level that made sense
  // filling the whole screen is usually wrong once the frame shrinks back
  // down to its normal inline size, so this snaps back to fit rather than
  // carrying it over. The wrapper's box size change itself is picked up by
  // the ResizeObserver above on its own. Depends on `fillHeight` too, not
  // just this component's own `fullscreen` state — the compare view
  // (VersionCompareFrame.tsx) drives fullscreen externally by toggling
  // `fillHeight` instead of using this component's own allowFullscreen
  // button, so `fullscreen` alone never changes there and Esc wouldn't
  // otherwise reset anything for those panels.
  useEffect(() => {
    setZoom(1);
  }, [fullscreen, fillHeight]);

  if (loadError) {
    return <p className="p-6 text-center text-sm text-ff-textMuted">{loadError}</p>;
  }

  const content = (
    <div
      ref={containerRef}
      onContextMenu={disableInteraction ? (e) => e.preventDefault() : undefined}
      // w-full matters specifically inside the self-managed fullscreen
      // stage below (a flex-col + items-center container) — without it,
      // this item would shrink-wrap to its own content's width instead of
      // filling the stage, which is exactly backwards for something whose
      // own content (canvasWrapperRef, w-full) expects to be measured
      // against a real, already-resolved width.
      className={`flex w-full flex-col items-center gap-2 rounded-ff border border-ff-border p-3 ${
        activeFillHeight ? "min-h-0 flex-1" : "bg-ff-lavender/20"
      } ${disableInteraction ? "select-none" : ""}`}
      style={activeFillHeight ? { backgroundColor: bgColor ?? "#1e1e1e" } : undefined}
    >
      {!ready && (
        <div className="flex h-64 w-full items-center justify-center">
          <BrandedLoader size={28} label="Loading document..." />
        </div>
      )}
      <div
        ref={canvasWrapperRef}
        // items-center/justify-center only while the page still fits (zoom
        // 1): a centered flex container can't be scrolled past its own
        // starting position toward the "before center" side — once the
        // canvas is bigger than the wrapper (zoom > 1), the top/left of the
        // page ends up centered off past the wrapper's edge with no scroll
        // position that can ever reach it, only the bottom/right overflow
        // is reachable. Falling back to items-start/justify-start once
        // zoomed keeps the whole page within the normal, fully scrollable
        // 0-to-content-size range instead.
        className={
          ready
            ? `flex w-full overflow-auto ${zoom > 1 ? "items-start justify-start" : "items-center justify-center"}`
            : "hidden"
        }
        // A real, bounded height rather than something percentage-based —
        // fillHeight means an ancestor (VersionCompareFrame, or this
        // component's own fullscreen wrapper below) already resolves 100%
        // to a real pixel height via a proper flex-col chain, so 100% is
        // safe there; the plain inline case has no such ancestor (ordinary
        // block flow has no imposed height), so it gets a flat viewport-unit
        // cap instead — this is also exactly the box recomputeRenderSize
        // measures via clientWidth/clientHeight, so it has to be a real,
        // resolved size either way, never "auto".
        style={{ height: activeFillHeight ? "100%" : "70vh" }}
      >
        <canvas
          ref={canvasRef}
          onDragStart={disableInteraction ? (e) => e.preventDefault() : undefined}
          className="bg-white shadow-ff"
          style={{
            width: renderSize ? `${renderSize.width}px` : undefined,
            height: renderSize ? `${renderSize.height}px` : undefined,
            // Before the first ResizeObserver callback lands (recomputing
            // this from real measurements), the canvas has no explicit
            // size — its raw bitmap resolution (canvas.width, set at
            // scale:2 in renderPage) would otherwise briefly paint at full
            // size before snapping down to the fit size, reading as a
            // flash/flicker on every load or resize. These same caps used
            // once real, apply here too as a same-ballpark placeholder so
            // there's nothing oversized to flash in the first place.
            maxWidth: renderSize ? undefined : "100%",
            maxHeight: renderSize ? undefined : activeFillHeight ? "92vh" : "75vh",
            display: "block",
          }}
        />
      </div>

      {ready && (
        <div className="flex w-full shrink-0 items-center justify-center gap-4 text-sm text-ff-textMuted">
          {pageCount > 1 && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
                disabled={pageIndex === 0}
                aria-label="Previous page"
                className="rounded p-1.5 hover:bg-ff-lavender disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              Page {pageIndex + 1} of {pageCount}
              <button
                type="button"
                onClick={() => setPageIndex((i) => Math.min(pageCount - 1, i + 1))}
                disabled={pageIndex === pageCount - 1}
                aria-label="Next page"
                className="rounded p-1.5 hover:bg-ff-lavender disabled:opacity-30"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
          {/* Zoom past the fit-to-frame default — that default is what made
              a tall portrait page render legibly small on a wide/short
              screen with nothing else to do about it. Reset (click the
              percentage) goes back to fit; zooming in makes the wrapper
              above (overflow-auto) scrollable so the zoomed-in region can
              actually be panned to. */}
          <div className={`flex items-center gap-1 ${pageCount > 1 ? "border-l border-ff-border pl-4" : ""}`}>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))}
              disabled={zoom <= ZOOM_MIN}
              aria-label="Zoom out"
              title="Zoom out"
              className="rounded p-1.5 hover:bg-ff-lavender disabled:opacity-30"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setZoom(1)}
              title="Reset zoom to fit page"
              className="min-w-[3.25rem] rounded px-1 py-1 text-center tabular-nums hover:bg-ff-lavender"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))}
              disabled={zoom >= ZOOM_MAX}
              aria-label="Zoom in"
              title="Zoom in"
              className="rounded p-1.5 hover:bg-ff-lavender disabled:opacity-30"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );

  if (!allowFullscreen) return content;

  return (
    <div
      ref={stageRef}
      className={`relative w-full ${fullscreen ? "flex h-screen flex-col items-center justify-center bg-black" : ""}`}
    >
      <button
        type="button"
        onClick={toggleFullscreen}
        title={fullscreen ? "Exit full screen" : "Full screen"}
        aria-label={fullscreen ? "Exit full screen" : "Full screen"}
        className="absolute right-2 top-2 z-10 rounded bg-white/90 p-1.5 text-ff-textMuted shadow transition-colors hover:bg-white hover:text-ff-text"
      >
        {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </button>
      {content}
      {watermark}
    </div>
  );
}
