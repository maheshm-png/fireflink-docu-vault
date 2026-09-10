"use client";

import { useState } from "react";
import ReviewTrail from "./ReviewTrail";
import ReviewHighlightsViewer, { type ReviewHighlight } from "@/components/ReviewHighlightsViewer";

type ReviewRequestRow = Parameters<typeof ReviewTrail>[0]["reviewRequests"][number];
type InlineCommentRow = NonNullable<Parameters<typeof ReviewTrail>[0]["inlineComments"]>[number];

/**
 * Client-side pairing of ReviewTrail.tsx (the plain step-tracker + comment
 * list) and components/ReviewHighlightsViewer.tsx (the read-only document
 * view) — a server component (app/dashboard/documents/[id]/page.tsx) can't
 * hold the "which comment was just clicked" state these two need to share,
 * so this thin client wrapper does instead. Kept separate from ReviewTrail
 * itself so ReviewTrail stays usable on its own wherever the document view
 * isn't relevant.
 */
export default function ReviewTrailWithHighlights({
  documentStatus,
  uploadedByName,
  uploadedAt,
  reviewRequests,
  inlineComments,
  revoked,
  documentId,
  version,
  hasPdf,
  extractedText,
  reviewerNameByRequestId,
}: {
  documentStatus: string;
  uploadedByName: string;
  uploadedAt: Date;
  reviewRequests: ReviewRequestRow[];
  inlineComments: InlineCommentRow[];
  revoked?: { byName: string; at: Date; reason: string | null } | null;
  documentId: string;
  version?: number;
  hasPdf: boolean;
  extractedText: string;
  // reviewRequestId -> reviewer name, for labeling each highlight in the
  // read-only viewer (ReviewTrail's own rows already show this next to
  // each round, but ReviewHighlightsViewer's list is flattened across
  // rounds so it needs the byline on each item itself).
  reviewerNameByRequestId: Record<string, string>;
}) {
  const [focusItemId, setFocusItemId] = useState<{ id: string; nonce: number } | null>(null);

  const highlights: ReviewHighlight[] = inlineComments.map((c) => ({
    id: c.id,
    highlightedText: c.highlightedText,
    comment: c.comment,
    reviewerName: reviewerNameByRequestId[c.reviewRequestId] ?? "Reviewer",
    roundNumber: reviewRequests.find((r) => r.id === c.reviewRequestId)?.roundNumber ?? 0,
    editedAt: c.editedAt ?? null,
  }));

  return (
    <>
      <ReviewTrail
        documentStatus={documentStatus}
        uploadedByName={uploadedByName}
        uploadedAt={uploadedAt}
        reviewRequests={reviewRequests}
        inlineComments={inlineComments}
        revoked={revoked}
        onCommentClick={(id) => setFocusItemId((prev) => ({ id, nonce: (prev?.nonce ?? 0) + 1 }))}
      />
      <ReviewHighlightsViewer
        documentId={documentId}
        version={version}
        hasPdf={hasPdf}
        extractedText={extractedText}
        highlights={highlights}
        focusItemId={focusItemId}
      />
    </>
  );
}
