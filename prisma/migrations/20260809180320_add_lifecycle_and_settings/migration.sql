-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "neverExpires" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "deletedDocRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "oldVersionRetentionDays" INTEGER NOT NULL DEFAULT 365,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);
