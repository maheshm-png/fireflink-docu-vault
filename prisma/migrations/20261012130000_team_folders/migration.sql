-- Folders inside a team's documents (Home > My teams), created by the team's
-- managers. Purely additive: existing documents start unfiled.
CREATE TABLE "TeamFolder" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeamFolder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TeamFolder_teamId_name_key" ON "TeamFolder"("teamId", "name");
ALTER TABLE "TeamFolder" ADD CONSTRAINT "TeamFolder_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamFolder" ADD CONSTRAINT "TeamFolder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DocumentTeamAccess" ADD COLUMN "folderId" TEXT;
CREATE INDEX "DocumentTeamAccess_folderId_idx" ON "DocumentTeamAccess"("folderId");
ALTER TABLE "DocumentTeamAccess" ADD CONSTRAINT "DocumentTeamAccess_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "TeamFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Managed only by the app over its own connection; no PostgREST access.
ALTER TABLE "TeamFolder" ENABLE ROW LEVEL SECURITY;
