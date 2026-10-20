-- Simplified access model (2026-10-12). Nothing is dropped, so a rollback
-- loses no data: Team.isLeadership and User.isGlobalApprover stay, unread.

-- 1. "Sees all teams" moves from the team (Leadership teams) to the person.
--    Everyone in a Leadership team today keeps exactly the access they had.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "seesAllTeams" BOOLEAN NOT NULL DEFAULT false;
UPDATE "User" SET "seesAllTeams" = true
WHERE id IN (
  SELECT ut."userId" FROM "UserTeam" ut JOIN "Team" t ON t.id = ut."teamId" WHERE t."isLeadership"
);

-- 2. Team documents can no longer have public share links.
DELETE FROM "ShareLink" WHERE "documentId" IN (SELECT id FROM "Document" WHERE visibility = 'restricted');
UPDATE "Document" SET "shareEnabled" = false WHERE visibility = 'restricted' AND "shareEnabled";

-- 3. Database-side copy of the "sees every restricted document" rule
--    (prisma/rls_policies.sql, lib/access.ts seesAllRestricted).
CREATE OR REPLACE FUNCTION current_user_sees_all_restricted() RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM "User" WHERE id = auth.uid()::text AND (role = 'superadmin' OR "seesAllTeams")
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- 4. One Everyone approver (User.isGlobalApprover, an org manager), picked by
--    a superadmin in Settings. Keeps at most one existing pick that is a manager.
UPDATE "User" SET "isGlobalApprover" = false
WHERE "isGlobalApprover" AND id NOT IN (
  SELECT id FROM "User" WHERE "isGlobalApprover" AND role = 'manager' AND "isActive" ORDER BY "createdAt" LIMIT 1
);
