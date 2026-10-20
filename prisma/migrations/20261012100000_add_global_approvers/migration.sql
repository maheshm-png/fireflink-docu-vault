-- Global approvers and "Request for Everyone". Additive: nobody is a Global
-- approver until a superadmin picks them, and no requests exist yet.
CREATE TYPE "GlobalRequestStatus" AS ENUM ('pending', 'approved', 'rejected');

ALTER TABLE "User" ADD COLUMN "isGlobalApprover" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "GlobalPublishRequest" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "GlobalRequestStatus" NOT NULL DEFAULT 'pending',
    "decidedById" TEXT,
    "decisionComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "GlobalPublishRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GlobalPublishRequest_status_idx" ON "GlobalPublishRequest"("status");
CREATE INDEX "GlobalPublishRequest_documentId_idx" ON "GlobalPublishRequest"("documentId");

ALTER TABLE "GlobalPublishRequest" ADD CONSTRAINT "GlobalPublishRequest_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GlobalPublishRequest" ADD CONSTRAINT "GlobalPublishRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GlobalPublishRequest" ADD CONSTRAINT "GlobalPublishRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Managed only over the app's own connection, never through PostgREST.
ALTER TABLE "GlobalPublishRequest" ENABLE ROW LEVEL SECURITY;
