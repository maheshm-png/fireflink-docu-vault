import { prisma } from "./prisma";
import { deleteFile } from "./storage";
import { removeFromIndex } from "./search";

/**
 * Permanently removes a document: every version's storage files, the search
 * index entry, and every DB row that belongs to it. Shared by the retention
 * job (scripts/run-retention-cleanup.ts, for soft-deleted documents past
 * their window) and DELETE /api/documents/:id (an uploader withdrawing their
 * own submission before any review decision, which skips the soft delete).
 * Audit log rows are kept on purpose; they're the record that it happened.
 */
export async function purgeDocument(documentId: string) {
  const versions = await prisma.documentVersion.findMany({
    where: { documentId },
    select: { filePath: true, previewPdfPath: true },
  });

  for (const version of versions) {
    const keys = [version.filePath, version.previewPdfPath].filter((k): k is string => Boolean(k));
    for (const key of keys) {
      try {
        await deleteFile(key);
      } catch (err) {
        // Best-effort: an orphaned storage object is harmless and invisible;
        // leaving the DB row behind because one blob failed to delete would
        // be worse, so we log and continue rather than aborting the purge.
        console.error(`Failed to delete storage object ${key}:`, err);
      }
    }
  }

  await removeFromIndex(documentId);

  // Children first (all FKs to Document are RESTRICT, not CASCADE), parent
  // last, one transaction. inlineComment must come before reviewRequest,
  // since InlineComment also has a RESTRICT FK into ReviewRequest.
  // Notification.documentId isn't a real FK, but a leftover one would link
  // to a document that no longer exists, so those go too. Other documents
  // flagged as a duplicate of this one just lose that pointer.
  await prisma.$transaction([
    prisma.document.update({ where: { id: documentId }, data: { currentVersionId: null } }),
    prisma.document.updateMany({ where: { duplicateOfId: documentId }, data: { duplicateOfId: null } }),
    prisma.documentEvent.deleteMany({ where: { documentId } }),
    prisma.stalenessFlag.deleteMany({ where: { documentId } }),
    prisma.inlineComment.deleteMany({ where: { documentId } }),
    prisma.documentFeedback.deleteMany({ where: { documentId } }),
    prisma.shareLink.deleteMany({ where: { documentId } }),
    prisma.reviewRequest.deleteMany({ where: { documentId } }),
    prisma.notification.deleteMany({ where: { documentId } }),
    prisma.documentVersion.deleteMany({ where: { documentId } }),
    prisma.document.delete({ where: { id: documentId } }),
  ]);
}

// True when this delete is the uploader pulling back their own submission
// before any review decision: still pending_review, never revoked (a
// revoked document had a published version), and every review row still
// pending. Checked by DELETE /api/documents/:id; the document page applies the same
// rule to pick the delete confirmation text.
export async function isWithdrawalBeforeReview(
  document: { id: string; status: string; uploadedById: string; revokedAt: Date | null },
  userId: string
) {
  if (document.status !== "pending_review" || document.uploadedById !== userId || document.revokedAt) return false;
  const decided = await prisma.reviewRequest.count({ where: { documentId: document.id, status: { not: "pending" } } });
  return decided === 0;
}
