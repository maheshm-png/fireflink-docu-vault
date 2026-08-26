-- Rename the "other" role to "user" (view-only role, unchanged permissions).
-- A pure rename, unlike the earlier "bd" removal — Postgres supports
-- renaming an enum value in place since PG 10, so no need to recreate the
-- type. Existing rows with role = 'other' automatically become role = 'user'.
ALTER TYPE "Role" RENAME VALUE 'other' TO 'user';

ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'user';
