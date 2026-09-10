-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "feedbackEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "InlineComment" ALTER COLUMN "highlightedText" DROP NOT NULL;

-- CreateTable
CREATE TABLE "DocumentFeedback" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "highlightedText" TEXT,
    "comment" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentFeedback_documentId_idx" ON "DocumentFeedback"("documentId");

-- AddForeignKey
ALTER TABLE "DocumentFeedback" ADD CONSTRAINT "DocumentFeedback_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentFeedback" ADD CONSTRAINT "DocumentFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
