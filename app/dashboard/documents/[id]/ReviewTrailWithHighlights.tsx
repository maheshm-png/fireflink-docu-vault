"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquareQuote, ChevronRight, ChevronUp } from "lucide-react";
import ReviewTrail from "./ReviewTrail";
import ReviewHighlightsViewer, { type ReviewHighlight } from "@/components/ReviewHighlightsViewer";
import type { RoundGroup } from "@/lib/versionRounds";

type ReviewRequestRow = Parameters<typeof ReviewTrail>[0]["reviewRequests"][number];
type InlineCommentRow = NonNullable<Parameters<typeof ReviewTrail>[0]["inlineComments"]>[number];
type AttemptSelection = { round: number; attempt: number };

type VersionInfo = { id: string; versionNumber: number; extractedText: string; hasPdf: boolean };

/**
 * Client-side pairing of ReviewTrail.tsx (the plain step-tracker + comment
 * list) and components/ReviewHighlightsViewer.tsx (the read-only document
 * view) — a server component (app/dashboard/documents/[id]/page.tsx) can't
 * hold the "which comment was just clicked" state these two need to share,
 * so this thin client wrapper does instead.
 *
 * Also owns the "Document Comments" round+attempt selection (rather than
 * ReviewTrail itself) for the same reason: switching which attempt's
 * comments are showing has to switch which version's actual document
 * renders underneath too, or you'd see (as reported) a different round
 * selected while the document view still shows an older file with older
 * highlights — because that view was always rendering whatever's currently
 * published, regardless of which tab was picked above it.
 */
