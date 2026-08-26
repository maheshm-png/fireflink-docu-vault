-- Rename the "sc" (Solution Consultant) role to "contributor". A pure
-- rename, same as the earlier "other" -> "user" rename — Postgres supports
-- renaming an enum value in place since PG 10. Existing rows with
-- role = 'sc' automatically become role = 'contributor'.
ALTER TYPE "Role" RENAME VALUE 'sc' TO 'contributor';
