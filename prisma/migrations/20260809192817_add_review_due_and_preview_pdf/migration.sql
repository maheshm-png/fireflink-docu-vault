-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "reviewDueAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DocumentVersion" ADD COLUMN     "previewPdfPath" TEXT;
