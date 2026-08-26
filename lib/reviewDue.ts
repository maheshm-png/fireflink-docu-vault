/**
 * Single source of truth for "when is this document's review due" — used by
 * both scripts/run-staleness-check.ts and the document detail page, so the
 * two never disagree. A manager's explicit reviewDueAt (set via "Extend
 * Validity") always wins over the computed lastReviewedAt + category cycle.
 */
export function computeReviewDueDate(
  doc: { lastReviewedAt: Date | null; createdAt: Date; reviewDueAt: Date | null },
  reviewCycleDays: number | null
): Date {
  if (doc.reviewDueAt) return doc.reviewDueAt;
  // No cycle configured for this category — treat as never due. Documents
  // uploaded while a category has no cycle are marked neverExpires by
  // default anyway (see app/api/documents/route.ts), but a document can
  // still end up here without that flag (e.g. it predates the category
  // being switched to "no cycle"), so this stays a safe fallback rather
  // than producing an Invalid Date.
  if (reviewCycleDays === null) return new Date(8640000000000000);
  const lastReview = doc.lastReviewedAt ?? doc.createdAt;
  return new Date(lastReview.getTime() + reviewCycleDays * 24 * 60 * 60 * 1000);
}
