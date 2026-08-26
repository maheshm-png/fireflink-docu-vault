"use client";

import { useNewDocuments } from "./NewDocumentsProvider";
import NewBadge from "./NewBadge";

/** NewBadge for a single document row/card — reads live from
 * NewDocumentsProvider instead of a static server prop, so it disappears
 * on its own (within the poll interval, or immediately on tab focus) once
 * this viewer actually opens the document, no page refresh needed. */
export default function LiveNewDocBadge({ documentId, className }: { documentId: string; className?: string }) {
  const { documentIds } = useNewDocuments();
  if (!documentIds.has(documentId)) return null;
  return <NewBadge className={className} />;
}