export default function ReviewTrailWithHighlights({
  documentStatus,
  uploadedByName,
  uploadedAt,
  reviewRequests,
  inlineComments,
  revoked,
  documentId,
  versions,
  roundGroups,
  reviewerNameByRequestId,
}: {
  documentStatus: string;
  uploadedByName: string;
  uploadedAt: Date;
  reviewRequests: ReviewRequestRow[];
  inlineComments: InlineCommentRow[];
  revoked?: { byName: string; at: Date; reason: string | null } | null;
  documentId: string;
  // Every version of this document. No longer relied on for round<->version
  // matching (see roundGroups below) — just the data a version's own id
  // needs once roundGroups says which one to show.
  versions: VersionInfo[];
  // lib/versionRounds.ts's computeRoundAttempts output, computed once
  // server-side in app/dashboard/documents/[id]/page.tsx — the real
  // round<->version mapping. Replaces an earlier version of this component
  // that guessed via array-position zipping (round i -> versions[i]), which
  // silently broke once a revoke had bumped the round count past the
  // number of actual versions.
  roundGroups: RoundGroup[];
  // reviewRequestId -> reviewer name, for labeling each highlight in the
  // read-only viewer (ReviewTrail's own rows already show this next to
  // each attempt, but ReviewHighlightsViewer's list is flattened across
  // attempts so it needs the byline on each item itself).
  reviewerNameByRequestId: Record<string, string>;
}) {
  const [focusItemId, setFocusItemId] = useState<{ id: string; nonce: number } | null>(null);
  const [activeSelection, setActiveSelection] = useState<AttemptSelection | null>(null);
  // Rendering the actual document (a full PDF render, or the plain-text
  // panel) just to show where comments landed is real weight — collapsed
  // until there's a reason to look at it: clicking a comment above expands
  // it and jumps straight there, or it can be opened manually via its own
  // collapsed card, for browsing without picking a specific comment first.
  const [highlightsOpen, setHighlightsOpen] = useState(false);
  // The floating collapse button only shows WHILE actively scrolling
  // (plus a brief hold after it stops), not permanently — a fixed icon
  // sitting in the corner all the time reads as unrelated chrome (a chat
  // widget, a support bubble), not a control for the content on screen.
  // Appearing specifically during scroll activity keeps it tied to the one
  // moment it's actually needed: when you're moving through the document
  // and might want out.
  const [showFloatingCollapse, setShowFloatingCollapse] = useState(false);
  const hideFloatingCollapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!highlightsOpen) return;
    function onScroll() {
      setShowFloatingCollapse(true);
      if (hideFloatingCollapseTimer.current) clearTimeout(hideFloatingCollapseTimer.current);
      hideFloatingCollapseTimer.current = setTimeout(() => setShowFloatingCollapse(false), 1000);
    }
    // Capture phase: the actual scrolling element is page.tsx's <main>
    // (normal mode) or ReviewHighlightsViewer's own fullscreen section —
    // capture catches scroll events from whichever one it actually is,
    // same technique already used for scrollTick in PdfHighlightViewer.tsx.
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      if (hideFloatingCollapseTimer.current) clearTimeout(hideFloatingCollapseTimer.current);
    };
  }, [highlightsOpen]);

  // Scrolled into view the moment the panel opens (see the effect below) —
  // without this, clicking a comment while the panel's eventual position is
  // off-screen (below the fold, say) opened it somewhere the reader never
  // actually saw: no visible loading spinner, and once the document
  // finished loading and jumped to the comment, that jump happened
  // somewhere off-screen too. Scrolling here first means the loading state
  // itself is what's in view, not a blank stretch of page.
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!highlightsOpen) return;
    panelRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [highlightsOpen]);

  function handleCommentClick(id: string) {
    setFocusItemId((prev) => ({ id, nonce: (prev?.nonce ?? 0) + 1 }));
    setHighlightsOpen(true);
  }

  const reviewRequestById = Object.fromEntries(reviewRequests.map((r) => [r.id, r]));
  // Which (round, attempt) a given ReviewRequest.roundNumber maps to — see
  // ReviewTrail.tsx's own attemptByRoundNumber for the identical build.
  const attemptByRoundNumber = new Map<number, AttemptSelection & { versionId: string }>();
  for (const g of roundGroups) {
    for (const a of g.attempts) {
      for (const { roundNumber } of a.rounds) {
        attemptByRoundNumber.set(roundNumber, { round: g.round, attempt: a.attempt, versionId: a.versionId });
      }
    }
  }

  const currentGroup = roundGroups[roundGroups.length - 1];
  const currentAttempt = currentGroup?.attempts[currentGroup.attempts.length - 1];
  const currentSelection: AttemptSelection | null =
    currentGroup && currentAttempt ? { round: currentGroup.round, attempt: currentAttempt.attempt } : null;

  // Same "nothing about a still-pending round leaks ahead of the decision"
  // rule ReviewTrail.tsx's own visibleComments applies to its plain comment
  // list — the highlight overlays on the actual document need the same
  // filter, or a manager/uploader looking at this page while an attempt is
  // still in progress would see the live reviewer's in-progress comments
  // marked on the document before they've actually submitted a decision.
  const resolvedRequestIds = new Set(reviewRequests.filter((r) => r.status !== "pending").map((r) => r.id));
  const visibleComments = inlineComments.filter((c) => resolvedRequestIds.has(c.reviewRequestId));

  const selection: AttemptSelection | null =
    activeSelection &&
    roundGroups.some(
      (g) => g.round === activeSelection.round && g.attempts.some((a) => a.attempt === activeSelection.attempt)
    )
      ? activeSelection
      : currentSelection;

  const selectedGroup = selection ? roundGroups.find((g) => g.round === selection.round) : undefined;
  const selectedAttempt = selectedGroup?.attempts.find((a) => a.attempt === selection?.attempt);
  const versionById = new Map(versions.map((v) => [v.id, v]));
  // Falls back to the newest version if the selection can't resolve one
  // (shouldn't normally happen once roundGroups exists) — degrading to
  // "show the latest" beats rendering nothing.
  const version = (selectedAttempt ? versionById.get(selectedAttempt.versionId) : undefined) ?? versions[versions.length - 1];

  const highlights: ReviewHighlight[] = visibleComments
    .filter((c) => {
      const sel = attemptByRoundNumber.get(reviewRequestById[c.reviewRequestId]?.roundNumber ?? -1);
      return sel && selection && sel.round === selection.round && sel.attempt === selection.attempt;
    })
    .map((c) => ({
      id: c.id,
      highlightedText: c.highlightedText,
      comment: c.comment,
      reviewerName: reviewerNameByRequestId[c.reviewRequestId] ?? "Reviewer",
      roundLabel: selectedAttempt?.label ?? "",
      editedAt: c.editedAt ?? null,
    }));

  // Rendered inside ReviewTrail's own "Document Comments" section (passed
  // down as a prop) rather than as a separate card after it — merges "read
  // the comments" and "see where they landed on the document" into one
  // place. Available whenever there's a resolved version to show, whether
  // or not that round actually has any highlighted-passage comments — a
  // rejected attempt with only a plain decision reason (no highlights) used
  // to have no way to open the document at all here, since this used to
  // require highlights.length > 0.
  const documentViewer = version && (
    highlightsOpen ? (
      <div ref={panelRef}>
        {/* Fixed to the viewport rather than sticky — this panel sits
            inside DocumentDetailTabs.tsx's own overflow-hidden wrapper
            (needed there to clip the tab bar's rounded corners), and any
            overflow:hidden ancestor between a sticky element and its true
            scrolling container silently confines that element's "stick"
            range to the ancestor's own box instead of the real scrollport
            — which is exactly what made the sticky version of this
            control disappear once scrolled into a tall render.
            position:fixed has no such dependency on the ancestor chain,
            so it's reachable from literally anywhere. Only actually
            visible while scrolling (see showFloatingCollapse above) —
            always mounted so the opacity transition has something to
            animate, but pointer-events-none while hidden so it's never
            silently intercepting clicks meant for the document
            underneath it. */}
        <button
          type="button"
          onClick={() => setHighlightsOpen(false)}
          onMouseEnter={() => {
            // Holds the button visible while the pointer is over it —
            // without this, the same 1000ms hide-timer that fades it out
            // after scrolling stops keeps counting down underneath the
            // cursor, so it could vanish while someone's still reaching
            // for it.
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
          Collapse Reviewer Highlights
        </button>
        <ReviewHighlightsViewer
          documentId={documentId}
          version={version.versionNumber}
          hasPdf={version.hasPdf}
          extractedText={version.extractedText}
          highlights={highlights}
          focusItemId={focusItemId}
        />
        {/* Same action again right after the content, inline rather than
            floating — the fixed button above already reaches every
            scroll position, this is just a non-floating alternative
            right where reading naturally ends. */}
        <CollapseHighlightsButton className="mt-1.5" onClick={() => setHighlightsOpen(false)} />
      </div>
    ) : (
      <button
        type="button"
        onClick={() => setHighlightsOpen(true)}
        className="flex w-full items-center gap-2.5 rounded-ff border border-ff-border bg-white p-4 text-left shadow-ff transition-colors hover:border-ff-accent hover:bg-ff-lavender/40"
      >
        <MessageSquareQuote className="h-4 w-4 shrink-0 text-ff-textMuted" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-ff-text">Reviewer Highlights</span>
          <span className="block text-xs text-ff-textMuted">
            {highlights.length > 0
              ? "Where reviewers' comments landed on the document. Click a comment above, or here, to view."
              : "No highlighted comments for this version. Click here to view the document as submitted."}
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-ff-textMuted" aria-hidden />
      </button>
    )
  );

  return (
    <ReviewTrail
      documentStatus={documentStatus}
      uploadedByName={uploadedByName}
      uploadedAt={uploadedAt}
      reviewRequests={reviewRequests}
      inlineComments={inlineComments}
      revoked={revoked}
      roundGroups={roundGroups}
      onCommentClick={handleCommentClick}
      activeComment={selection}
      onActiveCommentChange={setActiveSelection}
      documentViewer={documentViewer}
    />
  );
}

function CollapseHighlightsButton({ onClick, className = "" }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 text-xs font-medium text-ff-accent hover:underline ${className}`}
    >
      <ChevronUp className="h-3.5 w-3.5" aria-hidden />
      Collapse Reviewer Highlights
    </button>
  );
}
