-- "Also show in": extra categories a document is listed under besides its
-- main one. Purely additive.
CREATE TABLE "DocumentCategory" (
    "documentId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    CONSTRAINT "DocumentCategory_pkey" PRIMARY KEY ("documentId", "categoryId")
);
CREATE INDEX "DocumentCategory_categoryId_idx" ON "DocumentCategory"("categoryId");
ALTER TABLE "DocumentCategory" ADD CONSTRAINT "DocumentCategory_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentCategory" ADD CONSTRAINT "DocumentCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Managed only by the app over its own connection; no PostgREST access.
ALTER TABLE "DocumentCategory" ENABLE ROW LEVEL SECURITY;
