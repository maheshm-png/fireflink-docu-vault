-- AlterEnum
ALTER TYPE "DocType" ADD VALUE 'link';

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "externalUrl" TEXT;
