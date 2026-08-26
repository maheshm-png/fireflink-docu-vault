-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "duplicateOfId" TEXT,
ADD COLUMN     "duplicateReason" TEXT;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
