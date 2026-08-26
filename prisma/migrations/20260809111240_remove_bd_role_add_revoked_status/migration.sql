-- AlterEnum
ALTER TYPE "DocStatus" ADD VALUE 'revoked';

-- Data safety: reassign any existing 'bd' users to 'other' before the enum
-- swap below drops the 'bd' value (none exist today, but this makes the
-- migration correct regardless of when it actually runs).
UPDATE "User" SET role = 'other' WHERE role = 'bd';

-- AlterEnum
BEGIN;
CREATE TYPE "Role_new" AS ENUM ('superadmin', 'manager', 'sc', 'other');
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "Role_old";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'other';
COMMIT;
