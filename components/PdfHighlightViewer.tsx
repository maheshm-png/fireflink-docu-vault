"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2, Maximize2, Minimize2, Pencil, X, ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";
// Type-only — erased entirely at compile time, so this doesn't trigger the
// browser-only-globals problem the actual (dynamic, runtime) import below
// is written to avoid.
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import BrandedLoader from "./BrandedLoader";

export type PdfPanelItem = {
  id: string;
  highlightedText: string | null;
  comment: string;
  authorId: string;
  authorLabel?: string;
  // A short round/attempt tag shown as its own pill next to authorLabel in
  // the active-comment popover (e.g. "v1.1") — kept structured rather than
  // appended into authorLabel as free text (the previous "Name · Round N"
  // format this replaced had to be split back apart with a string search
  // to render as a separate pill, which broke silently if the format ever
  // changed on just one end).
  roundLabel?: string;
  canDelete: boolean;
  // Whether the CURRENT viewer can edit this item's text — see
  // components/HighlightCommentPanel.tsx's PanelItem for why this is its
  // own field rather than reused from canDelete.
  canEdit: boolean;
  editedAt?: string | null;
};

type PageIndex = {
  text: string;
  nodes: { node: Text; start: number; end: number }[];
};

type Overlay = { itemId: string; pageIndex: number; rects: DOMRect[] };

// Minimal CSS pdf.js's renderTextLayer expects around whatever it renders
// (each text run as an absolutely-positioned, transparent-text <span> that
// pdf.js itself sizes/transforms inline) — mirrors pdf.js's own long-stable
// public .textLayer stylesheet rather than importing it from node_modules,
// so this doesn't depend on how (or whether) Next resolves a package CSS
// import at build time.
const TEXT_LAYER_CSS = `
.ff-pdf-textlayer {
  position: absolute;
  inset: 0;
  overflow: hidden;
  line-height: 1;
  opacity: 1;
  transform-origin: 0 0;
}
.ff-pdf-textlayer span, .ff-pdf-textlayer br {
  color: transparent;
  position: absolute;
  white-space: pre;
  cursor: text;
  transform-origin: 0% 0%;
}
.ff-pdf-textlayer ::selection {
  background: rgba(37, 99, 235, 0.35);
}
`;

/** Walks a rendered text-layer's actual DOM text nodes (in document order)
 * to build a flat searchable string plus an offset->node map — this reads
 * whatever pdf.js actually produced, so it stays consistent with what
 * `window.getSelection().toString()` would read from that same DOM,
 * regardless of any pdf.js text-layer quirks (extra spaces, line breaks
 * between distant items, etc.) this doesn't need to know about. */
function buildPageIndex(container: HTMLElement): PageIndex {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let text = "";
  const nodes: PageIndex["nodes"] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const textNode = node as Text;
    const content = textNode.textContent ?? "";
    if (!content) continue;
    const start = text.length;
    text += content;
    nodes.push({ node: textNode, start, end: text.length });
  }
  return { text, nodes };
}

function buildRange(index: PageIndex, start: number, end: number): Range | null {
  const startEntry = index.nodes.find((n) => start >= n.start && start < n.end);
  const endEntry = index.nodes.find((n) => end > n.start && end <= n.end);
  if (!startEntry || !endEntry) return null;
  const range = document.createRange();
  range.setStart(startEntry.node, start - startEntry.start);
  range.setEnd(endEntry.node, end - endEntry.start);
  return range;
}

/** Finds the first unclaimed occurrence of `needle` across all pages' text
 * (in page order), same "claim a range so overlapping/duplicate substrings
 * don't get double-matched" approach as components/HighlightCommentPanel.tsx,
 * extended across page boundaries instead of one flat string — a highlight
 * never spans two pages since it was always created from a single-page
 * selection to begin with. */
function locate(
  pages: PageIndex[],
  needle: string,
  claimed: Set<number>[]
): { pageIndex: number; start: number; end: number } | null {
  for (let p = 0; p < pages.length; p++) {
    const { text } = pages[p];
    let fromIndex = 0;
    while (fromIndex <= text.length - needle.length) {
      const at = text.indexOf(needle, fromIndex);
      if (at === -1) break;
      let overlaps = false;
      for (let i = at; i < at + needle.length; i++) {
        if (claimed[p].has(i)) {
          overlaps = true;
          break;
        }
      }
      if (!overlaps) return { pageIndex: p, start: at, end: at + needle.length };
      fromIndex = at + 1;
    }
  }
  return null;
}

/**
 * True in-document highlighting: renders the actual PDF (page by page —
 * canvas + a real, selectable text layer via pdf.js) instead of a plain
 * extracted-text panel, so a reviewer selects text directly on the
 * rendered page. Shares its add/list/delete contract with
 * components/HighlightCommentPanel.tsx (used as a fallback where no PDF
 * exists to render — a raw video/link/other document) so
 * components/InlineCommentReview.tsx and components/DocumentFeedback.tsx
 * can swap between the two based on what's actually available, without
 * either wrapper needing its own separate UI.
 *
 * Existing highlights aren't stored as coordinates — only the selected
 * text itself (see prisma/schema.prisma's InlineComment/DocumentFeedback
 * comment) — so they're re-located here the same way HighlightCommentPanel
 * re-locates them in plain text: searching the page's own rendered text
 * for the first unclaimed match, then drawing an overlay at that match's
 * on-screen position (Range.getClientRects()) rather than mutating pdf.js's
 * own text-layer DOM.
 */
