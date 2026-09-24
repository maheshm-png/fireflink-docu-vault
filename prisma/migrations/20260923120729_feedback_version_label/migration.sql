-- AlterTable
ALTER TABLE "DocumentFeedback" DROP COLUMN "versionNumber",
ADD COLUMN     "versionLabel" TEXT;
