-- Team-based access control. Purely additive: nothing is dropped or
-- renamed. Every existing document gets visibility 'org' (visible to
-- everyone, exactly as before) and reviewBypassed false. User."teamId" is
-- left in place, untouched, so this can be rolled back without losing
-- anyone's team.

-- CreateEnum
CREATE TYPE "DocVisibility" AS ENUM ('org', 'restricted');

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "isLeadership" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "reviewBypassed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "visibility" "DocVisibility" NOT NULL DEFAULT 'org';

-- CreateTable
CREATE TABLE "UserTeam" (
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserTeam_pkey" PRIMARY KEY ("userId","teamId")
);

-- CreateTable
CREATE TABLE "DocumentTeamAccess" (
    "documentId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "grantedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentTeamAccess_pkey" PRIMARY KEY ("documentId","teamId")
);

-- CreateIndex
CREATE INDEX "UserTeam_teamId_idx" ON "UserTeam"("teamId");

-- CreateIndex
CREATE INDEX "DocumentTeamAccess_teamId_idx" ON "DocumentTeamAccess"("teamId");

-- CreateIndex
CREATE INDEX "Document_visibility_idx" ON "Document"("visibility");

-- AddForeignKey
ALTER TABLE "UserTeam" ADD CONSTRAINT "UserTeam_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTeam" ADD CONSTRAINT "UserTeam_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTeamAccess" ADD CONSTRAINT "DocumentTeamAccess_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTeamAccess" ADD CONSTRAINT "DocumentTeamAccess_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTeamAccess" ADD CONSTRAINT "DocumentTeamAccess_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Data copy: every user's existing single team becomes their first
-- membership. Idempotent (ON CONFLICT) so re-running is harmless.
INSERT INTO "UserTeam" ("userId", "teamId", "createdAt")
SELECT "id", "teamId", CURRENT_TIMESTAMP FROM "User" WHERE "teamId" IS NOT NULL
ON CONFLICT DO NOTHING;
