-- CreateTable
CREATE TABLE "InlineComment" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "reviewRequestId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "highlightedText" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InlineComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InlineComment_reviewRequestId_idx" ON "InlineComment"("reviewRequestId");

-- CreateIndex
CREATE INDEX "InlineComment_documentId_idx" ON "InlineComment"("documentId");

-- AddForeignKey
ALTER TABLE "InlineComment" ADD CONSTRAINT "InlineComment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InlineComment" ADD CONSTRAINT "InlineComment_reviewRequestId_fkey" FOREIGN KEY ("reviewRequestId") REFERENCES "ReviewRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InlineComment" ADD CONSTRAINT "InlineComment_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
