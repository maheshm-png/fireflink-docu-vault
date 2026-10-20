-- Preview-only documents: additive, every existing document stays downloadable.
ALTER TABLE "Document" ADD COLUMN "downloadable" BOOLEAN NOT NULL DEFAULT true;