export default function PdfHighlightViewer({
  documentId,
  version,
  initialItems,
  onAdd,
  onEdit,
  onDelete,
  icon: Icon,
  heading,
  description,
  readOnly = false,
  focusRequest,
  collapsible = false,
  embedded = false,
}: {
  documentId: string;
  version?: number;
  initialItems: PdfPanelItem[];
  onAdd?: (payload: {
    highlightedText: string | null;
    comment: string;
  }) => Promise<{ ok: true; item: PdfPanelItem } | { ok: false; error: string }>;
  onEdit?: (id: string, comment: string) => Promise<{ ok: true; item: PdfPanelItem } | { ok: false; error: string }>;
  onDelete?: (id: string) => Promise<boolean>;
  icon: LucideIcon;
  heading: string;
  description: string;
  // See components/HighlightCommentPanel.tsx's own readOnly/focusRequest
  // doc comment — identical contract, mirrored here for the real-PDF
  // rendering path.
  readOnly?: boolean;
  focusRequest?: { id: string; nonce: number } | null;
  // Adds a collapse/expand toggle next to the fullscreen button, for a
  // caller whose page already has several large sections stacked (see
  // components/InlineCommentReview.tsx) where this one's full document
  // render isn't always what someone wants sitting open. Off by default —
  // components/ReviewHighlightsViewer.tsx's read-only view stays exactly
  // as before.
  collapsible?: boolean;
  // Drops this panel's own card chrome (border/shadow/margin) outside
  // fullscreen — see components/HighlightCommentPanel.tsx's identical prop
  // for why (nested inside another already-bordered card via
  // components/ReviewHighlightsViewer.tsx). Off by default.
  embedded?: boolean;
}) {
  const [items, setItems] = useState<PdfPanelItem[]>(initialItems);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [pageCount, setPageCount] = useState(0);
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [flashedId, setFlashedId] = useState<string | null>(null);
  const [pendingSelection, setPendingSelection] = useState<{
    text: string;
    pageIndex: number;
    top: number;
    left: number;
  } | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  // The document's own background — sampled from its first rendered page's
  // corner rather than assumed, so fullscreen's surrounding area matches
  // instead of always being the same fixed lavender tint (most pages are
  // white, but not all — a dark-themed slide export, a colored letterhead).
  const [bgColor, setBgColor] = useState<string | null>(null);

  const [fullscreen, setFullscreen] = useState(false);
  // Starts expanded either way — collapsible only adds the option to tuck
  // this section away, it shouldn't hide it by default.
  const [collapsed, setCollapsed] = useState(false);
  // Same floating "collapse" pill as app/dashboard/documents/[id]/
  // ReviewTrailWithHighlights.tsx's Reviewer Highlights panel — this
  // section's rendered document can run long, so the header's own collapse
  // button (up at the top) is out of reach once scrolled down into it. Only
  // shown while actively scrolling (plus a brief hold after), not
  // permanently, for the same reason that component gives: a fixed icon
  // sitting in the corner the whole time reads as unrelated chrome.
  const [showFloatingCollapse, setShowFloatingCollapse] = useState(false);
  const hideFloatingCollapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!collapsible || collapsed) return;
    function onWindowScroll() {
      setShowFloatingCollapse(true);
      if (hideFloatingCollapseTimer.current) clearTimeout(hideFloatingCollapseTimer.current);
      hideFloatingCollapseTimer.current = setTimeout(() => setShowFloatingCollapse(false), 1000);
    }
    document.addEventListener("scroll", onWindowScroll, true);
    return () => {
      document.removeEventListener("scroll", onWindowScroll, true);
      if (hideFloatingCollapseTimer.current) clearTimeout(hideFloatingCollapseTimer.current);
    };
  }, [collapsible, collapsed]);
  // Bumped on every scroll (capture-phase, so it catches scrolling on
  // whatever ancestor actually scrolls — window outside fullscreen, or the
  // section itself in fullscreen) purely to force a re-render, so
  // activeOverlayScreenPos below keeps tracking the highlight's on-screen
  // position live instead of only updating once some unrelated re-render
  // happens to occur after a jumpToItem scroll finishes animating.
  const [scrollTick, bumpScrollTick] = useState(0);
  const sectionRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<HTMLDivElement[]>([]);
  const pageIndicesRef = useRef<PageIndex[]>([]);
  // The actual rendered overlay <div> for each item's first rect — used by
  // jumpToItem to scroll to the exact highlighted line via the browser's
  // own scrollIntoView, rather than pageRefs (which only ever scrolls to
  // wherever the page starts, which for a multi-highlight or tall page can
  // land well above or below the actual line someone clicked).
  const overlayElRefs = useRef<Record<string, HTMLElement | null>>({});
  // The loaded document + its module, kept across renders so toggling
  // fullscreen (or anything else that should re-fit the pages) can re-run
  // just the render step at the new size, instead of re-fetching and
  // re-parsing the whole PDF from scratch each time.
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const pdfjsLibRef = useRef<typeof import("pdfjs-dist") | null>(null);
  // Invalidates any in-flight render pass when a newer one starts (a fast
  // double-toggle of fullscreen, or unmounting) — checked at every await
  // point instead of a plain boolean flag, since two render passes can now
  // be in flight back to back rather than just "cancelled or not".
  const renderGenRef = useRef(0);
  const didInitialRenderRef = useRef(false);

  const activeItem = items.find((c) => c.id === activeItemId) ?? null;

  function closePopovers() {
    setPendingSelection(null);
    setActiveItemId(null);
    setDraft("");
    setFormError(null);
    cancelEdit();
  }

  function startEdit(item: PdfPanelItem) {
    setEditingItemId(item.id);
    setEditDraft(item.comment);
    setEditError(null);
  }

  function cancelEdit() {
    setEditingItemId(null);
    setEditDraft("");
    setEditError(null);
  }

  async function saveEdit(id: string) {
    if (!editDraft.trim() || !onEdit) return;
    setEditSubmitting(true);
    setEditError(null);
    const res = await onEdit(id, editDraft.trim());
    setEditSubmitting(false);
    if (!res.ok) {
      setEditError(res.error);
      return;
    }
    setItems((prev) => prev.map((it) => (it.id === id ? res.item : it)));
    cancelEdit();
  }

  useEffect(() => {
    function onFullscreenChange() {
      setFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  function toggleFullscreen() {
    if (!sectionRef.current) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else sectionRef.current.requestFullscreen().catch(() => {});
  }

  // Waits for the given page's container <div> to actually exist — it's
  // only rendered once React has committed the setPageCount state update,
  // which isn't guaranteed to have happened yet on an early iteration;
  // polling via rAF is more robust than a single fixed-delay wait (a
  // setTimeout(0) here previously raced React's commit on a slow render
  // and could miss it).
  async function waitForContainer(index: number, myGen: number): Promise<HTMLDivElement | null> {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (renderGenRef.current !== myGen) return null;
      const el = pageRefs.current[index];
      if (el) return el;
      await new Promise((r) => requestAnimationFrame(r));
    }
    return pageRefs.current[index] ?? null;
  }

  // Renders every page of an already-loaded document (canvas + text layer)
  // into pageRefs at whatever width the scroll container currently is, then
  // builds each page's text index. Re-locates highlight overlays afterward
  // via the `ready` toggle below, which the overlay effect depends on.
  async function renderPages(
    pdfjsLib: typeof import("pdfjs-dist"),
    pdfDoc: PDFDocumentProxy,
    myGen: number
  ) {
    setReady(false);

    // Fit each page to the scroll container's width when it's actually
    // available and sane; a scrollRef.clientWidth of exactly 0 (measured
    // before layout has settled) is a real possibility, not just
    // null/undefined, so this deliberately treats 0 as "not usable" too (a
    // plain `?? fallback` would NOT catch that, since 0 isn't nullish —
    // that was an earlier bug here: every page silently rendered at a 0x0
    // scale, an invisible box with nothing wrong enough to throw).
    const measuredWidth = scrollRef.current?.clientWidth || 0;
    const targetWidth = measuredWidth > 100 ? Math.min(measuredWidth, 1000) : 760;

    const indices: PageIndex[] = [];

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

      if (pageNum === 1) {
        // First page's corner stands in for "the document's background" —
        // its margin is almost always a uniform color.
        try {
          const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
          setBgColor(`rgb(${r}, ${g}, ${b})`);
        } catch {
          // Rare (a canvas the browser considers tainted) — falls back to
          // the fixed neutral already used below when bgColor stays null.
        }
      }

      const textLayerDiv = document.createElement("div");
      textLayerDiv.className = "ff-pdf-textlayer";
      textLayerDiv.style.width = `${viewport.width}px`;
      textLayerDiv.style.height = `${viewport.height}px`;

      const textContent = await page.getTextContent();
      const task = pdfjsLib.renderTextLayer({
        textContentSource: textContent,
        container: textLayerDiv,
        viewport,
      });
      await task.promise;
      if (renderGenRef.current !== myGen) return;

      container.style.position = "relative";
      container.style.width = `${viewport.width}px`;
      container.style.height = `${viewport.height}px`;
      container.innerHTML = "";
      container.appendChild(canvas);
      container.appendChild(textLayerDiv);

      indices[pageNum - 1] = buildPageIndex(textLayerDiv);
    }

    if (renderGenRef.current !== myGen) return;
    pageIndicesRef.current = indices;
    setReady(true);
  }

  // Loads the PDF once per document/version. Dynamically imported inside
  // the effect (not at module scope) since "use client" components still
  // run once on the server during Next's initial render, and pdfjs-dist
  // touches browser-only globals (Worker, document) at import time that
  // don't exist there.
  useEffect(() => {
    let localCancelled = false;
    didInitialRenderRef.current = false;
    const fetchUrl = `/api/documents/${documentId}/preview${version ? `?version=${version}` : ""}${
      version ? "&" : "?"
    }raw=1`;

    async function load() {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.js";

        const pdfDoc = await pdfjsLib.getDocument({ url: fetchUrl }).promise;
        if (localCancelled) return;

        pdfDocRef.current = pdfDoc;
        pdfjsLibRef.current = pdfjsLib;
        setPageCount(pdfDoc.numPages);

        const myGen = ++renderGenRef.current;
        await renderPages(pdfjsLib, pdfDoc, myGen);
        didInitialRenderRef.current = true;
      } catch (err) {
        console.error("PdfHighlightViewer failed to render:", err);
        if (!localCancelled) setLoadError("Could not load this document for preview.");
      }
    }

    load();
    return () => {
      localCancelled = true;
      renderGenRef.current++;
      pdfDocRef.current = null;
      pdfjsLibRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, version]);

  // Re-fits and re-renders every page at the new size whenever the
  // fullscreen state changes (skipping the very first render, already
  // handled by the load effect above) — a native browser PDF iframe keeps
  // whatever zoom it had after its container resizes (fixed elsewhere in
  // this app via a forced reload + zoom=page-fit), and this canvas-based
  // viewer has the same problem for the same reason: nothing here
  // automatically re-fits just because the box around it got bigger or
  // smaller.
  useEffect(() => {
    if (!didInitialRenderRef.current) return;
    const pdfDoc = pdfDocRef.current;
    const pdfjsLib = pdfjsLibRef.current;
    if (!pdfDoc || !pdfjsLib) return;
    const myGen = ++renderGenRef.current;
    renderPages(pdfjsLib, pdfDoc, myGen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreen]);

  // Re-locates every current item's highlight across the rendered pages and
  // computes overlay rects for them — reruns whenever the page text indices
  // are ready or the item list changes (a new comment added/removed).
  useEffect(() => {
    if (!ready) return;
    const pages = pageIndicesRef.current;
    const claimed: Set<number>[] = pages.map(() => new Set());
    const next: Overlay[] = [];
    for (const item of items) {
      if (!item.highlightedText) continue;
      const found = locate(pages, item.highlightedText, claimed);
      if (!found) continue;
      for (let i = found.start; i < found.end; i++) claimed[found.pageIndex].add(i);
      const range = buildRange(pages[found.pageIndex], found.start, found.end);
      if (!range) continue;
      const pageEl = pageRefs.current[found.pageIndex];
      const pageRect = pageEl?.getBoundingClientRect();
      if (!pageRect) continue;
      // Store rects relative to the page container (not the viewport), so
      // they stay correct regardless of scroll position — recomputed as
      // plain numbers rather than live DOMRects, since a DOMRect from
      // getClientRects() is viewport-relative and goes stale the instant
      // the page scrolls.
      const rects = Array.from(range.getClientRects()).map(
        (r) => new DOMRect(r.left - pageRect.left, r.top - pageRect.top, r.width, r.height)
      );
      next.push({ itemId: item.id, pageIndex: found.pageIndex, rects });
    }
    setOverlays(next);
  }, [ready, items]);

  function handleMouseUp(pageIndex: number) {
    if (readOnly) return;
    const selection = window.getSelection();
    const pageEl = pageRefs.current[pageIndex];
    if (!selection || selection.rangeCount === 0 || !pageEl) return;
    const range = selection.getRangeAt(0);
    if (!pageEl.contains(range.commonAncestorContainer)) return;

    // pdf.js's text-layer spans are invisible and independently positioned
    // from the glyphs actually painted on the canvas beneath them — on a
    // heavily font-substituted PDF (typical of a LibreOffice PPT
    // conversion) the two can disagree by a character or two, so a
    // mouse-up that visually looks like it's at the start/end of a word
    // can land a few characters short WITHIN that same span (e.g. "Manual
    // Script Develo" instead of "...Development"). This expands each
    // endpoint out to the nearest word boundary, but strictly within that
    // endpoint's own text node — never past it into a sibling node/span —
    // so it can't repeat the earlier regression where a page-wide search
    // walked straight into an unrelated, separate shape's text when there
    // was no space between them in the DOM.
    function expandToWordBoundary(node: Node, offset: number, direction: "start" | "end"): number {
      if (node.nodeType !== Node.TEXT_NODE) return offset;
      const content = node.textContent ?? "";
      const isWordChar = (ch: string) => /[\p{L}\p{N}]/u.test(ch);
      let i = offset;
      if (direction === "start") {
        while (i > 0 && isWordChar(content[i - 1])) i--;
      } else {
        while (i < content.length && isWordChar(content[i])) i++;
      }
      return i;
    }

    const expandedRange = document.createRange();
    expandedRange.setStart(range.startContainer, expandToWordBoundary(range.startContainer, range.startOffset, "start"));
    expandedRange.setEnd(range.endContainer, expandToWordBoundary(range.endContainer, range.endOffset, "end"));

    const text = expandedRange.toString().trim();
    if (!text) return;

    const rect = range.getBoundingClientRect();
    setActiveItemId(null);
    setPendingSelection({ text, pageIndex, top: rect.top, left: rect.left + rect.width / 2 });
    setDraft("");
    setFormError(null);
  }

  async function submitHighlighted() {
    if (!pendingSelection || !draft.trim() || !onAdd) return;
    setSubmitting(true);
    setFormError(null);
    const res = await onAdd({ highlightedText: pendingSelection.text, comment: draft.trim() });
    setSubmitting(false);
    if (!res.ok) {
      setFormError(res.error);
      return;
    }
    setItems((prev) => [...prev, res.item]);
    setPendingSelection(null);
    setDraft("");
    window.getSelection()?.removeAllRanges();
  }

  async function removeItem(id: string) {
    if (!onDelete) return;
    const ok = await onDelete(id);
    if (ok) {
      setItems((prev) => prev.filter((c) => c.id !== id));
      setActiveItemId(null);
      if (editingItemId === id) cancelEdit();
    }
  }

  function jumpToItem(id: string) {
    const overlay = overlays.find((o) => o.itemId === id);
    if (overlay) {
      const target = overlayElRefs.current[id] ?? pageRefs.current[overlay.pageIndex];
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
      setFlashedId(id);
      setTimeout(() => setFlashedId((cur) => (cur === id ? null : cur)), 1200);
    }
    setPendingSelection(null);
    setActiveItemId(id);
  }

  // Reading order (top of the document to bottom), not whatever order the
  // items happened to load in — otherwise "Next" wouldn't reliably move
  // forward through the document. Only ever needed for the Prev/Next
  // fullscreen nav below: outside fullscreen, the comment list this
  // component's caller renders alongside it (e.g. ReviewTrail.tsx's
  // "Document Comments") is the normal way to pick a specific one — that
  // list becomes unreachable once fullscreen hides everything outside this
  // component, which is what Prev/Next exists to replace.
  const orderedItemIds = [...overlays]
    .sort((a, b) => a.pageIndex - b.pageIndex || (a.rects[0]?.top ?? 0) - (b.rects[0]?.top ?? 0))
    .map((o) => o.itemId);
  const activeOrderedIndex = activeItemId ? orderedItemIds.indexOf(activeItemId) : -1;

  // Clamps rather than wraps — jumping from the last comment back to the
  // first (or vice versa) read as "did that just do nothing?" since
  // there's no visual cue a wrap happened. Not wrapping also means Prev/
  // Next can now honestly reflect whether there's really somewhere to go
  // (hasPrevComment/hasNextComment below), instead of always being
  // available whenever there's more than one comment.
  function jumpRelative(direction: 1 | -1) {
    if (orderedItemIds.length === 0) return;
    const nextIndex = activeOrderedIndex === -1 ? (direction === 1 ? 0 : orderedItemIds.length - 1) : activeOrderedIndex + direction;
    if (nextIndex < 0 || nextIndex >= orderedItemIds.length) return;
    jumpToItem(orderedItemIds[nextIndex]);
  }

  const hasPrevComment = activeOrderedIndex > 0;
  const hasNextComment = activeOrderedIndex !== -1 && activeOrderedIndex < orderedItemIds.length - 1;

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (scrollRef.current?.contains(target) && !target.closest(".ff-pdf-overlay")) {
        // A plain click (not a drag-selection) inside the pages area closes
        // any open popover, same click-away behavior as clicking fully
        // outside — handleMouseUp above will reopen one if this click was
        // actually the end of a fresh selection.
      }
      if (target.closest(".ff-pdf-popover")) return;
      if (target.closest(".ff-pdf-overlay")) return;
      closePopovers();
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  // Same external-focus contract as HighlightCommentPanel.tsx — also gated
  // on `ready` since overlays don't exist yet until the PDF has actually
  // rendered, so a focus request arriving during that async load is retried
  // (via `ready` flipping true) rather than silently missing its target.
  // Depending on `overlays` too (not just `ready`) matters: the moment
  // `ready` first flips true, this effect and the one above that computes
  // `overlays` both fire in the SAME commit, in the order they're
  // declared — this one would run before `setOverlays` above has actually
  // landed, so `jumpToItem` read a still-empty `overlays` and silently
  // skipped the scroll (leaving activeItemId set but nothing visibly
  // jumped to, until a second click re-fired this effect on a render
  // where overlays actually existed). Reacting to `overlays` itself
  // guarantees this runs again once they're really there.
  useEffect(() => {
    if (!focusRequest || !ready) return;
    jumpToItem(focusRequest.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.id, focusRequest?.nonce, ready, overlays]);

  // Capture-phase so this fires regardless of which ancestor is actually
  // scrolling (window outside fullscreen, the section itself in
  // fullscreen) — see activeOverlayScreenPos's own comment for why.
  useEffect(() => {
    const onScroll = () => bumpScrollTick((n) => n + 1);
    document.addEventListener("scroll", onScroll, true);
    return () => document.removeEventListener("scroll", onScroll, true);
  }, []);

  const activeOverlay = activeItem ? overlays.find((o) => o.itemId === activeItem.id) : null;
  const activeOverlayScreenPos = useMemo(() => {
    if (!activeOverlay) return null;
    const pageEl = pageRefs.current[activeOverlay.pageIndex];
    if (!pageEl) return null;
    const pageRect = pageEl.getBoundingClientRect();
    const firstRect = activeOverlay.rects[0];
    if (!firstRect) return null;
    const top = pageRect.top + firstRect.top;
    return {
      top,
      bottom: top + firstRect.height,
      left: pageRect.left + firstRect.left + firstRect.width / 2,
      // Not enough room to grow upward without going off-screen (or, in
      // practice, overlapping the very text it's meant to sit above) —
      // grow downward from the highlight's bottom edge instead. 180px is a
      // generous stand-in for the popover's actual height, which isn't
      // knowable until after it renders.
      flipBelow: top < 180,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOverlay, overlays, scrollTick]);

  const activeAuthorName = activeItem?.authorLabel ?? "";
  const activeAuthorRound = activeItem?.roundLabel ?? null;

  return (
    <>
    <section
      ref={sectionRef}
      className={
        fullscreen
          ? "h-screen overflow-y-auto bg-white p-4"
          : embedded
          ? ""
          : "mb-6 rounded-ff border border-ff-border bg-white p-4 shadow-ff"
      }
    >
      <style>{TEXT_LAYER_CSS}</style>
      <div className="mb-1 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-base font-bold text-ff-text">
          <Icon className="h-4 w-4" aria-hidden />
          {heading}
        </h2>
        <div className="flex items-center gap-1">
          {collapsible && !fullscreen && (
            <button
              type="button"
              onClick={() => {
                // Closing any open popover before collapsing avoids it
                // reappearing mispositioned on re-expand — its position is
                // computed from a live DOM rect that goes stale the moment
                // its element is display:none.
                closePopovers();
                setCollapsed((c) => !c);
              }}
              title={collapsed ? "Expand" : "Collapse"}
              aria-label={collapsed ? "Expand" : "Collapse"}
              aria-expanded={!collapsed}
              className="rounded p-1.5 text-ff-textMuted transition-colors hover:bg-ff-lavender hover:text-ff-text"
            >
              {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
          )}
          {!collapsed && (
            <button
              type="button"
              onClick={toggleFullscreen}
              title={fullscreen ? "Exit full screen" : "Full screen"}
              aria-label={fullscreen ? "Exit full screen" : "Full screen"}
              className="rounded p-1.5 text-ff-textMuted transition-colors hover:bg-ff-lavender hover:text-ff-text"
            >
              {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>

      {/* CSS-hidden, not unmounted, while collapsed — the PDF rendering
          below attaches canvases directly to pageRefs' divs via pdf.js
          outside React's own diffing, and the popover positioning effects
          depend on scrollRef/pageRefs staying mounted; unmounting this on
          collapse would lose that rendered state and require re-running the
          whole load sequence on every re-expand. */}
      <div className={collapsed ? "hidden" : ""}>
      <p className="mb-3 text-xs text-ff-textMuted">{description}</p>

      {loadError ? (
        <p className="p-6 text-center text-sm text-ff-textMuted">{loadError}</p>
      ) : (
        <div
          ref={scrollRef}
          className={
            fullscreen
              ? "mb-3 overflow-auto rounded-ff border border-ff-border p-3"
              // No max-height/overflow here outside fullscreen — this used
              // to cap at 70vh with its own inner scrollbar, a second
              // nested scroll area inside the already-scrollable page
              // (and, in the tabbed document detail page, inside that
              // scrollable tab panel too). Letting the document render at
              // its natural height and scroll with the page itself is the
              // same fix as removing the forced height from
              // VersionCompareFrame.tsx's comparison panels.
              : "mb-3 rounded-ff border border-ff-border bg-ff-lavender/20 p-3"
          }
          style={fullscreen ? { backgroundColor: bgColor ?? "#F6ECF4" } : undefined}
        >
          {!ready && (
            <div className="flex h-64 items-center justify-center">
              <BrandedLoader size={28} label="Loading document..." />
            </div>
          )}
          <div className={ready ? "flex flex-col items-center gap-4" : "hidden"}>
            {Array.from({ length: pageCount }).map((_, i) => (
              <div key={i} className="relative">
                <div
                  ref={(el) => {
                    if (el) pageRefs.current[i] = el;
                  }}
                  onMouseUp={() => handleMouseUp(i)}
                  className="bg-white shadow-ff"
                />
                {overlays
                  .filter((o) => o.pageIndex === i)
                  .map((o) => (
                    <div key={o.itemId}>
                      {o.rects.map((r, ri) => (
                        <div
                          key={ri}
                          ref={(el) => {
                            if (ri === 0) overlayElRefs.current[o.itemId] = el;
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingSelection(null);
                            setActiveItemId(o.itemId);
                          }}
                          className={`ff-pdf-overlay absolute cursor-pointer rounded-sm bg-[#00994D]/35 transition-all hover:bg-[#00994D]/50 hover:shadow-[0_0_6px_rgba(0,153,77,0.6)] ${
                            flashedId === o.itemId ? "ring-2 ring-ff-accent" : ""
                          } ${
                            activeItemId === o.itemId ? "bg-[#00994D]/50 shadow-[0_0_6px_rgba(0,153,77,0.6)]" : ""
                          }`}
                          style={{ top: r.top, left: r.left, width: r.width, height: r.height }}
                        />
                      ))}
                    </div>
                  ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {pendingSelection && (
        <div
          className="ff-pdf-popover fixed z-50 w-64 -translate-x-1/2 -translate-y-full rounded-ff border border-ff-border bg-white p-3 shadow-ff-md"
          style={{ top: pendingSelection.top - 10, left: pendingSelection.left }}
        >
          <p className="mb-2 truncate text-xs text-ff-textMuted">
            &ldquo;<span className="italic text-ff-text">{pendingSelection.text}</span>&rdquo;
          </p>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitHighlighted();
              if (e.key === "Escape") closePopovers();
            }}
            placeholder="Add a comment..."
            className="mb-2 w-full rounded-ff border border-ff-border px-2.5 py-1.5 text-sm"
          />
          {formError && <p className="mb-2 text-xs text-ff-danger">{formError}</p>}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={submitHighlighted}
              disabled={submitting || !draft.trim()}
              className="rounded-ff bg-ff-accent-gradient px-3 py-1.5 text-xs font-medium text-white shadow-ff transition-all hover:shadow-ff-md hover:brightness-105 disabled:opacity-60"
            >
              Comment
            </button>
            <button
              type="button"
              onClick={closePopovers}
              className="rounded-ff border border-ff-border px-3 py-1.5 text-xs text-ff-text transition-colors hover:bg-ff-lavender/40"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {activeItem && activeOverlayScreenPos && (
        <div
          className="ff-pdf-popover fixed z-50 flex items-center gap-5"
          style={{
            top: activeOverlayScreenPos.flipBelow
              ? activeOverlayScreenPos.bottom + 10
              : activeOverlayScreenPos.top - 10,
            left: activeOverlayScreenPos.left,
            transform: activeOverlayScreenPos.flipBelow ? "translate(-50%, 0)" : "translate(-50%, -100%)",
          }}
        >
          {/* Prev/Next float free of the message bubble itself, with a real
              gap (gap-5 on the row below) so they never crowd its corners —
              step-to-the-next-message controls, not part of the message.
              Each side only renders when there's actually something in that
              direction (hasPrevComment/hasNextComment — navigation no
              longer wraps around, see jumpRelative's own comment) rather
              than staying visible-but-clickless at either end. A colored
              ring + accent icon (not plain white-on-white) keeps it visible
              sitting over a page that's very often plain white too. */}
          {hasPrevComment && (
            <button
              type="button"
              onClick={() => jumpRelative(-1)}
              title="Previous comment"
              aria-label="Previous comment"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-ff-accent/30 bg-white text-ff-accent shadow-ff-md transition-colors hover:bg-ff-accent hover:text-white"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
          )}

          {/* The bubble itself — a chat-message card: avatar + reviewer
              name up top (like an actual message sender), the comment text
              below it, not a compact toolbar-style header with the name and
              a counter crammed onto one line. rounded-ff (not a generic
              rounded-2xl) to match the corner radius every other card in
              this app uses, so this reads as part of the product rather
              than a dropped-in chat-widget shape. */}
          <div className="relative w-64 overflow-visible rounded-ff border border-ff-border bg-white shadow-ff-lg">
            <div
              aria-hidden
              className={`absolute left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border-ff-border bg-[#EEDCEB] ${
                activeOverlayScreenPos.flipBelow
                  ? "-top-[5px] border-l border-t"
                  : "-bottom-[5px] border-b border-r"
              }`}
            />
            <div className="flex items-start gap-2.5 rounded-t-ff bg-[#EEDCEB] px-3.5 py-3">
              <span
                aria-hidden
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ff-accent-gradient text-xs font-semibold text-white shadow-ff"
              >
                {(activeAuthorName.trim().charAt(0) || "?").toUpperCase()}
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                {activeAuthorName && (
                  <p className="truncate text-sm font-semibold text-ff-plum">{activeAuthorName}</p>
                )}
                <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  {activeAuthorRound && (
                    <span className="shrink-0 rounded-full bg-white px-1.5 py-[1px] text-[10px] font-medium text-ff-accent">
                      {activeAuthorRound}
                    </span>
                  )}
                  {orderedItemIds.length > 1 && (
                    <span className="shrink-0 text-[10px] text-ff-textMuted">
                      Comment {activeOrderedIndex === -1 ? "?" : activeOrderedIndex + 1} of {orderedItemIds.length}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={closePopovers}
                title="Close"
                aria-label="Close"
                className="shrink-0 rounded p-1 text-ff-textMuted transition-colors hover:bg-white/60 hover:text-ff-text"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>

            <div className="p-3.5">
          {editingItemId === activeItem.id ? (
            <>
              <input
                autoFocus
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveEdit(activeItem.id);
                  if (e.key === "Escape") cancelEdit();
                }}
                className="mb-2 w-full rounded-ff border border-ff-border px-2.5 py-1.5 text-sm"
              />
              {editError && <p className="mb-2 text-xs text-ff-danger">{editError}</p>}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => saveEdit(activeItem.id)}
                  disabled={editSubmitting || !editDraft.trim()}
                  className="rounded-ff bg-ff-accent-gradient px-3 py-1.5 text-xs font-medium text-white shadow-ff transition-all hover:shadow-ff-md hover:brightness-105 disabled:opacity-60"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="rounded-ff border border-ff-border px-3 py-1.5 text-xs text-ff-text transition-colors hover:bg-ff-lavender/40"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="mb-2 whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-ff-text">
                {activeItem.comment}
                {activeItem.editedAt && <span className="ml-1.5 text-xs italic text-ff-textMuted">(edited)</span>}
              </p>
              {(activeItem.canEdit || activeItem.canDelete) && (
                <div className="flex items-center gap-2 border-t border-ff-border pt-2">
                  {activeItem.canEdit && (
                    <button
                      type="button"
                      onClick={() => startEdit(activeItem)}
                      className="flex items-center gap-1 rounded-ff border border-ff-border px-2.5 py-1 text-xs text-ff-text transition-colors hover:bg-ff-lavender/40"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                      Edit
                    </button>
                  )}
                  {activeItem.canDelete && (
                    <button
                      type="button"
                      onClick={() => removeItem(activeItem.id)}
                      className="flex items-center gap-1 rounded-ff border border-ff-border px-2.5 py-1 text-xs text-ff-danger transition-colors hover:bg-ff-danger/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      Delete
                    </button>
                  )}
                </div>
              )}
            </>
          )}
            </div>
          </div>

          {hasNextComment && (
            <button
              type="button"
              onClick={() => jumpRelative(1)}
              title="Next comment"
              aria-label="Next comment"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-ff-accent/30 bg-white text-ff-accent shadow-ff-md transition-colors hover:bg-ff-accent hover:text-white"
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
      )}

      {items.length > 0 && (
        <ul className="space-y-1.5 border-t border-ff-border pt-3">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => jumpToItem(item.id)}
                className="w-full rounded-ff border border-ff-border p-2.5 text-left text-sm transition-colors hover:bg-ff-lavender/30"
              >
                {item.authorLabel && (
                  <p className="mb-0.5 text-xs font-medium text-ff-textMuted">
                    {item.authorLabel}
                    {item.roundLabel && ` · ${item.roundLabel}`}
                  </p>
                )}
                {item.highlightedText && (
                  <p className="mb-0.5 truncate text-xs italic text-ff-textMuted">&ldquo;{item.highlightedText}&rdquo;</p>
                )}
                <p className="text-ff-text">
                  {item.comment}
                  {item.editedAt && <span className="ml-1 text-xs italic text-ff-textMuted">(edited)</span>}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
      </div>

    </section>

    {/* Fixed to the viewport, same reasoning as ReviewTrailWithHighlights.tsx's
        identical button: reachable from any scroll position regardless of
        this section's own height, and immune to any overflow:hidden
        ancestor a sticky element would get silently confined by. Only
        actually visible while scrolling (showFloatingCollapse) — always
        mounted so the opacity transition has something to animate, but
        pointer-events-none while faded out so it never intercepts clicks
        meant for whatever's underneath it. Not rendered at all in
        fullscreen (nothing else to collapse back to while filling the
        screen) or once already collapsed. */}
    {collapsible && !collapsed && !fullscreen && (
      <button
        type="button"
        onClick={() => {
          closePopovers();
          setCollapsed(true);
        }}
        onMouseEnter={() => {
          if (hideFloatingCollapseTimer.current) clearTimeout(hideFloatingCollapseTimer.current);
          setShowFloatingCollapse(true);
        }}
        onMouseLeave={() => {
          hideFloatingCollapseTimer.current = setTimeout(() => setShowFloatingCollapse(false), 1000);
        }}
        aria-hidden={!showFloatingCollapse}
        tabIndex={showFloatingCollapse ? 0 : -1}
        className={`fixed bottom-5 right-5 z-30 flex items-center gap-1.5 rounded-full bg-ff-accent-gradient px-4 py-2.5 text-xs font-semibold text-white shadow-ff-lg transition-opacity duration-300 hover:brightness-105 ${
          showFloatingCollapse ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <ChevronUp className="h-3.5 w-3.5" aria-hidden />
        Collapse {heading}
      </button>
    )}
    </>
  );
}
