-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('open', 'accepted', 'closed');

-- AlterTable
ALTER TABLE "DocumentFeedback" ADD COLUMN     "status" "FeedbackStatus" NOT NULL DEFAULT 'open';
