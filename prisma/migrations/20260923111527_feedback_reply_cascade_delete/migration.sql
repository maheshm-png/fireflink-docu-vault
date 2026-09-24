-- DropForeignKey
ALTER TABLE "FeedbackReply" DROP CONSTRAINT "FeedbackReply_feedbackId_fkey";

-- AddForeignKey
ALTER TABLE "FeedbackReply" ADD CONSTRAINT "FeedbackReply_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "DocumentFeedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;
