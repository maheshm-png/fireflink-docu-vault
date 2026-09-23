-- AlterTable
ALTER TABLE "DocumentFeedback" ADD COLUMN     "statusChangedById" TEXT,
ADD COLUMN     "taggedUserId" TEXT;

-- AddForeignKey
ALTER TABLE "DocumentFeedback" ADD CONSTRAINT "DocumentFeedback_statusChangedById_fkey" FOREIGN KEY ("statusChangedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentFeedback" ADD CONSTRAINT "DocumentFeedback_taggedUserId_fkey" FOREIGN KEY ("taggedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
