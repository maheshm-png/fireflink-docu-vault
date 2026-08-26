-- Category.reviewCycleDays becomes nullable: null means "no review cycle"
-- (documents in that category default to permanent — see app/api/documents/route.ts).
ALTER TABLE "Category" ALTER COLUMN "reviewCycleDays" DROP NOT NULL;
