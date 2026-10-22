-- Merge requests (lib/merge.ts). Additive: a new table, nothing existing changes.
CREATE TYPE "MergeRequestStatus" AS ENUM ('pending', 'approved', 'declined', 'withdrawn');

CREATE TABLE "MergeRequest" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "status" "MergeRequestStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "MergeRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MergeRequest_approverId_status_idx" ON "MergeRequest"("approverId", "status");
CREATE INDEX "MergeRequest_sourceId_idx" ON "MergeRequest"("sourceId");
CREATE INDEX "MergeRequest_targetId_idx" ON "MergeRequest"("targetId");

ALTER TABLE "MergeRequest" ADD CONSTRAINT "MergeRequest_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MergeRequest" ADD CONSTRAINT "MergeRequest_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MergeRequest" ADD CONSTRAINT "MergeRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MergeRequest" ADD CONSTRAINT "MergeRequest_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Managed only over the app's own connection, never through PostgREST.
ALTER TABLE "MergeRequest" ENABLE ROW LEVEL SECURITY;
