"use client";

import { useNewDocuments } from "./NewDocumentsProvider";
import NewBadge from "./NewBadge";

/** NewBadge for a Home page category tile — shown while that category holds
 * at least one document this viewer hasn't opened yet, per
 * NewDocumentsProvider's live-polled state (see LiveNewDocBadge for why
 * this can't just be a static server-rendered boolean). */
export default function LiveNewCategoryBadge({ categoryId, className }: { categoryId: string; className?: string }) {
  const { categoryIds } = useNewDocuments();
  if (!categoryIds.has(categoryId)) return null;
  return <NewBadge className={className} />;
}
