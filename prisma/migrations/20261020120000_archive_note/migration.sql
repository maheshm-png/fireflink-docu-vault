-- Optional note a manager leaves when archiving a document, plus who
-- archived it and when. Shown wherever the archived document is viewed.
ALTER TABLE "Document" ADD COLUMN "archiveNote" TEXT;
ALTER TABLE "Document" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Document" ADD COLUMN "archivedById" TEXT;
ALTER TABLE "Document" ADD CONSTRAINT "Document_archivedById_fkey" FOREIGN KEY ("archivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
