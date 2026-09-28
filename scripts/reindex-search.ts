import "dotenv/config";
/**
 * Rerunnable: re-indexes every published, non-deleted document into
 * Meilisearch from its current Prisma state. Useful after changing what
 * indexDocument() sends (a field added there doesn't retroactively appear
 * on already-indexed documents until each one goes through an edit/approve/
 * restore/lifecycle action — this backfills all of them at once) or as a
 * disaster-recovery rebuild if the search index is ever lost/corrupted.
 *
 * Also removes every soft-deleted document from the index, which clears
 * out any that got back in after deletion (the review route used to let a
 * deleted-but-still-pending document be approved and re-indexed).
 *
 * Run: npm run reindex:search
 */
import { prisma } from "../lib/prisma";
import { indexDocument, removeFromIndex } from "../lib/search";

async function main() {
  const docs = await prisma.document.findMany({
    where: { status: "published", deletedAt: null },
    include: { category: true, currentVersion: true, uploadedBy: true, duplicateOf: true },
  });

  console.log(`Re-indexing ${docs.length} published document(s)...`);
  for (const doc of docs) {
    await indexDocument({
      id: doc.id,
      title: doc.title,
      tags: doc.tags,
      categoryName: doc.category.name,
      docType: doc.docType,
      status: doc.status,
      extractedText: doc.currentVersion?.extractedText ?? "",
      uploadedByName: doc.uploadedBy.name,
      isStale: false,
      updatedAt: doc.updatedAt.toISOString(),
      duplicateOfTitle: doc.duplicateOf?.title ?? null,
      hasPreviewPdf: Boolean(doc.currentVersion?.previewPdfPath),
    });
  }

  const deleted = await prisma.document.findMany({ where: { deletedAt: { not: null } }, select: { id: true } });
  console.log(`Removing ${deleted.length} deleted document(s) from the index...`);
  for (const doc of deleted) {
    await removeFromIndex(doc.id);
  }
  console.log("Done.");
}

main()
  .catch((err) => {
    console.error("Reindex failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
