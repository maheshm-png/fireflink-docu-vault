-- Leadership view of selected teams: view, download and comment on those
-- teams' documents without being a member. The "all teams" form stays
-- User.seesAllTeams. Purely additive.
CREATE TABLE "UserViewTeam" (
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    CONSTRAINT "UserViewTeam_pkey" PRIMARY KEY ("userId", "teamId")
);
CREATE INDEX "UserViewTeam_teamId_idx" ON "UserViewTeam"("teamId");
ALTER TABLE "UserViewTeam" ADD CONSTRAINT "UserViewTeam_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserViewTeam" ADD CONSTRAINT "UserViewTeam_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserViewTeam" ENABLE ROW LEVEL SECURITY;

-- Database-side copy of the rule (prisma/rls_policies.sql, lib/access.ts teamAllows).
CREATE OR REPLACE FUNCTION team_allows_document(doc_id text) RETURNS boolean AS $$
  SELECT current_user_sees_all_restricted()
      OR EXISTS (
        SELECT 1 FROM "DocumentTeamAccess" dta
        JOIN "UserTeam" ut ON ut."teamId" = dta."teamId"
        WHERE dta."documentId" = doc_id AND ut."userId" = auth.uid()::text
      )
      OR EXISTS (
        SELECT 1 FROM "DocumentTeamAccess" dta
        JOIN "UserViewTeam" uv ON uv."teamId" = dta."teamId"
        WHERE dta."documentId" = doc_id AND uv."userId" = auth.uid()::text
      )
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
