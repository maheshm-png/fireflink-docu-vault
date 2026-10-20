-- Documents are never permanent by default. Team documents were (their
-- built-in category had no review cycle): give it the usual 90 days and
-- clear the permanent flag that came from it. Documents a manager marked
-- permanent on purpose can't be told apart, so this only touches documents
-- in the team category.
UPDATE "Category" SET "reviewCycleDays" = 90 WHERE "id" = 'team-documents';
UPDATE "Document" SET "neverExpires" = false WHERE "categoryId" = 'team-documents' AND "neverExpires";
