-- CreateTable: admin-managed designation options
CREATE TABLE "Designation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Designation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Designation_name_key" ON "Designation"("name");

-- AlterTable: reporting hierarchy + designation on User
ALTER TABLE "User" ADD COLUMN "reportsToId" TEXT;
ALTER TABLE "User" ADD COLUMN "designationId" TEXT;

-- AlterTable: round tracking on ReviewRequest
ALTER TABLE "ReviewRequest" ADD COLUMN "roundNumber" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "ReviewRequest_documentId_status_idx" ON "ReviewRequest"("documentId", "status");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_reportsToId_fkey" FOREIGN KEY ("reportsToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "Designation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
