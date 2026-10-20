-- Team roles: what someone may do inside each team, separate from their
-- org-wide User.role. Additive.
CREATE TYPE "TeamRole" AS ENUM ('member', 'contributor', 'manager');

ALTER TABLE "UserTeam" ADD COLUMN "role" "TeamRole" NOT NULL DEFAULT 'member';

-- Every existing membership starts with the team role matching the person's
-- current org role, so nobody gains or loses anything on rollout.
UPDATE "UserTeam" ut
SET "role" = CASE u."role"
  WHEN 'manager' THEN 'manager'::"TeamRole"
  WHEN 'contributor' THEN 'contributor'::"TeamRole"
  ELSE 'member'::"TeamRole"
END
FROM "User" u
WHERE u."id" = ut."userId";
