-- Global categories are for documents for everyone only. Team documents sit
-- in one built-in category (never listed or offered), and are organised by
-- their team's folders. Existing team documents move into it; their detail
-- fields (metadata) are kept.
ALTER TABLE "Category" ADD COLUMN "isSystem" BOOLEAN NOT NULL DEFAULT false;

INSERT INTO "Category" ("id", "name", "description", "reviewCycleDays", "formSchema", "isSystem", "createdById", "createdAt")
SELECT 'team-documents', 'Team document', 'Built-in category for team documents. Not shown in category lists.', NULL, '[]', true, u."id", CURRENT_TIMESTAMP
FROM "User" u WHERE u."role" = 'superadmin' ORDER BY u."createdAt" LIMIT 1
ON CONFLICT ("id") DO NOTHING;

UPDATE "Document" SET "categoryId" = 'team-documents'
WHERE "visibility" = 'restricted' AND EXISTS (SELECT 1 FROM "Category" WHERE "id" = 'team-documents');

DELETE FROM "DocumentCategory"
WHERE "documentId" IN (SELECT "id" FROM "Document" WHERE "visibility" = 'restricted');
