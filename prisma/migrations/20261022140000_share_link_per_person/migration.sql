-- One share link per person per document, instead of one per document, so
-- each sharer's opens are their own (lib/shareTracking.ts). Existing links
-- keep working and stay with whoever created them.
DROP INDEX IF EXISTS "ShareLink_documentId_key";
CREATE UNIQUE INDEX "ShareLink_documentId_createdById_key" ON "ShareLink"("documentId", "createdById");
CREATE INDEX "ShareLink_documentId_idx" ON "ShareLink"("documentId");
