"use client";

import { MessageSquareQuote } from "lucide-react";
import HighlightCommentPanel, { type PanelItem } from "./HighlightCommentPanel";
import PdfHighlightViewer from "./PdfHighlightViewer";

export type ReviewHighlight = {
  id: string;
  highlightedText: string | null;
  comment: string;
  reviewerName: string;
  roundNumber: number;
  editedAt?: string | null;
};

/**
 * Read-only counterpart to components/InlineCommentReview.tsx — shows the
 * actual document with every resolved round's highlight-and-comment
 * feedback marked on it, so the uploader/owner can see exactly where a
 * reviewer's comments landed instead of only reading the quoted excerpt in
 * app/dashboard/documents/[id]/ReviewTrail.tsx's plain list. Clicking a
 * comment there sets `focusItemId`, which this component turns into a
 * `focusRequest` for whichever inner viewer is actually rendering — same
 * "jump to and flash" interaction reviewers already get when they click
 * their own list of comments while writing them.
 *
 * Renders nothing when there's nothing to show — no resolved comments, or
 * no document to render them against — rather than an empty shell.
 */
export default function ReviewHighlightsViewer({
  documentId,
  version,
  hasPdf,
  extractedText,
  highlights,
  focusItemId,
}: {
  documentId: string;
  version?: number;
  hasPdf: boolean;
  extractedText: string;
  highlights: ReviewHighlight[];
  // Sourced from ReviewTrail's onCommentClick — a plain id is enough here
  // (unlike HighlightCommentPanel/PdfHighlightViewer's own focusRequest
  // prop) since the parent bumps a fresh object on every click already; see
  // components/ReviewTrailWithHighlights.tsx.
  focusItemId: { id: string; nonce: number } | null;
}) {
  if (highlights.length === 0) return null;

  const items: PanelItem[] = highlights.map((h) => ({
    id: h.id,
    highlightedText: h.highlightedText,
    comment: h.comment,
    authorId: h.id,
    authorLabel: `${h.reviewerName} · Round ${h.roundNumber}`,
    canDelete: false,
    canEdit: false,
    editedAt: h.editedAt,
  }));

  if (hasPdf) {
    return (
      <PdfHighlightViewer
        documentId={documentId}
        version={version}
        initialItems={items}
        readOnly
        focusRequest={focusItemId}
        icon={MessageSquareQuote}
        heading="Reviewer Highlights"
        description="Where reviewers' comments landed on the document. Click a comment to jump to it."
      />
    );
  }

  return (
    <HighlightCommentPanel
      text={extractedText}
      initialItems={items}
      readOnly
      focusRequest={focusItemId}
      icon={MessageSquareQuote}
      heading="Reviewer Highlights"
      description="Where reviewers' comments landed on the document. Click a comment to jump to it."
    />
  );
}
